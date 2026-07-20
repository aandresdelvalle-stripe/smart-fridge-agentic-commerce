import { describe, expect, it } from "vitest";
import { CheckoutStore } from "../src/marketplace/checkout-store.js";
import { evaluateCheckout } from "../src/agent/policy/evaluate-checkout.js";

describe("household checkout policy", () => {
  it("approves the bounded Friday replenishment order", () => {
    const checkout = new CheckoutStore().create({
      mode: "weekly_replenishment",
      items: [{ productId: "gm_milk_organic_2l", quantity: 2, substitutionAccepted: true }, { productId: "gm_oats_1kg", quantity: 1, substitutionAccepted: true }],
    });
    expect(evaluateCheckout(checkout)).toMatchObject({ outcome: "approved", approvedMaximum: 12_000 });
  });

  it("blocks an urgent order that permits substitutions", () => {
    const checkout = new CheckoutStore().create({
      mode: "urgent_replenishment",
      items: [{ productId: "gm_milk_organic_2l", quantity: 1, substitutionAccepted: true }],
    });
    expect(evaluateCheckout(checkout)).toMatchObject({ outcome: "denied" });
    expect(evaluateCheckout(checkout).reasons).toContain("Urgent orders must not accept substitutions.");
  });

  it("blocks an urgent order with an unrelated grocery item", () => {
    const checkout = new CheckoutStore().create({
      mode: "urgent_replenishment",
      items: [{ productId: "gm_bananas_1kg", quantity: 1, substitutionAccepted: false }],
    });
    expect(evaluateCheckout(checkout).outcome).toBe("denied");
  });
});
