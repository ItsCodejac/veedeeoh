// Stripe billing for the cloud (SaaS) pipeline. Subscription Checkout ($4/mo)
// + webhook that writes tier/expiry to Supabase. Self-host is free and never
// touches this. All secrets come from env — never hardcode keys.
//
// Required env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET,
//               SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (webhook writes bypass RLS).

import Stripe from "stripe";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _stripe: Stripe | null = null;
// Pin the API version. Unpinned, the SDK follows the account default -- so
// Stripe upgrading that default silently changes payload shapes with no deploy
// on our side. current_period_end already moved onto subscription items once;
// the next such move should be a deliberate upgrade, not a surprise. Bump this
// intentionally after reading the changelog.
const STRIPE_API_VERSION = "2026-06-24.dahlia";

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    });
  }
  return _stripe;
}

// Service-role client — used ONLY by the signature-verified webhook to update
// any user's profile. Never expose this key to clients.
function adminSupabase(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

const PRICE_ID = () => process.env.STRIPE_PRICE_ID || "";

/** Find or create the Stripe customer for a user and cache the id on profiles. */
export async function ensureCustomer(userId: string, email: string): Promise<string> {
  const sb = adminSupabase();
  const { data } = await sb.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id;

  const customer = await getStripe().customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });
  await sb.from("profiles").upsert(
    { id: userId, email, stripe_customer_id: customer.id },
    { onConflict: "id" }
  );
  return customer.id;
}

export const BASE_SEATS = 3; // $4/mo includes 3 seats (logins); +$2/seat beyond

/** Hosted Checkout for the seat-based subscription (7-day trial). `seats` maps to
 *  the tiered price quantity (min 3 = the included base). Returns the URL. */
export async function createCheckoutSession(userId: string, email: string, origin: string, seats = BASE_SEATS): Promise<string> {
  const customer = await ensureCustomer(userId, email);
  const qty = Math.max(BASE_SEATS, Math.floor(seats));
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    // Do NOT set payment_method_types — dynamic payment methods maximize conversion.
    line_items: [{ price: PRICE_ID(), quantity: qty }],
    subscription_data: { trial_period_days: 7 },
    allow_promotion_codes: true,
    integration_identifier: "veedeeoh_checkout_qkzmrvwt",
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancel`,
  });
  if (!session.url) throw new Error("no checkout url");
  return session.url;
}

/** Customer Portal for self-service manage/cancel. */
export async function createPortalSession(userId: string, origin: string): Promise<string> {
  const sb = adminSupabase();
  const { data } = await sb.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
  if (!data?.stripe_customer_id) throw new Error("no stripe customer for user");
  const portal = await getStripe().billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${origin}/`,
  });
  return portal.url;
}

/** Cancel any live subscription immediately, for account deletion.
 *
 *  Deletion MUST cancel before the row disappears. The Stripe customer is an
 *  independent object: delete the account row and the subscription keeps
 *  renewing forever against a user who no longer exists, and the webhook that
 *  would have recorded it can no longer find a profile to write to. Charging a
 *  deleted account is the worst possible outcome of a delete button.
 *
 *  Deliberately does not throw. A billing failure must not block a user from
 *  deleting their data -- it is reported to the caller, who surfaces it so the
 *  user knows to check Stripe, but deletion proceeds.
 */
export async function cancelForDeletion(userId: string): Promise<{ canceled: boolean; error?: string }> {
  try {
    const sb = adminSupabase();
    const { data } = await sb.from("profiles")
      .select("stripe_customer_id, stripe_subscription_id").eq("id", userId).maybeSingle();
    if (!data?.stripe_customer_id) return { canceled: false };

    // Cancel every subscription on the customer, not just the id cached on the
    // row: a resubscribe can leave the cached id stale while a different
    // subscription is the live one.
    const subs = await getStripe().subscriptions.list({
      customer: data.stripe_customer_id, status: "all", limit: 100,
    });
    let n = 0;
    for (const sub of subs.data) {
      if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
      await getStripe().subscriptions.cancel(sub.id, { prorate: false });
      n++;
    }
    return { canceled: n > 0 };
  } catch (e: any) {
    console.error("[billing] cancelForDeletion failed", e);
    return { canceled: false, error: e?.message || "stripe cancel failed" };
  }
}

