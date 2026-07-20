import type { CartItem, PurchaseMode } from "../../shared/types.js";
import { findProduct } from "../../shared/catalog/greenmart-catalog.js";

export interface FridgeEvent {
  id: string;
  mode: PurchaseMode;
  occurredAt: string;
  description: string;
  cart: CartItem[];
}

const item = (productId: string, quantity: number, substitutionAccepted: boolean): CartItem => {
  const product = findProduct(productId);
  return { productId, name: product.name, unitAmount: product.unitAmount, quantity, substitutionAccepted };
};

export const fridayReplenishmentEvent = (): FridgeEvent => ({
  id: "fridge_evt_friday_replenishment",
  mode: "weekly_replenishment",
  occurredAt: "2026-07-17T08:00:00+02:00",
  description: "Friday inventory check found staple household items below their target level.",
  cart: [
    item("gm_milk_organic_2l", 2, true),
    item("gm_eggs_free_range_12", 1, false),
    item("gm_bananas_1kg", 1, true),
    item("gm_oats_1kg", 1, true),
  ],
});

export const urgentMilkEvent = (): FridgeEvent => ({
  id: "fridge_evt_urgent_milk",
  mode: "urgent_replenishment",
  occurredAt: "2026-07-17T15:30:00+02:00",
  description: "The milk shelf sensor is empty; the household requested same-day replenishment.",
  cart: [item("gm_milk_organic_2l", 1, false)],
});

export const eventForMode = (mode: PurchaseMode): FridgeEvent =>
  mode === "weekly_replenishment" ? fridayReplenishmentEvent() : urgentMilkEvent();
