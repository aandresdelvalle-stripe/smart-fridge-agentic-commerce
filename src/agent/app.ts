import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { AuditLog } from "../audit-log.js";
import { SpendRequestStore } from "./consent/spend-request.js";
import { createMarketplaceClient, type MarketplaceClient } from "./marketplace-client.js";
import { registerAgentRoutes, type AgentDependencies } from "./routes.js";

export interface BuildAgentAppOptions {
  marketplace?: MarketplaceClient;
}

export const buildAgentApp = async (options: BuildAgentAppOptions = {}) => {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", issues: error.issues });
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Unexpected error." });
  });

  const auditLog = new AuditLog();
  const dependencies: AgentDependencies = {
    spendRequests: new SpendRequestStore(),
    marketplace: options.marketplace ?? createMarketplaceClient(),
    auditLog,
  };
  await registerAgentRoutes(app, dependencies);

  return { app, dependencies };
};
