import { buildAgentApp } from "../../src/agent/app.js";
import { createInjectAcpClient } from "../../src/agent/acp/client.js";
import { buildMarketplaceApp, type MarketplacePaymentGateway } from "../../src/marketplace/app.js";

export const buildTestStack = async (overrides: { payments?: MarketplacePaymentGateway } = {}) => {
  const marketplace = await buildMarketplaceApp(overrides);
  const agent = await buildAgentApp({
    acp: createInjectAcpClient(marketplace.app),
    resetMarketplace: async () => {
      const response = await marketplace.app.inject({ method: "POST", url: "/api/demo/reset" });
      if (response.statusCode >= 400) throw new Error("Unable to reset marketplace demo state.");
    },
  });
  return { marketplace, agent };
};
