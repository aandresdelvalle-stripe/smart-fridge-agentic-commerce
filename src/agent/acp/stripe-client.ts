import type Stripe from "stripe";
import type { Checkout, CheckoutStatus } from "../../shared/types.js";
import type { CreateCheckoutInput } from "../../marketplace/checkout-store.js";
import { createAgentStripeClient, getGreenMartSellerProfile, isDemoMode } from "../stripe/client.js";
import { getGreenMartSellerNetworkProfile } from "../../shared/greenmart-seller-profile.js";
import { assertStripeAcsReady } from "./mode.js";
import {
  createSessionMetadata,
  extractIssuedToken,
  mapRequestedSessionToCheckout,
  type RequestedSessionMetadata,
} from "./session-mapper.js";
import type { AcpClient, AcpSellerFlow } from "./client.js";

const asSession = (payload: unknown): Record<string, unknown> => payload as Record<string, unknown>;

/** ACP client backed by Stripe Delegated Checkout (`RequestedSession`) for sandbox ACS sellers. */
export class StripeAcpClient implements AcpClient {
  readonly mode = "stripe" as const;
  private readonly sessions = new Map<string, RequestedSessionMetadata>();
  private readonly completions = new Map<string, { checkout: Checkout; payment: { id?: string; status: string; simulated: boolean } }>();

  constructor(private readonly stripe: Stripe = createAgentStripeClient()) {}

  getSessionMetadata(sessionId: string): RequestedSessionMetadata {
    const metadata = this.sessions.get(sessionId);
    if (!metadata) throw new Error("Unknown delegated checkout session.");
    return metadata;
  }

  setSessionMetadata(sessionId: string, metadata: RequestedSessionMetadata): void {
    this.sessions.set(sessionId, metadata);
  }

  private async retrieveSession(sessionId: string): Promise<Record<string, unknown>> {
    const response = await this.stripe.rawRequest("GET", `/v1/delegated_checkout/requested_sessions/${sessionId}`, {});
    return asSession(response);
  }

  async getSellerConfig() {
    assertStripeAcsReady();
    return {
      sellerNetworkProfile: getGreenMartSellerNetworkProfile(),
      acpBaseUrl: "stripe://delegated_checkout/requested_sessions",
    };
  }

  async getSellerFlow(): Promise<AcpSellerFlow> {
    const checkouts = [...this.sessions.entries()].map(([sessionId, metadata]) =>
      mapRequestedSessionToCheckout({ id: sessionId, status: metadata.status === "completed" ? "complete" : "open" }, metadata),
    );
    return { checkouts, auditEvents: [], developmentSimulation: isDemoMode() };
  }

  async getCheckout(checkoutId: string): Promise<Checkout> {
    const metadata = this.getSessionMetadata(checkoutId);
    const session = await this.retrieveSession(checkoutId);
    return mapRequestedSessionToCheckout(session, metadata);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
    assertStripeAcsReady();
    const metadata = createSessionMetadata(input);
    const params: Record<string, string | number> = {
      currency: "usd",
      "seller_details[network_profile]": getGreenMartSellerProfile(),
    };
    input.items.forEach((item, index) => {
      params[`line_item_details[${index}][sku_id]`] = item.productId;
      params[`line_item_details[${index}][quantity]`] = item.quantity;
    });

    const session = asSession(await this.stripe.rawRequest("POST", "/v1/delegated_checkout/requested_sessions", params));
    const sessionId = String(session.id);
    this.sessions.set(sessionId, metadata);
    return mapRequestedSessionToCheckout(session, metadata);
  }

  async updateCheckoutStatus(checkoutId: string, status: CheckoutStatus): Promise<Checkout> {
    const metadata = this.getSessionMetadata(checkoutId);
    metadata.status = status;
    this.sessions.set(checkoutId, metadata);
    const session = await this.retrieveSession(checkoutId);
    return mapRequestedSessionToCheckout(session, metadata);
  }

  async completeCheckout(checkoutId: string, input: { idempotencyKey: string; sharedPaymentToken: string }) {
    const replay = this.completions.get(input.idempotencyKey);
    if (replay) return replay;

    const metadata = this.getSessionMetadata(checkoutId);
    const session = await this.retrieveSession(checkoutId);
    const checkout = mapRequestedSessionToCheckout(session, metadata);
    if (checkout.status !== "completed") {
      throw new Error("Delegated checkout has not completed yet. Confirm payment authorization first.");
    }

    const result = {
      checkout,
      payment: {
        id: checkout.paymentIntentId,
        status: "succeeded",
        simulated: false,
      },
    };
    this.completions.set(input.idempotencyKey, result);
    return result;
  }

  reset(): void {
    this.sessions.clear();
    this.completions.clear();
  }
}

export interface StripeAcsAuthorizationResult {
  status: "approved" | "requires_action";
  issuedTokenId?: string;
  nextAction?: { use_stripe_sdk?: { value: string } };
  sharedPaymentToken?: string;
}

export const confirmStripeAcsPayment = async (
  checkoutId: string,
  paymentMethodId: string,
  client: StripeAcpClient,
): Promise<StripeAcsAuthorizationResult> => {
  assertStripeAcsReady();
  const stripe = createAgentStripeClient();
  const response = asSession(await stripe.rawRequest("POST", `/v1/delegated_checkout/requested_sessions/${checkoutId}/confirm`, {
    payment_method: paymentMethodId,
  }));

  const issuedToken = extractIssuedToken(response);
  if (issuedToken?.status === "requires_action") {
    return {
      status: "requires_action",
      issuedTokenId: issuedToken.id,
      nextAction: issuedToken.nextAction,
    };
  }

  const metadata = client.getSessionMetadata(checkoutId);
  metadata.status = "completed";
  metadata.paymentIntentId = typeof response.payment_intent === "string"
    ? response.payment_intent
    : typeof response.payment_intent === "object" && response.payment_intent && "id" in response.payment_intent
      ? String((response.payment_intent as { id: string }).id)
      : undefined;
  metadata.orderId = checkoutId;
  client.setSessionMetadata(checkoutId, metadata);

  const tokenId = issuedToken?.id ?? (typeof response.shared_payment_granted_token === "string" ? response.shared_payment_granted_token : undefined);
  if (!tokenId?.startsWith("spt_")) throw new Error("Stripe did not return a Shared Payment Token for this delegated checkout.");
  return { status: "approved", sharedPaymentToken: tokenId };
};

export const finalizeStripeAcsPayment = async (checkoutId: string, client: StripeAcpClient): Promise<StripeAcsAuthorizationResult> => {
  assertStripeAcsReady();
  const stripe = createAgentStripeClient();
  const response = asSession(await stripe.rawRequest("GET", `/v1/delegated_checkout/requested_sessions/${checkoutId}`, {}));
  const issuedToken = extractIssuedToken(response);
  if (!issuedToken || issuedToken.status !== "active") {
    throw new Error(`Issued SPT is ${issuedToken?.status ?? "missing"}.`);
  }

  const metadata = client.getSessionMetadata(checkoutId);
  metadata.status = "completed";
  metadata.orderId = checkoutId;
  client.setSessionMetadata(checkoutId, metadata);
  return { status: "approved", sharedPaymentToken: issuedToken.id };
};
