import type Stripe from "stripe";
import type { Checkout, SpendRequest } from "../../shared/types.js";
import { createAgentStripeClient, getGreenMartSellerProfile } from "./client.js";
import type { GrantedSharedPaymentToken } from "../../marketplace/stripe/granted-token.js";

export interface IssuedSharedPaymentToken {
  id: string;
  status: string;
  nextAction?: {
    type: string;
    use_stripe_sdk?: { value: string };
  };
}

const asIssuedToken = (payload: unknown): IssuedSharedPaymentToken => {
  const token = payload as {
    id: string;
    status: string;
    next_action?: IssuedSharedPaymentToken["nextAction"];
  };
  if (!token.id?.startsWith("spt_")) throw new Error("Stripe did not return a valid Shared Payment Token.");
  return { id: token.id, status: token.status, nextAction: token.next_action };
};

export const issueSharedPaymentToken = async (
  checkout: Checkout,
  spendRequest: SpendRequest,
  paymentMethodId: string,
  stripe: Stripe = createAgentStripeClient(),
): Promise<IssuedSharedPaymentToken> => {
  const expiresAt = Math.floor(new Date(spendRequest.expiresAt).getTime() / 1000);
  const response = await stripe.rawRequest("POST", "/v1/shared_payment/issued_tokens", {
    payment_method: paymentMethodId,
    "seller_details[network_business_profile]": getGreenMartSellerProfile(),
    "usage_limits[currency]": checkout.currency,
    "usage_limits[max_amount]": checkout.total,
    "usage_limits[expires_at]": expiresAt,
  });
  return asIssuedToken(response);
};

export const retrieveIssuedSharedPaymentToken = async (
  issuedTokenId: string,
  stripe: Stripe = createAgentStripeClient(),
): Promise<IssuedSharedPaymentToken & { usageLimits: GrantedSharedPaymentToken["usageLimits"] }> => {
  const response = await stripe.rawRequest("GET", `/v1/shared_payment/issued_tokens/${issuedTokenId}`, {});
  const token = response as unknown as {
    id: string;
    status: string;
    next_action?: IssuedSharedPaymentToken["nextAction"];
    usage_limits: { currency: string; max_amount: number; expires_at: number };
  };
  if (!token.id?.startsWith("spt_")) throw new Error("Stripe did not return a valid Shared Payment Token.");
  return {
    id: token.id,
    status: token.status,
    nextAction: token.next_action,
    usageLimits: {
      currency: token.usage_limits.currency,
      maxAmount: token.usage_limits.max_amount,
      expiresAt: token.usage_limits.expires_at,
    },
  };
};
