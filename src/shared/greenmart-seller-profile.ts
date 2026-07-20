/**
 * GreenMart's seller network profile on the marketplace Stripe account.
 * Both the agent and marketplace services read the same env var — GreenMart is the seller.
 */
export const getGreenMartSellerNetworkProfile = (): string => {
  const profile =
    process.env.GREENMART_SELLER_NETWORK_PROFILE?.trim()
    || process.env.MARKETPLACE_SELLER_NETWORK_PROFILE?.trim()
    || process.env.STRIPE_SELLER_NETWORK_PROFILE?.trim();
  if (!profile) {
    throw new Error(
      "GREENMART_SELLER_NETWORK_PROFILE is required when DEMO_MODE=false. "
      + "Create this profile on the marketplace Stripe account; both services use the same id.",
    );
  }
  return profile;
};