/** Mirror a subscription's state onto the account row. */
// How long a customer keeps access after a renewal fails. Stripe's smart retries
// run for roughly three weeks; the grace should outlast them so a card that
// eventually succeeds never causes a lockout. When Stripe gives up it moves the
// subscription to unpaid or canceled and access ends immediately.
const DUNNING_GRACE_DAYS = 24;

async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const sb = adminSupabase();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Entitlement follows Stripe's dunning window rather than cutting at the first
  // decline. Revoking on past_due turns a recoverable expired card into
  // involuntary churn on day one.
  //
  //   active, trialing     paid and current
  //   past_due             renewal failed, Stripe still retrying -> keep access
  //   unpaid               retries exhausted                     -> revoke
  //   canceled             ended                                 -> revoke
  //   incomplete(_expired) first payment never completed         -> no access
  //   paused               intentionally paused                  -> no access
  const entitled = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";

  // period end lives on the subscription (older API) or its items (newer API)
  const periodEnd =
    (sub as any).current_period_end ?? (sub.items?.data?.[0] as any)?.current_period_end ?? null;
  const seats = sub.items?.data?.[0]?.quantity ?? BASE_SEATS;

  // During past_due the paid period has already elapsed, so carrying the old
  // period end through would leave tier_expires in the past and hasActiveAccess
  // would deny anyway. The grace has to be explicit.
  let expires: string;
  if (!entitled) {
    expires = new Date().toISOString();
  } else if (sub.status === "past_due") {
    expires = new Date(Date.now() + DUNNING_GRACE_DAYS * 86_400_000).toISOString();
  } else {
    expires = periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString();
  }

  await sb.from("profiles").update({
    // past_due deliberately stays on cloud_paid. A distinct tier would have to be
    // added to PAID_TIERS in the frontend gate, and forgetting that would revoke
    // access again -- exactly the bug being fixed here.
    tier: entitled ? "cloud_paid" : "canceled",
    tier_expires: expires,
    stripe_subscription_id: sub.id,
    seats,
  }).eq("stripe_customer_id", customerId);
}

/** Change the number of seats (subscription quantity). Reprices immediately;
 *  the resulting subscription.updated webhook syncs `seats` back to the profile. */
export async function setSeats(userId: string, seats: number): Promise<number> {
  const qty = Math.max(BASE_SEATS, Math.floor(seats));
  const sb = adminSupabase();
  const { data } = await sb.from("profiles").select("stripe_subscription_id").eq("id", userId).maybeSingle();
  if (!data?.stripe_subscription_id) throw new Error("no active subscription");
  const sub = await getStripe().subscriptions.retrieve(data.stripe_subscription_id);
  await getStripe().subscriptions.update(sub.id, {
    items: [{ id: sub.items.data[0].id, quantity: qty }],
    proration_behavior: "create_prorations",
  });
  return qty;
}

// ------------------------------------------------------------ party credits ---

const CREDIT_PRICE_ID = () => process.env.STRIPE_CREDIT_PRICE_ID || "";

/** One-time Checkout for a credit top-up. Separate from the subscription
 *  Checkout because this is `mode: payment` -- a top-up must not create or
 *  alter a subscription, and mixing them is how someone ends up double-billed
 *  monthly for a one-off dollar. */
export async function createCreditCheckout(
  userId: string, email: string | undefined, origin: string
): Promise<string> {
  if (!CREDIT_PRICE_ID()) throw new Error("STRIPE_CREDIT_PRICE_ID is not configured");
  const customer = await ensureCustomer(userId, email || "");
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{ price: CREDIT_PRICE_ID(), quantity: 1 }],
    success_url: `${origin}/#settings/account?credits=1`,
    cancel_url: `${origin}/#settings/account`,
    // Read back by the webhook. The user id must travel with the payment: a
    // Checkout session is the only place the two are reliably tied together.
    metadata: { userId, kind: "party_credits", credits: "24" },
  });
  return session.url || "";
}

