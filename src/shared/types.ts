export type PurchaseMode = "weekly_replenishment" | "urgent_replenishment";
export type CheckoutStatus = "ready_for_payment" | "requires_approval" | "completed" | "canceled" | "payment_failed";
export type PolicyOutcome = "approved" | "escalated" | "denied";

export interface CartItem {
  productId: string;
  name: string;
  unitAmount: number;
  quantity: number;
  substitutionAccepted: boolean;
}

export interface Checkout {
  id: string;
  mode: PurchaseMode;
  seller: "GreenMart";
  currency: "usd";
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryWindow: string;
  status: CheckoutStatus;
  createdAt: string;
  updatedAt: string;
  paymentIntentId?: string;
  orderId?: string;
}

export interface PolicyDecision {
  outcome: PolicyOutcome;
  reasons: string[];
  approvedMaximum?: number;
}

export interface SpendRequest {
  id: string;
  checkoutId: string;
  seller: "GreenMart";
  amount: number;
  currency: "usd";
  expiresAt: string;
  policy: PolicyDecision;
  status: "pending" | "approved" | "expired" | "revoked";
  sharedPaymentToken?: string;
}

export interface PaymentResult {
  id: string;
  status: "succeeded" | "requires_action" | "failed";
  simulated: boolean;
}

export interface AuditEvent {
  id: string;
  type: string;
  at: string;
  detail: string;
}
