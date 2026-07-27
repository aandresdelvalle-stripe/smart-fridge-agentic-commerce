import cors from "@fastify/cors";
import rawBody from "fastify-raw-body";
import Fastify from "fastify";
import { z } from "zod";
import { AuditLog } from "../audit-log.js";
import { CheckoutStore } from "./checkout-store.js";
import { registerAcpSellerRoutes, type AcpSellerDependencies } from "./acp/routes.js";
import { registerMarketplaceRoutes, type MarketplaceDependencies } from "./routes.js";
import { StripePaymentGateway, type PaymentGateway } from "./stripe/payment.js";
import { StripeWebhookHandler } from "./stripe/webhooks.js";

export const buildMarketplaceApp = async (overrides: Partial<Pick<AcpSellerDependencies, "payments">> = {}) => {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", issues: error.issues });
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Unexpected error." });
  });

  const auditLog = new AuditLog();
  const checkouts = new CheckoutStore();
  const acpDependencies: AcpSellerDependencies = {
    checkouts,
    payments: overrides.payments ?? new StripePaymentGateway(),
    auditLog,
  };
  const marketplaceDependencies: MarketplaceDependencies = { checkouts, auditLog };

  await app.register(async (acpApp) => {
    await registerAcpSellerRoutes(acpApp, acpDependencies);
  }, { prefix: "/acp" });
  await registerMarketplaceRoutes(app, marketplaceDependencies);

  const webhookHandler = new StripeWebhookHandler(auditLog);
  app.post("/api/demo/reset", async () => {
    checkouts.clear();
    auditLog.clear();
    webhookHandler.clear();
    return { ok: true };
  });

  app.post("/webhooks/stripe", { config: { rawBody: true } }, async (request, reply) => {
    const rawBodyValue = request.rawBody;
    const raw = Buffer.isBuffer(rawBodyValue) ? rawBodyValue : Buffer.from(JSON.stringify(request.body));
    const header = request.headers["stripe-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    const result = webhookHandler.handle(raw, signature);
    return reply.code(result.duplicate ? 200 : 202).send({ received: true, ...result });
  });

  return { app, dependencies: acpDependencies };
};

export type MarketplacePaymentGateway = PaymentGateway;
