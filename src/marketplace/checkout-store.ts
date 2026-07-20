import { randomUUID } from "node:crypto";
import { deliveryWindows, findProduct } from "../shared/catalog/greenmart-catalog.js";
import type { CartItem, Checkout, CheckoutStatus, PurchaseMode } from "../shared/types.js";

export interface CreateCheckoutInput {
  mode: PurchaseMode;
  items: Array<Pick<CartItem, "productId" | "quantity" | "substitutionAccepted">>;
  deliveryWindow?: string;
}

export type UpdateCheckoutInput = Partial<CreateCheckoutInput>;

export class CheckoutStore {
  private readonly checkouts = new Map<string, Checkout>();
  private readonly completions = new Map<string, Checkout>();

  create(input: CreateCheckoutInput): Checkout {
    if (!input.items.length) throw new Error("A checkout must contain at least one item.");
    const items: CartItem[] = input.items.map((item) => {
      const product = findProduct(item.productId);
      if (!product.inStock) throw new Error(`${product.name} is out of stock.`);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error("Quantity must be a positive integer.");
      return { productId: product.id, name: product.name, unitAmount: product.unitAmount, quantity: item.quantity, substitutionAccepted: item.substitutionAccepted };
    });
    const subtotal = items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
    const deliveryFee = input.mode === "weekly_replenishment" ? 699 : 499;
    const now = new Date().toISOString();
    const checkout: Checkout = {
      id: `chk_greenmart_${randomUUID()}`,
      mode: input.mode,
      seller: "GreenMart",
      currency: "usd",
      items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      deliveryWindow: input.deliveryWindow ?? deliveryWindows[input.mode === "weekly_replenishment" ? "weekly" : "urgent"],
      status: "ready_for_payment",
      createdAt: now,
      updatedAt: now,
    };
    this.checkouts.set(checkout.id, checkout);
    return checkout;
  }

  get(id: string): Checkout {
    const checkout = this.checkouts.get(id);
    if (!checkout) throw new Error("Unknown checkout.");
    return checkout;
  }

  update(id: string, input: UpdateCheckoutInput): Checkout {
    const checkout = this.get(id);
    if (checkout.status === "completed" || checkout.status === "canceled") throw new Error("A completed or canceled checkout cannot be updated.");
    const mode = input.mode ?? checkout.mode;
    const items = input.items ? input.items.map((item) => {
      const product = findProduct(item.productId);
      if (!product.inStock || !Number.isInteger(item.quantity) || item.quantity < 1) throw new Error("Updated checkout contains an unavailable or invalid item.");
      return { productId: product.id, name: product.name, unitAmount: product.unitAmount, quantity: item.quantity, substitutionAccepted: item.substitutionAccepted };
    }) : checkout.items;
    if (!items.length) throw new Error("A checkout must contain at least one item.");
    const subtotal = items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
    checkout.mode = mode;
    checkout.items = items;
    checkout.subtotal = subtotal;
    checkout.deliveryFee = mode === "weekly_replenishment" ? 699 : 499;
    checkout.total = checkout.subtotal + checkout.deliveryFee;
    checkout.deliveryWindow = input.deliveryWindow ?? checkout.deliveryWindow;
    checkout.status = "ready_for_payment";
    checkout.updatedAt = new Date().toISOString();
    return checkout;
  }

  setStatus(id: string, status: CheckoutStatus): Checkout {
    const checkout = this.get(id);
    checkout.status = status;
    checkout.updatedAt = new Date().toISOString();
    return checkout;
  }

  completedFor(idempotencyKey: string): Checkout | undefined {
    return this.completions.get(idempotencyKey);
  }

  complete(id: string, idempotencyKey: string, paymentIntentId: string): Checkout {
    const replay = this.completedFor(idempotencyKey);
    if (replay) return replay;
    const checkout = this.get(id);
    if (checkout.status === "completed") return checkout;
    checkout.status = "completed";
    checkout.paymentIntentId = paymentIntentId;
    checkout.orderId = `ord_greenmart_${randomUUID()}`;
    checkout.updatedAt = new Date().toISOString();
    this.completions.set(idempotencyKey, checkout);
    return checkout;
  }

  cancel(id: string): Checkout {
    return this.setStatus(id, "canceled");
  }

  list(): Checkout[] {
    return [...this.checkouts.values()];
  }
}
