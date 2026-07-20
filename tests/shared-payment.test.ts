import { describe, expect, it } from "vitest";
import { SpendRequestStore } from "../src/agent/consent/spend-request.js";
import { assertGrantedTokenMatchesCheckout } from "../src/marketplace/stripe/granted-token.js";
import type { Checkout } from "../src/shared/types.js";

const checkout: Checkout = {
  id: "chk_test",
  mode: "urgent_replenishment",
  seller: "GreenMart",
  currency: "usd",
  items: [],
  subtotal: 500,
  deliveryFee: 0,
  total: 500,
  deliveryWindow: "today",
  status: "requires_approval",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Shared Payment Token seller validation", () => {
  it("rejects a granted token when the checkout exceeds the usage limit", () => {
    expect(() => assertGrantedTokenMatchesCheckout({
      id: "spt_test",
      usageLimits: { currency: "usd", maxAmount: 100, expiresAt: Math.floor(Date.now() / 1000) + 3600 },
    }, checkout)).toThrow("usage limit");
  });

  it("accepts a real granted token id on the spend request", () => {
    const store = new SpendRequestStore();
    const spendRequest = store.create(checkout, { outcome: "approved", reasons: ["ok"] });
    const approved = store.approveWithGrantedToken(spendRequest.id, "spt_real_token");
    expect(approved).toMatchObject({ status: "approved", sharedPaymentToken: "spt_real_token" });
  });

  it("rejects demo tokens when attaching a granted token", () => {
    const store = new SpendRequestStore();
    const spendRequest = store.create(checkout, { outcome: "approved", reasons: ["ok"] });
    expect(() => store.approveWithGrantedToken(spendRequest.id, "spt_demo_123")).toThrow("real Shared Payment Token");
  });
});