/** Add purchased credits. Idempotent on the Stripe session id, because a
 *  webhook retry that tops someone up twice is free money we did not sell. */
async function creditPurchase(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId;
  const credits = parseInt(session.metadata?.credits || "0", 10);
  if (!userId || !credits) return;

  const sb = adminSupabase();
  const { data: seen } = await sb.from("party_credit_ledger")
    .select("id").eq("note", session.id).maybeSingle();
  if (seen) return;

  const { data: prof } = await sb.from("profiles")
    .select("party_credits").eq("id", userId).maybeSingle();
  if (!prof) return;

  // Purchased credits deliberately IGNORE the 180 rollover cap. That ceiling
  // exists to bound an unearned liability from stacked monthly grants; someone
  // who paid cash for four hours must receive four hours.
  await sb.from("profiles")
    .update({ party_credits: (prof.party_credits ?? 0) + credits })
    .eq("id", userId);
  await sb.from("party_credit_ledger")
    .insert({ user_id: userId, delta: credits, reason: "purchase", note: session.id });
}

/** Issue any free months the account has earned.
 *
 *  Applied as a CUSTOMER BALANCE CREDIT rather than a coupon or a trial
 *  extension: it is exactly "do not charge for this one", it shows on the
 *  invoice as applied balance so the customer can see why, and it touches no
 *  subscription field that applySubscription would then misread as a status
 *  change.
 *
 *  claim -> apply -> mark is three steps on purpose. The unique key in
 *  free_month_grants makes the claim atomic, and a Stripe failure leaves
 *  applied_at null so the next run retries rather than minting or losing one.
 */
export async function issueFreeMonths(userId: string): Promise<number> {
  const sb = adminSupabase();
  const { data: pending, error } = await sb.rpc("claim_free_months", { target: userId });
  if (error || !Array.isArray(pending) || !pending.length) return 0;

  const { data: prof } = await sb.from("profiles")
    .select("stripe_customer_id").eq("id", userId).maybeSingle();
  if (!prof?.stripe_customer_id) return 0;

  let applied = 0;
  for (const grant of pending as any[]) {
    try {
      const txn = await getStripe().customers.createBalanceTransaction(prof.stripe_customer_id, {
        amount: -MONTHLY_PRICE_CENTS,   // negative == credit toward future invoices
        currency: "usd",
        description: `veedeeoh free month (${grant.trigger} milestone ${grant.milestone})`,
      });
      await sb.from("free_month_grants")
        .update({ applied_at: new Date().toISOString(), stripe_ref: txn.id })
        .eq("id", grant.id);
      applied++;
    } catch (e) {
      console.error("[billing] free month not applied", grant.id, e);
    }
  }
  return applied;
}

// What a free month is worth. Kept next to the issuance rather than read from
// the price at runtime: a customer who earned a month at $4 should get $4, even
// if the price later changes.
const MONTHLY_PRICE_CENTS = 400;

// ---------------------------------------------------------------- referrals ---

/** Accrue affiliate commission for one paid invoice.
 *
 *  Idempotent by construction: referral_earnings is unique on
 *  stripe_invoice_id, so a webhook retry hits the conflict and credits nothing
 *  twice. Stripe retries aggressively, and a double-credited ledger is money
 *  paid out that was never earned.
 *
 *  Never throws into the webhook. A referral bookkeeping failure must not make
 *  Stripe retry an invoice whose ENTITLEMENT was already applied -- the user
 *  losing access is a far worse outcome than a missed accrual, which is
 *  recoverable from Stripe's own invoice history.
 */
