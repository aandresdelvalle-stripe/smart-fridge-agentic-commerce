interface StripePaymentMethod {
  id: string;
}

interface StripeError {
  message: string;
}

interface StripePreparePaymentMethodResult {
  error?: StripeError;
  paymentMethod?: StripePaymentMethod;
}

interface StripeHandleNextActionResult {
  error?: StripeError;
}

interface StripeElements {
  submit(): Promise<{ error?: StripeError }>;
}

interface StripeElementsFactory {
  create(type: "payment", options?: { layout?: string }): { mount(element: HTMLElement): void; unmount(): void };
}

interface StripeInstance {
  elements(options: {
    mode: "payment";
    amount: number;
    currency: string;
    paymentMethodCreation: "manual";
    sellerDetails: { networkBusinessProfile: string };
  }): StripeElementsFactory;
  preparePaymentMethod(input: {
    elements: StripeElements;
    params: { billing_details: { name: string } };
  }): Promise<StripePreparePaymentMethodResult>;
  handleNextAction(input: { hashedValue: string }): Promise<StripeHandleNextActionResult>;
}

interface Window {
  Stripe?: (publishableKey: string) => StripeInstance;
}

declare const Stripe: Window["Stripe"];
