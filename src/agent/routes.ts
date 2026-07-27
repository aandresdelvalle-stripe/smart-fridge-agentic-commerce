import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eventForMode } from "./fridge/inventory.js";
import { evaluateCheckout } from "./policy/evaluate-checkout.js";
import type { AuditLog } from "../audit-log.js";
import { SpendRequestStore } from "./consent/spend-request.js";
import { issueSharedPaymentToken, retrieveIssuedSharedPaymentToken } from "./stripe/issue-token.js";
import { assertGrantedTokenMatchesCheckout } from "../marketplace/stripe/granted-token.js";
import { isDemoMode } from "./stripe/client.js";
import { getAgentPublicConfig, getHouseholdPaymentMethod } from "./stripe/public-config.js";
import type { AcpClient } from "./acp/client.js";
import { isStripeAcsMode } from "./acp/mode.js";
import { confirmStripeAcsPayment, finalizeStripeAcsPayment, StripeAcpClient } from "./acp/stripe-client.js";

const modeSchema = z.enum(["weekly_replenishment", "urgent_replenishment"]);

export interface AgentDependencies {
  spendRequests: SpendRequestStore;
  acp: AcpClient;
  auditLog: AuditLog;
  resetMarketplace: () => Promise<void>;
}

const requireStripeAcpClient = (acp: AcpClient): StripeAcpClient => {
  if (!(acp instanceof StripeAcpClient)) throw new Error("ACS_MODE=stripe requires the Stripe Delegated Checkout ACP client.");
  return acp;
};

const issueAuthorization = async (
  spendRequestId: string,
  paymentMethodId: string,
  dependencies: AgentDependencies,
  approvedAuditMessage: string,
) => {
  const spendRequest = dependencies.spendRequests.get(spendRequestId);
  if (spendRequest.status !== "pending") throw new Error(`Spend request is ${spendRequest.status}.`);

  if (isStripeAcsMode()) {
    const stripeAcp = requireStripeAcpClient(dependencies.acp);
    const authorization = await confirmStripeAcsPayment(spendRequest.checkoutId, paymentMethodId, stripeAcp);
    dependencies.auditLog.record("payment_authorization.requested", `Confirmed delegated checkout ${spendRequest.checkoutId} with status ${authorization.status}.`);

    if (authorization.status === "requires_action") {
      return {
        status: "requires_action" as const,
        issuedTokenId: authorization.issuedTokenId,
        nextAction: authorization.nextAction,
      };
    }

    const tokenId = authorization.sharedPaymentToken;
    if (!tokenId) throw new Error("Stripe did not return a Shared Payment Token for this delegated checkout.");
    const approved = dependencies.spendRequests.approveWithGrantedToken(spendRequestId, tokenId);
    dependencies.auditLog.record("payment_authorization.approved", approvedAuditMessage.replace("{token}", tokenId).replace("{seller}", approved.seller));
    return { status: "approved" as const, spendRequest: approved };
  }

  const checkout = await dependencies.acp.getCheckout(spendRequest.checkoutId);
  const issuedToken = await issueSharedPaymentToken(checkout, spendRequest, paymentMethodId);
  dependencies.auditLog.record("payment_authorization.requested", `Issued SPT ${issuedToken.id} for ${spendRequest.seller} with status ${issuedToken.status}.`);

  if (issuedToken.status === "requires_action") {
    return {
      status: "requires_action" as const,
      issuedTokenId: issuedToken.id,
      nextAction: issuedToken.nextAction,
    };
  }

  if (issuedToken.status !== "active") throw new Error(`Issued SPT is ${issuedToken.status}.`);

  const approved = dependencies.spendRequests.approveWithGrantedToken(spendRequestId, issuedToken.id);
  dependencies.auditLog.record("payment_authorization.approved", approvedAuditMessage.replace("{token}", issuedToken.id).replace("{seller}", approved.seller));
  return { status: "approved" as const, spendRequest: approved };
};

