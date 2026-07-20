import { useEffect, useRef, useState } from "react";

export interface AgentCheckoutConfig {
  stripePublishableKey: string;
  sellerNetworkProfile: string;
}

interface SpendRequestSummary {
  id: string;
  amount: number;
  currency: string;
}

interface AuthorizeResponse {
  status: "approved" | "requires_action";
  issuedTokenId?: string;
  nextAction?: { use_stripe_sdk?: { value: string } };
  error?: string;
}

const waitForStripe = async (): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (window.Stripe) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Stripe.js did not load. Check your network connection and refresh the page.");
};

export function PaymentAuthorization({
  config,
  spendRequest,
  disabled,
  onComplete,
  onError,
  heading,
}: {
  config: AgentCheckoutConfig;
  spendRequest: SpendRequestSummary;
  disabled?: boolean;
  onComplete: () => Promise<void>;
  onError: (message: string) => void;
  heading?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<{ unmount(): void } | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mountElement = mountRef.current;
    if (!mountElement) return;

    const setup = async () => {
      await waitForStripe();
      if (cancelled || !mountRef.current) return;

      const stripe = window.Stripe!(config.stripePublishableKey);
      const elementsFactory = stripe.elements({
        mode: "payment",
        amount: spendRequest.amount,
        currency: spendRequest.currency,
        paymentMethodCreation: "manual",
        sellerDetails: { networkBusinessProfile: config.sellerNetworkProfile },
      });
      const paymentElement = elementsFactory.create("payment", { layout: "tabs" });
      paymentElement.mount(mountRef.current);
      stripeRef.current = stripe;
      elementsRef.current = elementsFactory as unknown as StripeElements;
      paymentElementRef.current = paymentElement;
      setReady(true);
    };

    void setup().catch((cause: Error) => onError(cause.message));

    return () => {
      cancelled = true;
      paymentElementRef.current?.unmount();
      paymentElementRef.current = null;
      stripeRef.current = null;
      elementsRef.current = null;
      setReady(false);
    };
  }, [config.sellerNetworkProfile, config.stripePublishableKey, spendRequest.amount, spendRequest.currency]);

  const authorize = async () => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) throw new Error("Stripe is still loading.");

    const { error: submitError } = await elements.submit();
    if (submitError) throw new Error(submitError.message);

    const { error, paymentMethod } = await stripe.preparePaymentMethod({
      elements,
      params: { billing_details: { name: "Household shopper" } },
    });
    if (error) throw new Error(error.message);
    if (!paymentMethod) throw new Error("Stripe did not return a payment method.");

    const response = await fetch(`/api/spend-requests/${spendRequest.id}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentMethodId: paymentMethod.id }),
    });
    const result = await response.json() as AuthorizeResponse;
    if (!response.ok) throw new Error(result.error ?? "Authorization was not accepted.");

    if (result.status === "requires_action") {
      const hashedValue = result.nextAction?.use_stripe_sdk?.value;
      if (!hashedValue || !result.issuedTokenId) throw new Error("Stripe returned an incomplete next action.");
      const actionResult = await stripe.handleNextAction({ hashedValue });
      if (actionResult.error) throw new Error(actionResult.error.message);

      const finalize = await fetch(`/api/spend-requests/${spendRequest.id}/finalize-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issuedTokenId: result.issuedTokenId }),
      });
      const finalized = await finalize.json() as { error?: string };
      if (!finalize.ok) throw new Error(finalized.error ?? "Authorization could not be finalized.");
    }

    await onComplete();
  };

  return (
    <div className="wallet-panel">
      <p className="muted">{heading ?? "Collect a household payment method and issue a GreenMart-scoped Shared Payment Token."}</p>
      <div ref={mountRef} className="payment-element" />
      <button
        disabled={disabled || submitting || !ready}
        onClick={() => {
          setSubmitting(true);
          onError("");
          void authorize()
            .catch((cause: Error) => onError(cause.message))
            .finally(() => setSubmitting(false));
        }}
      >
        {submitting ? "Authorizing…" : ready ? "Authorize with household wallet" : "Loading wallet…"}
      </button>
    </div>
  );
}
