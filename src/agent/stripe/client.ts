import Stripe from "stripe";
import { getGreenMartSellerNetworkProfile } from "../../shared/greenmart-seller-profile.js";

export const DEFAULT_STRIPE_API_VERSION = "2026-04-22.preview";

export const isDemoMode = (): boolean => process.env.DEMO_MODE !== "false";

export const requireStripeApiVersion = (): string => {
  const version = process.env.AGENT_STRIPE_API_VERSION?.trim() || process.env.STRIPE_API_VERSION?.trim();
  if (!version) throw new Error("AGENT_STRIPE_API_VERSION is required when DEMO_MODE=false.");
  return version;
};

export const createAgentStripeClient = (): Stripe => {
  const secretKey = process.env.AGENT_STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("AGENT_STRIPE_SECRET_KEY is required when DEMO_MODE=false.");
  return new Stripe(secretKey, { apiVersion: requireStripeApiVersion() as Stripe.LatestApiVersion });
};

/** GreenMart seller profile for SPT issuance — must differ from the agent account's own network profile. */
export const getGreenMartSellerProfile = (): string => getGreenMartSellerNetworkProfile();
