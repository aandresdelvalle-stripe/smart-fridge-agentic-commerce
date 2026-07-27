import type { FastifyInstance } from "fastify";
import type { Checkout, CheckoutStatus } from "../../shared/types.js";
import type { CreateCheckoutInput } from "../../marketplace/checkout-store.js";

export interface AcpSellerFlow {
  checkouts: Checkout[];
  auditEvents: Array<{ id: string; type: string; at: string; detail: string }>;
  developmentSimulation: boolean;
}

/** ACP client used by the shopping agent to reach GreenMart's ACS-exposed seller surface. */
export interface AcpClient {
  readonly mode?: "local" | "stripe";
  getSellerConfig(): Promise<{ sellerNetworkProfile: string | null; acpBaseUrl?: string }>;
  getSellerFlow(): Promise<AcpSellerFlow>;
  getCheckout(checkoutId: string): Promise<Checkout>;
  createCheckout(input: CreateCheckoutInput): Promise<Checkout>;
  updateCheckoutStatus(checkoutId: string, status: CheckoutStatus): Promise<Checkout>;
  completeCheckout(checkoutId: string, input: { idempotencyKey: string; sharedPaymentToken: string }): Promise<{ checkout: Checkout; payment: { id?: string; status: string; simulated: boolean } }>;
}

const readJson = async <T>(response: Response): Promise<T> => {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "ACP seller request failed.");
  return body;
};

export class HttpAcpClient implements AcpClient {
  readonly mode = "local" as const;

  constructor(private readonly marketplaceBaseUrl: string) {}

  private url(path: string): string {
    return `${this.marketplaceBaseUrl.replace(/\/$/, "")}${path}`;
  }

  async getSellerConfig(): Promise<{ sellerNetworkProfile: string | null; acpBaseUrl?: string }> {
    const response = await fetch(this.url("/api/config"));
    const config = await readJson<{ sellerNetworkProfile: string | null; acpBaseUrl: string }>(response);
    return { sellerNetworkProfile: config.sellerNetworkProfile, acpBaseUrl: config.acpBaseUrl };
  }

  async getSellerFlow(): Promise<AcpSellerFlow> {
    const response = await fetch(this.url("/api/flow"));
    return readJson(response);
  }

  async getCheckout(checkoutId: string): Promise<Checkout> {
    const response = await fetch(this.url(`/acp/checkouts/${checkoutId}`));
    return readJson(response);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
    const response = await fetch(this.url("/acp/checkouts"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return readJson(response);
  }

  async updateCheckoutStatus(checkoutId: string, status: CheckoutStatus): Promise<Checkout> {
    const response = await fetch(this.url(`/acp/checkouts/${checkoutId}/status`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return readJson(response);
  }

  async completeCheckout(checkoutId: string, input: { idempotencyKey: string; sharedPaymentToken: string }) {
    const response = await fetch(this.url(`/acp/checkouts/${checkoutId}/complete`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return readJson<{ checkout: Checkout; payment: { id?: string; status: string; simulated: boolean } }>(response);
  }
}

export const createInjectAcpClient = (app: FastifyInstance): AcpClient => ({
  async getSellerConfig() {
    const response = await app.inject({ method: "GET", url: "/api/config" });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "ACS seller config failed.");
    const config = response.json<{ sellerNetworkProfile: string | null; acpBaseUrl: string }>();
    return { sellerNetworkProfile: config.sellerNetworkProfile, acpBaseUrl: config.acpBaseUrl };
  },
  async getSellerFlow() {
    const response = await app.inject({ method: "GET", url: "/api/flow" });
    if (response.statusCode >= 400) throw new Error("ACS seller flow failed.");
    return response.json();
  },
  async getCheckout(checkoutId: string) {
    const response = await app.inject({ method: "GET", url: `/acp/checkouts/${checkoutId}` });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Unknown checkout.");
    return response.json();
  },
  async createCheckout(input) {
    const response = await app.inject({ method: "POST", url: "/acp/checkouts", payload: input });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Checkout creation failed.");
    return response.json();
  },
  async updateCheckoutStatus(checkoutId, status) {
    const response = await app.inject({ method: "PATCH", url: `/acp/checkouts/${checkoutId}/status`, payload: { status } });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Checkout status update failed.");
    return response.json();
  },
  async completeCheckout(checkoutId, input) {
    const response = await app.inject({ method: "POST", url: `/acp/checkouts/${checkoutId}/complete`, payload: input });
    if (response.statusCode >= 400) throw new Error(JSON.parse(response.body).error ?? "Checkout completion failed.");
    return response.json();
  },
});

import { getAcsMode, isStripeAcsMode } from "./mode.js";
import { StripeAcpClient } from "./stripe-client.js";

export const createAcpClient = (): AcpClient => {
  if (isStripeAcsMode()) return new StripeAcpClient();
  const baseUrl = process.env.MARKETPLACE_URL?.trim() || "http://localhost:4242";
  return new HttpAcpClient(baseUrl);
};

export { getAcsMode, isStripeAcsMode };
