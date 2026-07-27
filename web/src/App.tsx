import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PaymentAuthorization } from "./PaymentAuthorization.js";

type Checkout = { id: string; mode: string; total: number; currency: string; deliveryWindow: string; status: string; paymentIntentId?: string; orderId?: string; items: Array<{ name: string; quantity: number }> };
type SpendRequest = { id: string; checkoutId: string; seller: string; amount: number; currency: string; expiresAt: string; status: string; sharedPaymentToken?: string; policy: { outcome: string; reasons: string[] } };
type AuditEvent = { id: string; type: string; at: string; detail: string };
type Flow = { checkouts: Checkout[]; spendRequests: SpendRequest[]; auditEvents: AuditEvent[]; developmentSimulation: boolean };
type AppConfig = {
  demoMode: boolean;
  acsMode: "local" | "stripe";
  stripePublishableKey: string | null;
  sellerNetworkProfile: string | null;
  savedPaymentAuthority: boolean;
  savedPaymentAuthorityLabel: string | null;
};

const money = (amount: number, currency = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);

function ActorBadge({ actor }: { actor: "agent" | "wallet" | "marketplace" }) {
  const labels = { agent: "Shopping agent", wallet: "Authorization app", marketplace: "GreenMart marketplace" };
  return <span className={`actor-badge ${actor}`}>{labels[actor]}</span>;
}

function StepCard({
  actors,
  title,
  children,
}: {
  actors: Array<"agent" | "wallet" | "marketplace">;
  title: string;
  children: ReactNode;
}) {
  const tone = actors.length === 1 ? actors[0] : "shared";
  return (
    <article className={`step-card step-${tone}`}>
      <div className="step-actors">{actors.map((actor) => <ActorBadge key={actor} actor={actor} />)}</div>
      <h2>{title}</h2>
      {children}
    </article>
  );
}

