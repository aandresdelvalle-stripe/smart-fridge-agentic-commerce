import { buildAgentApp } from "../../src/agent/app.js";
import { createInjectMarketplaceClient } from "../../src/agent/marketplace-client.js";
import { buildMarketplaceApp, type MarketplacePaymentGateway } from "../../src/marketplace/app.js";

export const buildTestStack = async (overrides: { payments?: MarketplacePaymentGateway } = {}) => {
  const marketplace = await buildMarketplaceApp(overrides);
  const agent = await buildAgentApp({ marketplace: createInjectMarketplaceClient(marketplace.app) });
  return { marketplace, agent };
};
