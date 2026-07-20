import type Stripe from "stripe";
import type { AuditLog } from "../../audit-log.js";
import { createMarketplaceStripeClient, isDemoMode } from "./client.js";

const sharedPaymentDetail = (type: string): string => {
  if (type === "shared_payment.granted_token.deactivated") return "Granted SPT deactivated; seller can no longer charge it.";
  if (type === "shared_payment.issued_token.requires_action") return "Issued SPT requires customer action before payment can complete.";
  if (type === "shared_payment.issued_token.active") return "Issued SPT is active again after required customer action.";
  if (type === "shared_payment.issued_token.used") return "Issued SPT was used by the seller.";
  if (type === "shared_payment.issued_token.deactivated") return "Issued SPT deactivated.";
  return "Shared payment token lifecycle event received.";
};

export class StripeWebhookHandler {
  private readonly processed = new Set<string>();

  private readonly stripe?: Stripe;

  constructor(private readonly auditLog: AuditLog) {
    if (!isDemoMode()) this.stripe = createMarketplaceStripeClient();
  }

  handle(rawBody: Buffer, signature?: string): { duplicate: boolean; type: string } {
    const demoMode = isDemoMode();
    let event: Stripe.Event;
    if (demoMode) {
      event = JSON.parse(rawBody.toString("utf8")) as Stripe.Event;
    } else {
      const secret = process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET?.trim() || process.env.STRIPE_WEBHOOK_SECRET?.trim();
      if (!this.stripe || !secret || !signature) throw new Error("Webhook verification requires Stripe configuration and a signature.");
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    }

    if (this.processed.has(event.id)) return { duplicate: true, type: event.type };
    this.processed.add(event.id);

    if (event.type === "payment_intent.succeeded") this.auditLog.record(event.type, "PaymentIntent succeeded; fulfillment can proceed.");
    else if (event.type.startsWith("shared_payment.")) this.auditLog.record(event.type, sharedPaymentDetail(event.type));
    else this.auditLog.record(event.type, "Webhook received and recorded.");
    return { duplicate: false, type: event.type };
  }
}