export function App() {
  const [flow, setFlow] = useState<Flow | undefined>();
  const [config, setConfig] = useState<AppConfig | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [updatingPaymentMethod, setUpdatingPaymentMethod] = useState(false);
  const latestCheckout = flow?.checkouts.at(-1);
  const latestSpendRequest = useMemo(
    () => latestCheckout ? flow?.spendRequests.find((request) => request.checkoutId === latestCheckout.id) : undefined,
    [flow, latestCheckout],
  );

  const load = async () => {
    const [flowResponse, configResponse] = await Promise.all([fetch("/api/flow"), fetch("/api/config")]);
    if (!flowResponse.ok || !configResponse.ok) throw new Error("Unable to load the developer flow.");
    setFlow(await flowResponse.json() as Flow);
    setConfig(await configResponse.json() as AppConfig);
  };
  const reset = async () => {
    setBusy("reset"); setError(undefined);
    try {
      const response = await fetch("/api/demo/reset", { method: "POST" });
      const result = await response.json() as Flow & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to reset the demo.");
      setUpdatingPaymentMethod(false);
      setFlow(result);
      const configResponse = await fetch("/api/config");
      if (!configResponse.ok) throw new Error("Unable to load configuration.");
      setConfig(await configResponse.json() as AppConfig);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unexpected error."); }
    finally { setBusy(undefined); }
  };
  useEffect(() => { void load().catch((cause: Error) => setError(cause.message)); }, []);

  const call = async (action: string, url: string, body?: unknown) => {
    setBusy(action); setError(undefined);
    try {
      const response = await fetch(url, {
        method: "POST",
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The request was not accepted.");
      if (action === "authorize-saved") setUpdatingPaymentMethod(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unexpected error."); }
    finally { setBusy(undefined); }
  };

  const demoMode = config?.demoMode ?? true;
  const approved = latestSpendRequest?.status === "approved";
  const walletReady = Boolean(config?.stripePublishableKey && config.sellerNetworkProfile);
  const savedPaymentAuthority = Boolean(config?.savedPaymentAuthority);
  const showWalletForm = !demoMode && walletReady && (!savedPaymentAuthority || updatingPaymentMethod);

  if (!flow || !config) {
    return <main><p className="muted">Loading flow console…</p></main>;
  }

  return <main>
    <header>
      <div>
        <p className="eyebrow">GreenMart developer flow console</p>
        <h1>Bounded autonomous grocery checkout</h1>
        <p>Trace the sensor event, ACP checkout against GreenMart’s Agentic Commerce Suite seller surface, policy decision, payment authority, SPT, PaymentIntent, and fulfillment result.</p>
        <p><span className={`pill ${demoMode ? "demo" : "live"}`}>{demoMode ? "DEMO_MODE=true" : "DEMO_MODE=false · Stripe test integration"}</span>{" "}
          <span className="pill">{config.acsMode === "stripe" ? "ACS_MODE=stripe · Delegated Checkout" : "ACS_MODE=local · simulated /acp"}</span></p>
      </div>
      {demoMode
        ? <aside className="notice-demo"><strong>Development simulation</strong><br />Approve creates a local `spt_demo_…` token. No Stripe API calls are made.</aside>
        : <aside className="notice-live"><strong>Stripe integration mode</strong><br />{savedPaymentAuthority ? "This household wallet reuses a payment method tokenized earlier. Each purchase still issues a fresh scoped SPT to GreenMart." : "Use the household wallet to tokenize a payment method and issue a scoped SPT to GreenMart."}</aside>}
    </header>

    {!demoMode && !walletReady && !savedPaymentAuthority && (
      <p className="error" role="alert">Set `AGENT_STRIPE_PUBLISHABLE_KEY` or `HOUSEHOLD_PAYMENT_METHOD` in `.env`, restart the agent and marketplace servers, and refresh this page.</p>
    )}

    <section className="actions" aria-label="Run demo scenarios">
      <button disabled={Boolean(busy)} onClick={() => void call("weekly", "/api/demo/start", { mode: "weekly_replenishment" })}>Run Friday replenishment</button>
      <button disabled={Boolean(busy)} className="secondary" onClick={() => void call("urgent", "/api/demo/start", { mode: "urgent_replenishment" })}>Run urgent milk order</button>
      <button disabled={Boolean(busy)} className="quiet" onClick={() => void reset()}>{busy === "reset" ? "Resetting…" : "Reset demo"}</button>
    </section>
    {error && <p className="error" role="alert">{error}</p>}

    <section className="actor-legend" aria-label="Flow actors">
      <ActorBadge actor="agent" />
      <ActorBadge actor="wallet" />
      <ActorBadge actor="marketplace" />
    </section>

    <section className="grid">
      <StepCard actors={["agent", "marketplace"]} title="1. Fridge event and ACP checkout via ACS">
        {latestCheckout ? <>
          <p><strong>{latestCheckout.mode.replaceAll("_", " ")}</strong> · {latestCheckout.id}</p>
          <ul>{latestCheckout.items.map((item) => <li key={item.name}>{item.quantity} × {item.name}</li>)}</ul>
          <dl><dt>Final amount</dt><dd>{money(latestCheckout.total, latestCheckout.currency)}</dd><dt>Delivery</dt><dd>{latestCheckout.deliveryWindow}</dd><dt>Checkout state</dt><dd><span className="pill">{latestCheckout.status}</span></dd></dl>
        </> : <p>Run a demo to create a GreenMart checkout from a deterministic fridge event.</p>}
      </StepCard>

      <StepCard actors={["agent"]} title="2. Household policy">
        {latestSpendRequest ? <>
          <p><span className={`pill ${latestSpendRequest.policy.outcome}`}>{latestSpendRequest.policy.outcome}</span></p>
          <p>{latestSpendRequest.policy.reasons.join(" ")}</p>
          <p className="muted">Policy authorizes an agent to request payment. It is not a payment credential.</p>
        </> : <p>Policy is evaluated against GreenMart’s final total, item list, delivery window, and substitution rules.</p>}
      </StepCard>

      <StepCard actors={["wallet"]} title="3. Payment authorization">
        {latestSpendRequest ? <>
          <dl>
            <dt>Seller</dt><dd>{latestSpendRequest.seller}</dd>
            <dt>Maximum requested</dt><dd>{money(latestSpendRequest.amount, latestSpendRequest.currency)}</dd>
            <dt>Expiry</dt><dd>{new Date(latestSpendRequest.expiresAt).toLocaleString()}</dd>
            <dt>Authorization state</dt><dd><span className="pill">{latestSpendRequest.status}</span></dd>
            {latestSpendRequest.sharedPaymentToken && <><dt>SPT</dt><dd><code>{latestSpendRequest.sharedPaymentToken}</code></dd></>}
          </dl>
          {latestSpendRequest.status === "pending" && demoMode && (
            <button disabled={Boolean(busy)} onClick={() => void call("approve", `/api/spend-requests/${latestSpendRequest.id}/approve`)}>
              {busy === "approve" ? "Approving…" : "Approve spend request (simulation)"}
            </button>
          )}
          {latestSpendRequest.status === "pending" && !demoMode && savedPaymentAuthority && !updatingPaymentMethod && (
            <div className="wallet-panel">
              <p className="muted">Payment method on file from an earlier wallet session. Authorize this purchase without re-entering card details.</p>
              {config.savedPaymentAuthorityLabel && <p><code>{config.savedPaymentAuthorityLabel}</code></p>}
              <button disabled={Boolean(busy)} onClick={() => void call("authorize-saved", `/api/spend-requests/${latestSpendRequest.id}/authorize-saved`)}>
                {busy === "authorize-saved" ? "Authorizing…" : "Authorize purchase with saved payment method"}
              </button>
              <button disabled={Boolean(busy)} className="quiet" onClick={() => { setUpdatingPaymentMethod(true); setError(undefined); }}>
                Update payment method
              </button>
            </div>
          )}
          {latestSpendRequest.status === "pending" && showWalletForm && (
            <PaymentAuthorization
              config={{
                stripePublishableKey: config.stripePublishableKey!,
                sellerNetworkProfile: config.sellerNetworkProfile!,
              }}
              spendRequest={latestSpendRequest}
              disabled={Boolean(busy)}
              onComplete={async () => { setUpdatingPaymentMethod(false); await load(); }}
              onError={setError}
              heading={savedPaymentAuthority ? "Replace the saved household payment method" : undefined}
            />
          )}
          {latestSpendRequest.status === "pending" && !demoMode && savedPaymentAuthority && updatingPaymentMethod && (
            <button disabled={Boolean(busy)} className="quiet helper-action" onClick={() => { setUpdatingPaymentMethod(false); setError(undefined); }}>
              Cancel payment method update
            </button>
          )}
          {latestSpendRequest.status === "pending" && !demoMode && !savedPaymentAuthority && !walletReady && (
            <p className="muted">Configure `HOUSEHOLD_PAYMENT_METHOD` or `AGENT_STRIPE_PUBLISHABLE_KEY` to authorize payment.</p>
          )}
          {approved && <p className="success">A GreenMart-specific SPT was issued. The fridge and marketplace never receive card details.</p>}
        </> : <p>Payment authorization is only requested after policy approval.</p>}
      </StepCard>

      <StepCard actors={["marketplace"]} title="4. Payment and fulfillment">
        {latestCheckout ? <>
          <p><strong>SPT status:</strong> {approved ? "approved" : "not available"}</p>
          <p><strong>PaymentIntent:</strong> {latestCheckout.paymentIntentId ?? "not attempted"}</p>
          <p><strong>Order:</strong> {latestCheckout.orderId ?? "not confirmed"}</p>
          <button disabled={!approved || latestCheckout.status === "completed" || Boolean(busy)} onClick={() => void call("complete", `/api/checkouts/${latestCheckout.id}/complete`, { idempotencyKey: crypto.randomUUID() })}>{busy === "complete" ? "Completing…" : demoMode ? "Complete checkout with simulated SPT" : "Complete checkout with Stripe SPT"}</button>
        </> : <p>No PaymentIntent can be created until both policy approval and payment authorization succeed.</p>}
      </StepCard>
    </section>

    <section className="timeline step-card step-shared"><h2>Audit and webhook timeline</h2>{flow.auditEvents.length ? <ol>{flow.auditEvents.map((event) => <li key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time><strong>{event.type}</strong><span>{event.detail}</span></li>)}</ol> : <p>Events will appear here as the flow advances.</p>}</section>
  </main>;
}
