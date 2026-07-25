// Stripe billing for the cloud (SaaS) pipeline. Subscription Checkout ($4/mo)
// + webhook that writes tier/expiry to Supabase. Self-host is free and never
// touches this. All secrets come from env — never hardcode keys.
//
// Required env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET,
//               SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (webhook writes bypass RLS).

import Stripe from "stripe";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
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
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const sb = adminSupabase();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const active = sub.status === "active" || sub.status === "trialing";
  // period end lives on the subscription (older API) or its items (newer API)
  const periodEnd =
    (sub as any).current_period_end ?? (sub.items?.data?.[0] as any)?.current_period_end ?? null;
  const seats = sub.items?.data?.[0]?.quantity ?? BASE_SEATS;

  await sb.from("profiles").update({
    tier: active ? "cloud_paid" : "canceled",
    tier_expires: active && periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
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
