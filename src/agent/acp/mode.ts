/** How the agent reaches GreenMart's ACS-exposed seller checkout surface. */
export type AcsMode = "local" | "stripe";

export const getAcsMode = (): AcsMode => {
  const mode = process.env.ACS_MODE?.trim().toLowerCase();
  return mode === "stripe" ? "stripe" : "local";
};

export const isStripeAcsMode = (): boolean => getAcsMode() === "stripe";

export const isLocalAcsMode = (): boolean => getAcsMode() === "local";

export const assertStripeAcsReady = (): void => {
  if (process.env.DEMO_MODE !== "false") {
    throw new Error("ACS_MODE=stripe requires DEMO_MODE=false and real Stripe test keys.");
  }
};
