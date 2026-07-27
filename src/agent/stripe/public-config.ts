import { isDemoMode } from "./client.js";
import { getAcsMode, type AcsMode } from "../acp/mode.js";

export interface AgentPublicConfig {
  demoMode: boolean;
  acsMode: AcsMode;
  stripePublishableKey: string | null;
  sellerNetworkProfile: string | null;
  savedPaymentAuthority: boolean;
  savedPaymentAuthorityLabel: string | null;
  marketplaceUrl: string;
}

export const getHouseholdPaymentMethod = (): string | null => {
  const value = process.env.HOUSEHOLD_PAYMENT_METHOD?.trim();
  if (!value?.startsWith("pm_")) return null;
  return value;
};

export const getAgentPublicConfig = (sellerNetworkProfile: string | null): AgentPublicConfig => {
  const demoMode = isDemoMode();
  const savedPaymentMethod = demoMode ? null : getHouseholdPaymentMethod();
  return {
    demoMode,
    acsMode: getAcsMode(),
    stripePublishableKey: demoMode ? null : process.env.AGENT_STRIPE_PUBLISHABLE_KEY?.trim() || process.env.STRIPE_PUBLISHABLE_KEY?.trim() || null,
    sellerNetworkProfile: demoMode ? null : sellerNetworkProfile,
    savedPaymentAuthority: Boolean(savedPaymentMethod),
    savedPaymentAuthorityLabel: savedPaymentMethod ? `Payment method ${savedPaymentMethod}` : null,
    marketplaceUrl: process.env.MARKETPLACE_URL?.trim() || "http://localhost:4242",
  };
};
