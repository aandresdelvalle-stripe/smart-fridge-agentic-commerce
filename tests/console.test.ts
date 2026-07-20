import { afterEach, describe, expect, it } from "vitest";
import { buildTestStack } from "./helpers/test-apps.js";

describe("developer console flow invariants", () => {
  const stacks: Array<Awaited<ReturnType<typeof buildTestStack>>> = [];
  afterEach(async () => {
    await Promise.all(stacks.splice(0).flatMap(({ agent, marketplace }) => [agent.app.close(), marketplace.app.close()]));
  });

  it("exposes distinct policy and payment-authorization stages", async () => {
    const stack = await buildTestStack();
    stacks.push(stack);
    const started = await stack.agent.app.inject({ method: "POST", url: "/api/demo/start", payload: { mode: "urgent_replenishment" } });
    const flow = started.json<{ spendRequest: { id: string; status: string; policy: { outcome: string } }; checkouts: Array<{ paymentIntentId?: string }> }>();
    expect(flow.spendRequest.policy.outcome).toBe("approved");
    expect(flow.spendRequest.status).toBe("pending");
    expect(flow.checkouts[0]?.paymentIntentId).toBeUndefined();

    await stack.agent.app.inject({ method: "POST", url: `/api/spend-requests/${flow.spendRequest.id}/approve` });
    const refreshed = await stack.agent.app.inject({ method: "GET", url: "/api/flow" });
    const currentFlow = refreshed.json<{ spendRequests: Array<{ status: string }>; checkouts: Array<{ paymentIntentId?: string }> }>();
    expect(currentFlow.spendRequests[0]).toMatchObject({ status: "approved" });
    expect(currentFlow.checkouts[0]?.paymentIntentId).toBeUndefined();
  });

  it("handles a duplicate webhook delivery idempotently", async () => {
    const stack = await buildTestStack();
    stacks.push(stack);
    const payload = JSON.stringify({ id: "evt_duplicate", type: "payment_intent.succeeded", object: "event" });
    const first = await stack.marketplace.app.inject({ method: "POST", url: "/webhooks/stripe", payload, headers: { "content-type": "application/json" } });
    const second = await stack.marketplace.app.inject({ method: "POST", url: "/webhooks/stripe", payload, headers: { "content-type": "application/json" } });
    expect(first.statusCode).toBe(202);
    expect(second.json()).toMatchObject({ duplicate: true });
  });
});
