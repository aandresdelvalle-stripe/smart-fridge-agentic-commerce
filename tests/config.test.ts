import { afterEach, describe, expect, it } from "vitest";
import { buildTestStack } from "./helpers/test-apps.js";

describe("public app config", () => {
  const stacks: Array<Awaited<ReturnType<typeof buildTestStack>>> = [];
  afterEach(async () => {
    await Promise.all(stacks.splice(0).flatMap(({ agent, marketplace }) => [agent.app.close(), marketplace.app.close()]));
  });

  it("reports demo mode from the environment", async () => {
    const stack = await buildTestStack();
    stacks.push(stack);
    const response = await stack.agent.app.inject({ method: "GET", url: "/api/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ demoMode: true, stripePublishableKey: null, savedPaymentAuthority: false });
  });
});