export const registerAgentRoutes = async (app: FastifyInstance, dependencies: AgentDependencies): Promise<void> => {
  app.get("/api/health", async () => ({ ok: true, service: "agent", demoMode: isDemoMode(), acsMode: dependencies.acp.mode ?? "local" }));

  app.get("/api/config", async () => {
    const sellerConfig = isDemoMode() ? { sellerNetworkProfile: null } : await dependencies.acp.getSellerConfig();
    return getAgentPublicConfig(sellerConfig.sellerNetworkProfile);
  });

  app.get("/api/flow", async () => {
    const sellerFlow = await dependencies.acp.getSellerFlow();
    const auditEvents = [...dependencies.auditLog.list(), ...sellerFlow.auditEvents]
      .sort((left, right) => left.at.localeCompare(right.at));
    return {
      checkouts: sellerFlow.checkouts,
      spendRequests: dependencies.spendRequests.list(),
      auditEvents,
      developmentSimulation: isDemoMode(),
    };
  });

  app.post("/api/demo/start", async (request, reply) => {
    const { mode } = z.object({ mode: modeSchema }).parse(request.body);
    const event = eventForMode(mode);
    dependencies.auditLog.record("fridge.inventory_detected", event.description);

    const checkout = await dependencies.acp.createCheckout({ mode, items: event.cart });
    dependencies.auditLog.record("acp.checkout_created", `GreenMart ACS returned final checkout ${checkout.id} for $${(checkout.total / 100).toFixed(2)}.`);

    const policy = evaluateCheckout(checkout);
    dependencies.auditLog.record(`policy.${policy.outcome}`, policy.reasons.join(" "));

    if (policy.outcome !== "approved") {
      await dependencies.acp.updateCheckoutStatus(checkout.id, policy.outcome === "escalated" ? "requires_approval" : "payment_failed");
      const flow = await app.inject({ method: "GET", url: "/api/flow" });
      const flowBody = flow.json<{ checkouts: unknown[]; spendRequests: unknown[]; auditEvents: unknown[]; developmentSimulation: boolean }>();
      return reply.code(409).send({ event, checkout, policy, ...flowBody });
    }

    const spendRequest = dependencies.spendRequests.create(checkout, policy);
    await dependencies.acp.updateCheckoutStatus(checkout.id, "requires_approval");
    dependencies.auditLog.record("payment_authorization.requested", `Household payment authorization requested for GreenMart, expiring ${spendRequest.expiresAt}.`);

    const flow = await app.inject({ method: "GET", url: "/api/flow" });
    const flowBody = flow.json<{ checkouts: unknown[]; spendRequests: unknown[]; auditEvents: unknown[]; developmentSimulation: boolean }>();
    return { event, checkout, policy, spendRequest, ...flowBody };
  });

  app.post("/api/demo/reset", async () => {
    dependencies.spendRequests.clear();
    dependencies.auditLog.clear();
    if (dependencies.acp instanceof StripeAcpClient) dependencies.acp.reset();
    await dependencies.resetMarketplace();
    const flow = await app.inject({ method: "GET", url: "/api/flow" });
    return flow.json();
  });

  app.post("/api/spend-requests/:spendRequestId/approve", async (request, reply) => {
    if (!isDemoMode()) {
      return reply.code(403).send({ error: "Simulation approve is only available when DEMO_MODE=true. Use the household wallet to issue an SPT." });
    }
    const { spendRequestId } = z.object({ spendRequestId: z.string() }).parse(request.params);
    const spendRequest = dependencies.spendRequests.approveSimulation(spendRequestId);
    dependencies.auditLog.record("payment_authorization.approved", `Development simulation issued an SPT for ${spendRequest.seller}.`);
    return spendRequest;
  });

  app.post("/api/spend-requests/:spendRequestId/authorize", async (request, reply) => {
    if (isDemoMode()) return reply.code(403).send({ error: "Household wallet authorization is available only when DEMO_MODE=false." });
    const { spendRequestId } = z.object({ spendRequestId: z.string() }).parse(request.params);
    const { paymentMethodId } = z.object({ paymentMethodId: z.string().min(1) }).parse(request.body);
    try {
      return await issueAuthorization(spendRequestId, paymentMethodId, dependencies, "Household wallet issued SPT {token} for {seller}.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authorization failed.";
      if (message.startsWith("Spend request is") || message.startsWith("Issued SPT is")) return reply.code(409).send({ error: message });
      throw error;
    }
  });

  app.post("/api/spend-requests/:spendRequestId/authorize-saved", async (request, reply) => {
    if (isDemoMode()) return reply.code(403).send({ error: "Household wallet authorization is available only when DEMO_MODE=false." });
    const paymentMethodId = getHouseholdPaymentMethod();
    if (!paymentMethodId) return reply.code(400).send({ error: "Set HOUSEHOLD_PAYMENT_METHOD in .env to authorize with a saved payment method." });
    const { spendRequestId } = z.object({ spendRequestId: z.string() }).parse(request.params);
    try {
      return await issueAuthorization(spendRequestId, paymentMethodId, dependencies, "Household wallet reused saved payment method and issued SPT {token} for {seller}.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authorization failed.";
      if (message.startsWith("Spend request is") || message.startsWith("Issued SPT is")) return reply.code(409).send({ error: message });
      throw error;
    }
  });

  app.post("/api/spend-requests/:spendRequestId/finalize-authorization", async (request, reply) => {
    if (isDemoMode()) return reply.code(403).send({ error: "Household wallet authorization is available only when DEMO_MODE=false." });
    const { spendRequestId } = z.object({ spendRequestId: z.string() }).parse(request.params);
    const { issuedTokenId } = z.object({ issuedTokenId: z.string().min(1) }).parse(request.body);
    const spendRequest = dependencies.spendRequests.get(spendRequestId);
    if (spendRequest.status !== "pending") return reply.code(409).send({ error: `Spend request is ${spendRequest.status}.` });

    if (isStripeAcsMode()) {
      try {
        const stripeAcp = requireStripeAcpClient(dependencies.acp);
        const authorization = await finalizeStripeAcsPayment(spendRequest.checkoutId, stripeAcp);
        const approved = dependencies.spendRequests.approveWithGrantedToken(spendRequestId, authorization.sharedPaymentToken!);
        dependencies.auditLog.record("payment_authorization.approved", `Household wallet finalized delegated checkout SPT ${issuedTokenId} for ${approved.seller}.`);
        return { status: "approved", spendRequest: approved };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Authorization could not be finalized.";
        return reply.code(409).send({ error: message });
      }
    }

    const checkout = await dependencies.acp.getCheckout(spendRequest.checkoutId);
    const issuedToken = await retrieveIssuedSharedPaymentToken(issuedTokenId);
    if (issuedToken.status !== "active") return reply.code(409).send({ error: `Issued SPT is ${issuedToken.status}.`, status: issuedToken.status });

    assertGrantedTokenMatchesCheckout(issuedToken, checkout);
    const approved = dependencies.spendRequests.approveWithGrantedToken(spendRequestId, issuedToken.id);
    dependencies.auditLog.record("payment_authorization.approved", `Household wallet finalized SPT ${issuedToken.id} for ${approved.seller}.`);
    return { status: "approved", spendRequest: approved };
  });

  app.post("/api/checkouts/:checkoutId/complete", async (request, reply) => {
    const { checkoutId } = z.object({ checkoutId: z.string() }).parse(request.params);
    const { idempotencyKey } = z.object({ idempotencyKey: z.string().min(1) }).parse(request.body);
    const spendRequest = dependencies.spendRequests.forCheckout(checkoutId);
    if (!spendRequest || spendRequest.status !== "approved" || !spendRequest.sharedPaymentToken) {
      return reply.code(409).send({ error: "Policy approval and household payment authorization are both required before payment." });
    }

    try {
      const result = await dependencies.acp.completeCheckout(checkoutId, {
        idempotencyKey,
        sharedPaymentToken: spendRequest.sharedPaymentToken,
      });
      dependencies.auditLog.record("acp.checkout_completed", `GreenMart ACS confirmed order ${result.checkout.orderId ?? checkoutId}.`);
      return result;
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "ACP checkout completion failed." });
    }
  });
};