async function accrueReferral(inv: Stripe.Invoice): Promise<void> {
  try {
    const sb = adminSupabase();
    const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
    if (!customerId || !inv.id) return;

    // Commission is on NET revenue. Tax is collected on behalf of a tax
    // authority and was never ours to share.
    const gross =
      (inv as any).total_excluding_tax ?? ((inv.amount_paid || 0) - ((inv as any).tax || 0));
    if (!gross || gross <= 0) return;   // $0 invoices, full credits, trials

    const { data: payer } = await sb.from("profiles")
      .select("id").eq("stripe_customer_id", customerId).maybeSingle();
    if (!payer?.id) return;

    const { data: ref } = await sb.from("referrals")
      .select("referrer_user_id, rate_bps, duration_months, first_paid_at")
      .eq("referred_user_id", payer.id).maybeSingle();
    if (!ref) return;

    // The commission window runs from the FIRST payment, not from signup, so a
    // referred account that lingers on a free trial does not burn the window
    // the affiliate was promised. duration_months = 0 means for the life of
    // the account.
    if (ref.duration_months > 0 && ref.first_paid_at) {
      const end = new Date(ref.first_paid_at);
      end.setMonth(end.getMonth() + ref.duration_months);
      if (Date.now() > end.getTime()) return;
    }

    const commission = Math.round((gross * ref.rate_bps) / 10000);
    if (commission <= 0) return;

    const { error } = await sb.from("referral_earnings").insert({
      referrer_user_id: ref.referrer_user_id,
      referred_user_id: payer.id,
      stripe_invoice_id: inv.id,
      currency: inv.currency || "usd",
      gross_cents: gross,
      rate_bps: ref.rate_bps,
      commission_cents: commission,
      occurred_at: new Date((inv.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    });
    // 23505 is the unique violation on stripe_invoice_id: this invoice was
    // already accrued, which is the retry path working as designed.
    if (error && error.code !== "23505") {
      console.error("[billing] referral accrual failed", error);
      return;
    }

    if (!ref.first_paid_at) {
      await sb.from("referrals")
        .update({ first_paid_at: new Date().toISOString() })
        .eq("referred_user_id", payer.id)
        .is("first_paid_at", null);
    }
  } catch (e) {
    console.error("[billing] referral accrual threw", e);
  }
}

/** Monthly allowance, then any free month it just earned. Never throws into the
 *  webhook: entitlement was already applied by this point, and making Stripe
 *  retry a paid invoice over a credit-grant hiccup would risk the customer's
 *  access for a recoverable bookkeeping miss. */
async function grantAndReward(inv: Stripe.Invoice): Promise<void> {
  try {
    const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
    if (!customerId) return;
    const sb = adminSupabase();
    const { data: prof } = await sb.from("profiles")
      .select("id").eq("stripe_customer_id", customerId).maybeSingle();
    if (!prof?.id) return;

    await sb.rpc("grant_monthly_credits", { target: prof.id });
    await issueFreeMonths(prof.id);
  } catch (e) {
    console.error("[billing] credit grant failed", e);
  }
}

/** Verify + process a Stripe webhook. Throws on bad signature. */
export async function handleWebhook(rawBody: string, signature: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const event = getStripe().webhooks.constructEvent(rawBody, signature, secret);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object as Stripe.Subscription);
      break;
    // A renewal succeeding or failing does not always emit a subscription event,
    // and without payment_failed the dunning window is invisible. Both re-sync
    // from the subscription.
    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const subId = (inv as any).subscription;
      if (subId) await applySubscription(await getStripe().subscriptions.retrieve(subId as string));
      // Entitlement first, then bookkeeping. accrueReferral swallows its own
      // errors so it can never cost the customer their access.
      if (event.type === "invoice.paid") {
        await accrueReferral(inv);
        // A paid invoice IS the month boundary, so the allowance is granted here
        // rather than on a cron: no schedule to drift, and grant_monthly_credits
        // is idempotent on credits_granted_for so a webhook retry is harmless.
        await grantAndReward(inv);
      }
      break;
    }
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.subscription) {
        const sub = await getStripe().subscriptions.retrieve(s.subscription as string);
        await applySubscription(sub);
      }
      // A credit top-up has no subscription, so it would otherwise fall through
      // this case having done nothing.
      if (s.metadata?.kind === "party_credits") await creditPurchase(s);
      break;
    }
    default:
      break; // ignore unrelated events
  }
}
