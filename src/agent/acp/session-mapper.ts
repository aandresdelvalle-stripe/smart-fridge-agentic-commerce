import { deliveryWindows, findProduct } from "../../shared/catalog/greenmart-catalog.js";
import type { CartItem, Checkout, CheckoutStatus, PurchaseMode } from "../../shared/types.js";
import type { CreateCheckoutInput } from "../../marketplace/checkout-store.js";

export interface RequestedSessionMetadata {
  mode: PurchaseMode;
  deliveryWindow: string;
  items: CartItem[];
  status: CheckoutStatus;
  paymentIntentId?: string;
  orderId?: string;
}

export const buildCartItems = (input: CreateCheckoutInput): CartItem[] => {
  return input.items.map((item) => {
    const product = findProduct(item.productId);
    if (!product.inStock) throw new Error(`${product.name} is out of stock.`);
    return {
      productId: product.id,
      name: product.name,
      unitAmount: product.unitAmount,
      quantity: item.quantity,
      substitutionAccepted: item.substitutionAccepted,
    };
  });
};

export const estimateTotals = (mode: PurchaseMode, items: CartItem[]) => {
  const subtotal = items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
  const deliveryFee = mode === "weekly_replenishment" ? 699 : 499;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
};

export const createSessionMetadata = (input: CreateCheckoutInput): RequestedSessionMetadata => {
  const items = buildCartItems(input);
  return {
    mode: input.mode,
    deliveryWindow: input.deliveryWindow ?? deliveryWindows[input.mode === "weekly_replenishment" ? "weekly" : "urgent"],
    items,
    status: "ready_for_payment",
  };
};

const mapSessionStatus = (sessionStatus: string | undefined, overlay: CheckoutStatus): CheckoutStatus => {
  if (sessionStatus === "complete") return "completed";
  if (sessionStatus === "expired") return "canceled";
  if (sessionStatus === "open") return overlay;
  return overlay;
};

export const mapRequestedSessionToCheckout = (
  session: Record<string, unknown>,
  metadata: RequestedSessionMetadata,
): Checkout => {
  const estimated = estimateTotals(metadata.mode, metadata.items);
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : estimated.total;
  const amountSubtotal = typeof session.amount_subtotal === "number" ? session.amount_subtotal : estimated.subtotal;
  const deliveryFee = Math.max(amountTotal - amountSubtotal, 0) || estimated.deliveryFee;
  const paymentIntent = session.payment_intent;
  const paymentIntentId = typeof paymentIntent === "string"
    ? paymentIntent
    : typeof paymentIntent === "object" && paymentIntent && "id" in paymentIntent
      ? String((paymentIntent as { id: string }).id)
      : metadata.paymentIntentId;

  return {
    id: String(session.id),
    mode: metadata.mode,
    seller: "GreenMart",
    currency: "usd",
    items: metadata.items,
    subtotal: amountSubtotal,
    deliveryFee,
    total: amountTotal,
    deliveryWindow: metadata.deliveryWindow,
    status: mapSessionStatus(typeof session.status === "string" ? session.status : undefined, metadata.status),
    createdAt: new Date(((session.created as number | undefined) ?? Date.now()) * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    paymentIntentId,
    orderId: metadata.orderId ?? (typeof session.id === "string" ? session.id : undefined),
  };
};

export const extractIssuedToken = (session: Record<string, unknown>): { id: string; status: string; nextAction?: { use_stripe_sdk?: { value: string } } } | null => {
  const issued = session.shared_payment_issued_token;
  if (!issued || typeof issued !== "object") return null;
  const token = issued as { id?: string; status?: string; next_action?: { use_stripe_sdk?: { value: string } } };
  if (!token.id?.startsWith("spt_")) return null;
  return { id: token.id, status: token.status ?? "active", nextAction: token.next_action };
};
