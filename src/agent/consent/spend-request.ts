import { randomUUID } from "node:crypto";
import type { Checkout, PolicyDecision, SpendRequest } from "../../shared/types.js";

/**
 * Models the household-facing authorization handoff. The local approval route is
 * a development simulation; production must use a supported wallet/provider.
 */
export class SpendRequestStore {
  private readonly requests = new Map<string, SpendRequest>();

  create(checkout: Checkout, policy: PolicyDecision): SpendRequest {
    if (policy.outcome !== "approved") throw new Error("A payment request cannot be created before policy approval.");
    const request: SpendRequest = {
      id: `spr_${randomUUID()}`,
      checkoutId: checkout.id,
      seller: "GreenMart",
      amount: checkout.total,
      currency: checkout.currency,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      policy,
      status: "pending",
    };
    this.requests.set(request.id, request);
    return request;
  }

  get(id: string): SpendRequest {
    const request = this.requests.get(id);
    if (!request) throw new Error("Unknown spend request.");
    if (request.status === "pending" && new Date(request.expiresAt) <= new Date()) request.status = "expired";
    return request;
  }

  approveSimulation(id: string): SpendRequest {
    const request = this.get(id);
    if (request.status !== "pending") throw new Error(`Spend request is ${request.status}.`);
    request.status = "approved";
    request.sharedPaymentToken = `spt_demo_${randomUUID()}`;
    return request;
  }

  approveWithGrantedToken(id: string, sharedPaymentToken: string): SpendRequest {
    const request = this.get(id);
    if (request.status !== "pending") throw new Error(`Spend request is ${request.status}.`);
    if (!sharedPaymentToken.startsWith("spt_") || sharedPaymentToken.startsWith("spt_demo_")) {
      throw new Error("A real Shared Payment Token issued by an agent or Stripe test helper is required.");
    }
    request.status = "approved";
    request.sharedPaymentToken = sharedPaymentToken;
    return request;
  }

  revoke(id: string): SpendRequest {
    const request = this.get(id);
    request.status = "revoked";
    request.sharedPaymentToken = undefined;
    return request;
  }

  forCheckout(checkoutId: string): SpendRequest | undefined {
    return [...this.requests.values()].find((request) => request.checkoutId === checkoutId);
  }

  list(): SpendRequest[] {
    return [...this.requests.values()];
  }
}
