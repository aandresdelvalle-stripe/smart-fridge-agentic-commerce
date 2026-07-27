import type { FastifyInstance } from "fastify";
import type { AuditLog } from "../audit-log.js";
import { getAcsSellerConfig } from "./acs/seller-config.js";
import { isDemoMode } from "./stripe/client.js";
import type { CheckoutStore } from "./checkout-store.js";

export interface MarketplaceDependencies {
  checkouts: CheckoutStore;
  auditLog: AuditLog;
}

/** Dev and observability routes for the GreenMart ACS seller service. */
export const registerMarketplaceRoutes = async (app: FastifyInstance, dependencies: MarketplaceDependencies): Promise<void> => {
  app.get("/api/health", async () => ({
    ok: true,
    service: "marketplace",
    integration: "agentic_commerce_suite",
    demoMode: isDemoMode(),
  }));

  app.get("/api/config", async () => getAcsSellerConfig());

  app.get("/api/flow", async () => ({
    checkouts: dependencies.checkouts.list(),
    auditEvents: dependencies.auditLog.list(),
    developmentSimulation: isDemoMode(),
  }));
};
