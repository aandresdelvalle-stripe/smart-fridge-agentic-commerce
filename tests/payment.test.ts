import { afterEach, describe, expect, it } from "vitest";
import type { PaymentGateway } from "../src/marketplace/stripe/payment.js";
import { buildTestStack } from "./helpers/test-apps.js";

const paymentGateway: PaymentGateway = { createAndConfirm: async () => ({ id: "pi_test_spt", status: "succeeded", simulated: true }) };

describe("SPT-gated payment", () => {
  const stacks: Array<Awaited<ReturnType<typeof buildTestStack>>> = [];
  afterEach(async () => {
    await Promise.all(stacks.splice(0).flatMap(({ agent, marketplace }) => [agent.app.close(), marketplace.app.close()]));
  });

  it("will not create a payment before household payment authorization", async () => {
    const stack = await buildTestStack({ payments: paymentGateway });
    stacks.push(stack);
    const created = await stack.agent.app.inject({ method: "POST", url: "/api/demo/start", payload: { mode: "urgent_replenishment" } });
    const started = created.json<{ checkout: { id: string }; spendRequest: { id: string } }>();
    const checkoutId = started.checkout.id;
    const before = await stack.agent.app.inject({ method: "POST", url: `/api/checkouts/${checkoutId}/complete`, payload: { idempotencyKey: "first" } });
    expect(before.statusCode).toBe(409);

    const requestId = started.spendRequest.id;
    await stack.agent.app.inject({ method: "POST", url: `/api/spend-requests/${requestId}/approve` });
    const completed = await stack.agent.app.inject({ method: "POST", url: `/api/checkouts/${checkoutId}/complete`, payload: { idempotencyKey: "first" } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ checkout: { status: "completed", paymentIntentId: "pi_test_spt" } });
  });

  it("rejects a revoked SPT before creating a PaymentIntent", async () => {
    const stack = await buildTestStack({ payments: paymentGateway });
    stacks.push(stack);
    const created = await stack.agent.app.inject({ method: "POST", url: "/api/demo/start", payload: { mode: "urgent_replenishment" } });
    const started = created.json<{ checkout: { id: string }; spendRequest: { id: string } }>();
    await stack.agent.app.inject({ method: "POST", url: `/api/spend-requests/${started.spendRequest.id}/approve` });
    stack.agent.dependencies.spendRequests.revoke(started.spendRequest.id);
    const response = await stack.agent.app.inject({ method: "POST", url: `/api/checkouts/${started.checkout.id}/complete`, payload: { idempotencyKey: "revoked" } });
    expect(response.statusCode).toBe(409);
  });

  it("is idempotent when completion is retried", async () => {
    let paymentCalls = 0;
    const countingGateway: PaymentGateway = { createAndConfirm: async () => { paymentCalls += 1; return { id: "pi_test_spt", status: "succeeded", simulated: true }; } };
    const stack = await buildTestStack({ payments: countingGateway });
    stacks.push(stack);
    const created = await stack.agent.app.inject({ method: "POST", url: "/api/demo/start", payload: { mode: "weekly_replenishment" } });
    const started = created.json<{ checkout: { id: string }; spendRequest: { id: string } }>();
    const checkoutId = started.checkout.id;
    const requestId = started.spendRequest.id;
    await stack.agent.app.inject({ method: "POST", url: `/api/spend-requests/${requestId}/approve` });
    const first = await stack.agent.app.inject({ method: "POST", url: `/api/checkouts/${checkoutId}/complete`, payload: { idempotencyKey: "same-request" } });
    const retry = await stack.agent.app.inject({ method: "POST", url: `/api/checkouts/${checkoutId}/complete`, payload: { idempotencyKey: "same-request" } });
    const firstBody = first.json<{ checkout: { orderId?: string } }>();
    const retryBody = retry.json<{ checkout: { orderId?: string } }>();
    expect(retryBody.checkout.orderId).toBe(firstBody.checkout.orderId);
    expect(paymentCalls).toBe(1);
  });
});
