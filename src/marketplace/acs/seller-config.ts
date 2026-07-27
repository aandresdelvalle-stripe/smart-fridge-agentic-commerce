import { isDemoMode, getSellerNetworkProfile } from "../stripe/client.js";

/** Public ACS seller configuration exposed to the agent and dev console. */
export interface AcsSellerConfig {
  integration: "agentic_commerce_suite";
  merchant: { id: string; name: string };
  demoMode: boolean;
  sellerNetworkProfile: string | null;
  /** Local simulation of the ACP seller surface ACS exposes in production. */
  acpBaseUrl: string;
  catalogFeed: {
    artifact: string;
    generateCommand: string;
  };
}

export const getAcsSellerConfig = (): AcsSellerConfig => {
  const baseUrl = process.env.MARKETPLACE_URL?.trim() || "http://localhost:4242";
  return {
    integration: "agentic_commerce_suite",
    merchant: { id: "greenmart", name: "GreenMart" },
    demoMode: isDemoMode(),
    sellerNetworkProfile: isDemoMode() ? null : getSellerNetworkProfile(),
    acpBaseUrl: `${baseUrl.replace(/\/$/, "")}/acp`,
    catalogFeed: {
      artifact: "greenmart-product-feed.json",
      generateCommand: "npm run generate:feed",
    },
  };
};
