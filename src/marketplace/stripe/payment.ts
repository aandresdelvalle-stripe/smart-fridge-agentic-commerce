import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { Checkout, PaymentResult } from "../../shared/types.js";
import { createMarketplaceStripeClient, isDemoMode } from "./client.js";

export interface PaymentGateway {
  createAndConfirm(checkout: Checkout, sharedPaymentToken: string): Promise<PaymentResult>;
}

const paymentStatus = (status: string): PaymentResult["status"] => {
  if (status === "succeeded") return "succeeded";
  if (status === "requires_action") return "requires_action";
  return "failed";
};

export class StripePaymentGateway implements PaymentGateway {
  private readonly demoMode = isDemoMode();
  private readonly stripe?: Stripe;

  constructor() {
    if (!this.demoMode) this.stripe = createMarketplaceStripeClient();
  }

  async createAndConfirm(checkout: Checkout, sharedPaymentToken: string): Promise<PaymentResult> {
    if (!sharedPaymentToken.startsWith("spt_")) throw new Error("A valid Shared Payment Token is required.");
    if (this.demoMode) {
      if (!sharedPaymentToken.startsWith("spt_demo_")) throw new Error("Demo mode requires a simulated Shared Payment Token.");
      return { id: `pi_demo_${randomUUID()}`, status: "succeeded", simulated: true };
    }
    if (sharedPaymentToken.startsWith("spt_demo_")) {
      throw new Error("Simulated Shared Payment Tokens cannot be used when DEMO_MODE=false.");
    }

    const paymentIntent = await this.stripe!.rawRequest("POST", "/v1/payment_intents", {
      amount: checkout.total,
      currency: checkout.currency,
      confirm: "true",
      "payment_method_data[shared_payment_granted_token]": sharedPaymentToken,
      "metadata[checkout_id]": checkout.id,
      "metadata[purchase_mode]": checkout.mode,
    }) as unknown as { id: string; status: string };

    return {
      id: paymentIntent.id,
      status: paymentStatus(paymentIntent.status),
      simulated: false,
    };
  }
}
