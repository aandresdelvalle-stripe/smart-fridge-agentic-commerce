import type Stripe from "stripe";
import type { Checkout, SpendRequest } from "../../shared/types.js";
import { createMarketplaceStripeClient } from "./client.js";

export interface GrantedSharedPaymentToken {
  id: string;
  usageLimits: {
    currency: string;
    maxAmount: number;
    expiresAt: number;
  };
}

const asGrantedToken = (payload: unknown): GrantedSharedPaymentToken => {
  const token = payload as {
    id: string;
    usage_limits: { currency: string; max_amount: number; expires_at: number };
  };
  if (!token.id?.startsWith("spt_")) throw new Error("Stripe did not return a valid Shared Payment Token.");
  return {
    id: token.id,
    usageLimits: {
      currency: token.usage_limits.currency,
      maxAmount: token.usage_limits.max_amount,
      expiresAt: token.usage_limits.expires_at,
    },
  };
};

export const assertGrantedTokenMatchesCheckout = (token: GrantedSharedPaymentToken, checkout: Checkout): void => {
  if (token.usageLimits.currency !== checkout.currency) {
    throw new Error("The granted SPT currency does not match the checkout currency.");
  }
  if (checkout.total > token.usageLimits.maxAmount) {
    throw new Error("The checkout total exceeds the granted SPT usage limit.");
  }
  if (token.usageLimits.expiresAt * 1000 <= Date.now()) {
    throw new Error("The granted SPT has expired.");
  }
};

export const grantTestSharedPaymentToken = async (
  checkout: Checkout,
  spendRequest: SpendRequest,
  stripe: Stripe = createMarketplaceStripeClient(),
): Promise<GrantedSharedPaymentToken> => {
  const paymentMethod = process.env.STRIPE_TEST_PAYMENT_METHOD?.trim() || "pm_card_visa";
  const expiresAt = Math.floor(new Date(spendRequest.expiresAt).getTime() / 1000);
  const response = await stripe.rawRequest("POST", "/v1/test_helpers/shared_payment/granted_tokens", {
    payment_method: paymentMethod,
    "usage_limits[currency]": checkout.currency,
    "usage_limits[max_amount]": checkout.total,
    "usage_limits[expires_at]": expiresAt,
  });
  return asGrantedToken(response);
};

export const retrieveGrantedSharedPaymentToken = async (
  sharedPaymentToken: string,
  stripe: Stripe = createMarketplaceStripeClient(),
): Promise<GrantedSharedPaymentToken> => {
  const response = await stripe.rawRequest("GET", `/v1/shared_payment/granted_tokens/${sharedPaymentToken}`, {});
  return asGrantedToken(response);
};
