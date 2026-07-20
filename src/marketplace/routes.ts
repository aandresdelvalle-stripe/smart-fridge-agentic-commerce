import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { products } from "../shared/catalog/greenmart-catalog.js";
import type { AuditLog } from "../audit-log.js";
import type { PaymentGateway } from "./stripe/payment.js";
import { assertGrantedTokenMatchesCheckout, retrieveGrantedSharedPaymentToken } from "./stripe/granted-token.js";
import { isDemoMode, getSellerNetworkProfile } from "./stripe/client.js";
import { CheckoutStore } from "./checkout-store.js";
import type { CheckoutStatus } from "../shared/types.js";

const modeSchema = z.enum(["weekly_replenishment", "urgent_replenishment"]);
const cartItemSchema = z.object({ productId: z.string(), quantity: z.number().int().positive(), substitutionAccepted: z.boolean().default(false) });
const checkoutSchema = z.object({ mode: modeSchema, items: z.array(cartItemSchema).min(1), deliveryWindow: z.string().optional() });
const checkoutUpdateSchema = z.object({ mode: modeSchema.optional(), items: z.array(cartItemSchema).min(1).optional(), deliveryWindow: z.string().optional() }).refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one checkout field to update.");

export interface MarketplaceDependencies {
  checkouts: CheckoutStore;
  payments: PaymentGateway;
  auditLog: AuditLog;
}

export const registerMarketplaceRoutes = async (app: FastifyInstance, dependencies: MarketplaceDependencies): Promise<void> => {
  app.get("/api/health", async () => ({ ok: true, service: "marketplace", demoMode: isDemoMode() }));
  app.get("/api/config", async () => ({
    service: "marketplace",
    demoMode: isDemoMode(),
    sellerNetworkProfile: isDemoMode() ? null : getSellerNetworkProfile(),
  }));
  app.get("/api/catalog", async () => ({ products }));
  app.get("/api/flow", async () => ({
    checkouts: dependencies.checkouts.list(),
    auditEvents: dependencies.auditLog.list(),
    developmentSimulation: isDemoMode(),
  }));

  app.post("/api/checkouts", async (request) => {
    const input = checkoutSchema.parse(request.body);
    const checkout = dependencies.checkouts.create(input);
    dependencies.auditLog.record("acp.checkout_created", `Checkout ${checkout.id} created for $${(checkout.total / 100).toFixed(2)}.`);
    return checkout;
  });

  app.patch("/api/checkouts/:checkoutId", async (request) => {
    const { checkoutId } = z.object({ checkoutId: z.string() }).parse(request.params);
    const input = checkoutUpdateSchema.parse(request.body);
    const checkout = dependencies.checkouts.update(checkoutId, input);
    dependencies.auditLog.record("acp.checkout_updated", `Checkout ${checkout.id} was updated; its final total is now $${(checkout.total / 100).toFixed(2)}.`);
    return checkout;
  });

  app.patch("/api/checkouts/:checkoutId/status", async (request) => {
    const { checkoutId } = z.object({ checkoutId: z.string() }).parse(request.params);
    const { status } = z.object({ status: z.enum(["ready_for_payment", "requires_approval", "completed", "canceled", "payment_failed"]) satisfies z.ZodType<CheckoutStatus> }).parse(request.body);
    const checkout = dependencies.checkouts.setStatus(checkoutId, status);
    dependencies.auditLog.record("acp.checkout_status_updated", `Checkout ${checkout.id} status set to ${status}.`);
    return checkout;
  });

  app.get("/api/checkouts/:checkoutId", async (request) => {
    const { checkoutId } = z.object({ checkoutId: z.string() }).parse(request.params);
    return dependencies.checkouts.get(checkoutId);
  });

  app.post("/api/checkouts/:checkoutId/complete", async (request, reply) => {
    const { checkoutId } = z.object({ checkoutId: z.string() }).parse(request.params);
    const { idempotencyKey, sharedPaymentToken } = z.object({
      idempotencyKey: z.string().min(1),
      sharedPaymentToken: z.string().min(1),
    }).parse(request.body);

    const replay = dependencies.checkouts.completedFor(idempotencyKey);
    if (replay) return { checkout: replay, payment: { id: replay.paymentIntentId, status: "succeeded", simulated: isDemoMode() } };

    const checkout = dependencies.checkouts.get(checkoutId);
    if (checkout.status === "completed") {
      return { checkout, payment: { id: checkout.paymentIntentId, status: "succeeded", simulated: isDemoMode() } };
    }

    if (!isDemoMode()) {
      const grantedToken = await retrieveGrantedSharedPaymentToken(sharedPaymentToken);
      assertGrantedTokenMatchesCheckout(grantedToken, checkout);
    }

    const payment = await dependencies.payments.createAndConfirm(checkout, sharedPaymentToken);
    if (payment.status !== "succeeded") {
      dependencies.checkouts.setStatus(checkoutId, "payment_failed");
      dependencies.auditLog.record("payment.failed", `PaymentIntent ${payment.id} did not succeed.`);
      return reply.code(402).send({ checkout, payment });
    }

    const completed = dependencies.checkouts.complete(checkoutId, idempotencyKey, payment.id);
    dependencies.auditLog.record("acp.checkout_completed", `Order ${completed.orderId} confirmed with ${payment.id}.`);
    return { checkout: completed, payment };
  });

  app.post("/api/checkouts/:checkoutId/cancel", async (request) => {
    const { checkoutId } = z.object({ checkoutId: z.string() }).parse(request.params);
    const checkout = dependencies.checkouts.cancel(checkoutId);
    dependencies.auditLog.record("acp.checkout_canceled", `Checkout ${checkout.id} canceled.`);
    return checkout;
  });
};
