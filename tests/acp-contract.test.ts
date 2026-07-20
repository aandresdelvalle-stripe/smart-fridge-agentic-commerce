import { afterEach, describe, expect, it } from "vitest";
import { buildMarketplaceApp } from "../src/marketplace/app.js";

describe("ACP seller checkout surface", () => {
  const apps: Array<Awaited<ReturnType<typeof buildMarketplaceApp>>["app"]> = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it("creates a structured checkout and returns a final total", async () => {
    const built = await buildMarketplaceApp();
    apps.push(built.app);
    const response = await built.app.inject({ method: "POST", url: "/api/checkouts", payload: { mode: "urgent_replenishment", items: [{ productId: "gm_milk_organic_2l", quantity: 1, substitutionAccepted: false }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ seller: "GreenMart", currency: "usd", status: "ready_for_payment", total: 948 });
  });

  it("updates a checkout before payment authority is requested", async () => {
    const built = await buildMarketplaceApp();
    apps.push(built.app);
    const created = await built.app.inject({ method: "POST", url: "/api/checkouts", payload: { mode: "weekly_replenishment", items: [{ productId: "gm_milk_organic_2l", quantity: 1, substitutionAccepted: true }] } });
    const { id } = created.json<{ id: string }>();
    const response = await built.app.inject({ method: "PATCH", url: `/api/checkouts/${id}`, payload: { deliveryWindow: "2026-07-18T11:00:00+02:00/2026-07-18T13:00:00+02:00" } });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ deliveryWindow: string }>().deliveryWindow).toContain("11:00:00");
  });

  it("rejects invalid checkout payloads", async () => {
    const built = await buildMarketplaceApp();
    apps.push(built.app);
    const response = await built.app.inject({ method: "POST", url: "/api/checkouts", payload: { mode: "urgent_replenishment", items: [] } });
    expect(response.statusCode).toBe(400);
  });
});
