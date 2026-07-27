import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { AuditLog } from "../audit-log.js";
import { SpendRequestStore } from "./consent/spend-request.js";
import { createAcpClient, type AcpClient } from "./acp/client.js";
import { isStripeAcsMode } from "./acp/mode.js";
import { registerAgentRoutes, type AgentDependencies } from "./routes.js";

export interface BuildAgentAppOptions {
  acp?: AcpClient;
  resetMarketplace?: () => Promise<void>;
}

const defaultResetMarketplace = async (): Promise<void> => {
  if (isStripeAcsMode()) return;
  const baseUrl = process.env.MARKETPLACE_URL?.trim() || "http://localhost:4242";
  const response = await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
  if (!response.ok) throw new Error("Unable to reset marketplace demo state.");
};

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
    acp: options.acp ?? createAcpClient(),
    auditLog,
    resetMarketplace: options.resetMarketplace ?? defaultResetMarketplace,
  };
  await registerAgentRoutes(app, dependencies);

  return { app, dependencies };
};
