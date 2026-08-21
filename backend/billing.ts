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
      break;
    }
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.subscription) {
        const sub = await getStripe().subscriptions.retrieve(s.subscription as string);
        await applySubscription(sub);
      }
      break;
    }
    default:
      break; // ignore unrelated events
  }
}
