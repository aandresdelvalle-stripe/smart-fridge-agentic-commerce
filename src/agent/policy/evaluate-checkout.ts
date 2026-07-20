import type { Checkout, PolicyDecision } from "../../shared/types.js";

const WEEKLY_LIMIT = 12_000;
const URGENT_LIMIT = 2_500;
const URGENT_PRODUCTS = new Set(["gm_milk_organic_2l", "gm_milk_whole_2l", "gm_eggs_free_range_12"]);

/**
 * This is buyer-side policy, not a payment credential. It decides whether the
 * agent may request payment authority for GreenMart's final checkout.
 */
export const evaluateCheckout = (checkout: Checkout): PolicyDecision => {
  const reasons: string[] = [];

  if (checkout.seller !== "GreenMart") reasons.push("The seller is not in the household allowlist.");
  if (checkout.currency !== "usd") reasons.push("The checkout currency is not allowed.");

  if (checkout.mode === "weekly_replenishment") {
    if (checkout.total > WEEKLY_LIMIT) reasons.push(`Weekly total exceeds the $${WEEKLY_LIMIT / 100} limit.`);
    if (!checkout.deliveryWindow.startsWith("2026-07-18")) reasons.push("Weekly orders must use the Saturday delivery window.");
    if (reasons.length) return { outcome: "escalated", reasons };
    return { outcome: "approved", reasons: ["Weekly budget and Saturday delivery rules passed."], approvedMaximum: WEEKLY_LIMIT };
  }

  if (checkout.total > URGENT_LIMIT) reasons.push(`Urgent total exceeds the $${URGENT_LIMIT / 100} limit.`);
  if (!checkout.deliveryWindow.startsWith("2026-07-17")) reasons.push("Urgent orders must use a same-day delivery window.");
  if (checkout.items.some((item) => !URGENT_PRODUCTS.has(item.productId))) reasons.push("Urgent orders may include only milk or eggs.");
  if (checkout.items.some((item) => item.substitutionAccepted)) reasons.push("Urgent orders must not accept substitutions.");

  if (reasons.length) return { outcome: "denied", reasons };
  return { outcome: "approved", reasons: ["Urgent item, amount, delivery, and substitution rules passed."], approvedMaximum: URGENT_LIMIT };
};
