import type { FastifyInstance } from "fastify";
import type { Checkout, CheckoutStatus } from "../shared/types.js";
import type { CreateCheckoutInput, UpdateCheckoutInput } from "../marketplace/checkout-store.js";

export interface MarketplaceFlow {
  checkouts: Checkout[];
  auditEvents: Array<{ id: string; type: string; at: string; detail: string }>;
  developmentSimulation: boolean;
}

export interface MarketplaceClient {
  getConfig(): Promise<{ sellerNetworkProfile: string | null }>;
  getFlow(): Promise<MarketplaceFlow>;
  getCheckout(checkoutId: string): Promise<Checkout>;
  createCheckout(input: CreateCheckoutInput): Promise<Checkout>;
  updateCheckoutStatus(checkoutId: string, status: CheckoutStatus): Promise<Checkout>;
  completeCheckout(checkoutId: string, input: { idempotencyKey: string; sharedPaymentToken: string }): Promise<{ checkout: Checkout; payment: { id?: string; status: string; simulated: boolean } }>;
}

const readJson = async <T>(response: Response): Promise<T> => {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Marketplace request failed.");
  return body;
};

export class HttpMarketplaceClient implements MarketplaceClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async getConfig(): Promise<{ sellerNetworkProfile: string | null }> {
    const response = await fetch(this.url("/api/config"));
    return readJson(response);
  }

  async getFlow(): Promise<MarketplaceFlow> {
    const response = await fetch(this.url("/api/flow"));
    return readJson(response);
  }

  async getCheckout(checkoutId: string): Promise<Checkout> {
    const response = await fetch(this.url(`/api/checkouts/${checkoutId}`));
    return readJson(response);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
    const response = await fetch(this.url("/api/checkouts"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return readJson(response);
  }

  async updateCheckoutStatus(checkoutId: string, status: CheckoutStatus): Promise<Checkout> {
    const response = await fetch(this.url(`/api/checkouts/${checkoutId}/status`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return readJson(response);
  }

  async completeCheckout(checkoutId: string, input: { idempotencyKey: string; sharedPaymentToken: string }) {
    const response = await fetch(this.url(`/api/checkouts/${checkoutId}/complete`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return readJson<{ checkout: Checkout; payment: { id?: string; status: string; simulated: boolean } }>(response);
  }
}

export const createInjectMarketplaceClient = (app: FastifyInstance): MarketplaceClient => ({
  async getConfig() {
    const response = await app.inject({ method: "GET", url: "/api/config" });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Marketplace config failed.");
    return response.json();
  },
  async getFlow() {
    const response = await app.inject({ method: "GET", url: "/api/flow" });
    if (response.statusCode >= 400) throw new Error("Marketplace flow failed.");
    return response.json();
  },
  async getCheckout(checkoutId: string) {
    const response = await app.inject({ method: "GET", url: `/api/checkouts/${checkoutId}` });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Unknown checkout.");
    return response.json();
  },
  async createCheckout(input) {
    const response = await app.inject({ method: "POST", url: "/api/checkouts", payload: input });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Checkout creation failed.");
    return response.json();
  },
  async updateCheckoutStatus(checkoutId, status) {
    const response = await app.inject({ method: "PATCH", url: `/api/checkouts/${checkoutId}/status`, payload: { status } });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Checkout status update failed.");
    return response.json();
  },
  async completeCheckout(checkoutId, input) {
    const response = await app.inject({ method: "POST", url: `/api/checkouts/${checkoutId}/complete`, payload: input });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Checkout completion failed.");
    return response.json();
  },
});

export const createMarketplaceClient = (): MarketplaceClient => {
  const baseUrl = process.env.MARKETPLACE_URL?.trim() || "http://localhost:4242";
  return new HttpMarketplaceClient(baseUrl);
};
