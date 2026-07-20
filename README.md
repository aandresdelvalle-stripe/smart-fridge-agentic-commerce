# Smart Fridge Agentic Commerce

A public Node.js 22 + TypeScript reference application for a smart-fridge shopping agent and the fictional GreenMart marketplace. It demonstrates an ACP-first checkout with bounded household authority and Shared Payment Tokens (SPTs).

## What the sample demonstrates

1. A deterministic Friday-replenishment or same-day urgent fridge event creates a GreenMart checkout.
2. The agent evaluates buyer-side policy against GreenMart’s **final** amount, items, substitutions, and delivery window.
3. If the policy approves, the household authorization step requests payment authority for that checkout.
4. A scoped Shared Payment Token (SPT) is granted to GreenMart with usage limits aligned to the checkout.
5. GreenMart creates and confirms a PaymentIntent using `payment_method_data.shared_payment_granted_token`.
6. Idempotent completion and webhook event handling make retries safe.

The fridge does not receive a card number. GreenMart does not receive a card number. The policy decision is not a payment credential.

## Architecture

The sample splits the **agent** (household wallet, policy, SPT issuance) from the **marketplace** (GreenMart ACP seller, PaymentIntent, webhooks). In Stripe test mode, each service uses its **own** Stripe test account so the agent’s network identity differs from GreenMart’s seller profile — a requirement for real SPT issuance.

```text
Smart fridge → shopping agent (:4243) → household wallet / Payment Element
       │              │ issues SPT (issued_token) on agent Stripe account
       │              └──── ACP checkout ──────── GreenMart marketplace (:4242)
       │                                        │
       └──── inventory event                    └── charges SPT → PaymentIntent on marketplace Stripe account
```

| Service | Port | npm script | Stripe keys | Responsibility |
|---|---|---|---|---|
| **Marketplace (GreenMart)** | 4242 | `dev:marketplace` | `MARKETPLACE_STRIPE_*` | ACP checkout, granted SPT validation, PaymentIntent, webhooks |
| **Agent + wallet** | 4243 | `dev:agent` | `AGENT_STRIPE_*` | Fridge events, policy, spend requests, `issued_tokens`, Payment Element |
| **Web console** | 5173 | `dev:web` | — | Proxies `/api` → agent; `/webhooks` → marketplace |

ACP is the core commerce integration. MCP is intentionally not required on the purchase path.

## Run it locally

Prerequisites: Node.js 22+ and npm.

```bash
cp .env.example .env
npm install
npm run dev:marketplace   # terminal 1 — GreenMart on :4242
npm run dev:agent         # terminal 2 — agent + wallet on :4243
npm run dev:web           # terminal 3 — console on :5173
```

Open `http://localhost:5173`. The header pill shows whether `DEMO_MODE=true` or `DEMO_MODE=false`.

**Both API servers must be running in either mode.** The agent orchestrates the flow and calls the marketplace over HTTP (`MARKETPLACE_URL`, default `http://localhost:4242`).

After changing `.env`, restart **both** `dev:marketplace` and `dev:agent`.

## Operating modes

`DEMO_MODE` is read from `.env`. It defaults to `true` in `.env.example`.

| | `DEMO_MODE=true` (default) | `DEMO_MODE=false` |
|---|---|---|
| **Stripe API calls** | None | Real test-mode calls |
| **Stripe credentials** | Not required | Two separate test accounts (see below) |
| **Step 3 — payment authorization** | **Approve spend request (simulation)** button | Household wallet (Payment Element) or saved payment method |
| **SPT created** | Local `spt_demo_…` string | Real `spt_…` via `POST /v1/shared_payment/issued_tokens` on the **agent** account |
| **PaymentIntent** | Simulated `pi_demo_…` | Real `pi_…` on the **marketplace** account |
| **Webhooks** | Accepted without signature verification (for local testing) | Verified with `MARKETPLACE_STRIPE_WEBHOOK_SECRET` |

### `DEMO_MODE=true` — local simulation (default)

Safe for first-run exploration. No Stripe Dashboard setup required.

**What works**

- Run Friday replenishment / urgent milk order scenarios end-to-end.
- Policy evaluation, spend requests, and audit timeline.
- Click **Approve spend request (simulation)** in step 3 to attach a local `spt_demo_…` token.
- Click **Complete checkout with simulated SPT** in step 4 to finish with a fake PaymentIntent id.

**What does not happen**

- No calls to Stripe (`issued_tokens`, `payment_intents`, Payment Element, etc.).
- Wallet endpoints (`/authorize`, `/authorize-saved`, `/finalize-authorization`) return 403.

**`.env` for demo mode**

```bash
DEMO_MODE=true
# No Stripe keys needed. AGENT_STRIPE_* and MARKETPLACE_STRIPE_* can stay empty.
```

### `DEMO_MODE=false` — Stripe test integration

Use this when you want real Shared Payment Tokens and PaymentIntents in Stripe test mode.

**Requirements**

1. **Agent Stripe test account** — household wallet; issues SPTs.
   - `AGENT_STRIPE_SECRET_KEY`
   - `AGENT_STRIPE_PUBLISHABLE_KEY` (Payment Element)
   - The agent’s network profile is **implicit** from these keys. There is no separate env var for it.

2. **Marketplace Stripe test account** — GreenMart seller; validates granted SPTs and creates PaymentIntents.
   - `MARKETPLACE_STRIPE_SECRET_KEY`
   - `MARKETPLACE_STRIPE_WEBHOOK_SECRET` (for webhooks)
   - Create a seller **network business profile** on this account.

3. **GreenMart seller profile** — one shared env var, sourced from the **marketplace** account:
   - `GREENMART_SELLER_NETWORK_PROFILE=profile_test_…`
   - GreenMart and the marketplace are the same business; both services read this id.
   - The agent passes it as the SPT grantee when calling `issued_tokens`.
   - It **must not** be a profile from the agent account, or Stripe returns *“network_id is the same as the counterparty network_id”*.

**Step 3 in the web console**

- **Payment Element** — tokenize a card on the agent account and issue a scoped SPT to GreenMart.
- **Saved payment method** — if `HOUSEHOLD_PAYMENT_METHOD=pm_…` is set, authorize without re-entering card details (each purchase still mints a fresh SPT).

The simulation **Approve** button is disabled; use the wallet instead.

**Step 4 — complete checkout**

- The agent forwards the approved `spt_…` to the marketplace.
- GreenMart retrieves the granted token, verifies amount/currency/expiry, and confirms a PaymentIntent.

**Where to find objects in the Stripe Dashboard (test mode)**

| Object | Stripe account | Dashboard |
|---|---|---|
| Issued SPT (`spt_…`) | Agent (`AGENT_STRIPE_SECRET_KEY`) | Agent account, test mode |
| Granted SPT / charge | Marketplace (`MARKETPLACE_STRIPE_SECRET_KEY`) | Marketplace account, test mode |
| PaymentIntent (`pi_…`) | Marketplace | Marketplace account → **Payments**. The id embeds the marketplace account (e.g. `pi_…LDEareJThJ…` matches `sk_test_…LDEareJThJ…`) |

**`.env` for Stripe test mode**

```bash
DEMO_MODE=false

# GreenMart seller profile — create on the marketplace Stripe account only
GREENMART_SELLER_NETWORK_PROFILE=profile_test_...

# Agent (household wallet / SPT issuance)
AGENT_STRIPE_SECRET_KEY=sk_test_...
AGENT_STRIPE_PUBLISHABLE_KEY=pk_test_...
AGENT_STRIPE_API_VERSION=2026-04-22.preview

# Marketplace (GreenMart seller / ACP checkout)
MARKETPLACE_STRIPE_SECRET_KEY=sk_test_...
MARKETPLACE_STRIPE_WEBHOOK_SECRET=whsec_...
MARKETPLACE_STRIPE_API_VERSION=2026-04-22.preview
MARKETPLACE_URL=http://localhost:4242

# Optional: reuse a payment method tokenized in an earlier wallet session
HOUSEHOLD_PAYMENT_METHOD=pm_...
```

Preview API version `2026-04-22.preview` (or the version approved for your integration) is required for Shared Payment Token endpoints.

### Wallet authorization flow (`DEMO_MODE=false`)

1. Payment Element creates a `PaymentMethod` client-side (agent publishable key + GreenMart seller profile).
2. Agent server calls `POST /v1/shared_payment/issued_tokens` on the **agent** account with `seller_details[network_business_profile]` set to `GREENMART_SELLER_NETWORK_PROFILE`.
3. If required, the browser handles customer action (e.g. 3D Secure) and the agent finalizes the issued token.
4. User completes checkout; marketplace charges the granted token:

```ts
await stripe.rawRequest("POST", "/v1/payment_intents", {
  amount: checkout.total,
  currency: checkout.currency,
  confirm: "true",
  "payment_method_data[shared_payment_granted_token]": sharedPaymentToken,
});
```

This follows [Stripe’s Shared Payment Tokens documentation](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens).

## Webhooks

The marketplace exposes `POST /webhooks/stripe`. Forward Stripe CLI to port **4242**:

```bash
stripe listen --forward-to localhost:4242/webhooks/stripe
```

Copy the signing secret into `MARKETPLACE_STRIPE_WEBHOOK_SECRET`.

- **`DEMO_MODE=true`**: signatures are not verified (local simulation only).
- **`DEMO_MODE=false`**: signatures are verified against the marketplace webhook secret.

The sample records events such as `payment_intent.succeeded` and `shared_payment.granted_token.deactivated` in the audit timeline. Agent-side events (e.g. `shared_payment.issued_token.requires_action`) appear on the agent account in production; this demo does not expose a separate agent webhook endpoint.

## Validate

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run generate:feed
```

The suite covers policy limits, ACP-style checkout contracts, the invariant that no payment may occur before both policy approval and payment authorization, idempotent completion, and duplicate webhook delivery.

## Production checklist

Set `DEMO_MODE=false` only after validating current product access and API behavior for your Stripe accounts:

- Use separate agent and marketplace Stripe accounts with distinct network profiles.
- Set `AGENT_STRIPE_*`, `MARKETPLACE_STRIPE_*`, and pin preview API versions.
- Set `GREENMART_SELLER_NETWORK_PROFILE` from the marketplace account only.
- Configure and verify `MARKETPLACE_STRIPE_WEBHOOK_SECRET`.
- Replace the simulation approve path with your production household wallet flow.
- Keep SPT usage limits (merchant profile, amount, currency, expiry) aligned with the final checkout.
- Confirm the current ACP OpenAPI contract before publishing. This repository uses a small illustrative ACP seller surface.

For live-mode testing from a personal Link account, Stripe documents [`link-cli`](https://link.com/agents).

## Key files

- `src/marketplace/routes.ts` — GreenMart ACP checkout, completion, and cancellation API.
- `src/agent/routes.ts` — fridge demo flow, policy, spend requests, and checkout orchestration.
- `src/agent/policy/evaluate-checkout.ts` — bounded weekly and urgent household policies.
- `src/agent/consent/spend-request.ts` — spend request model; demo simulation and granted-token attachment.
- `src/agent/stripe/issue-token.ts` — `issued_tokens` on the agent account.
- `src/agent/stripe/public-config.ts` — `/api/config` for the web console.
- `src/shared/greenmart-seller-profile.ts` — shared `GREENMART_SELLER_NETWORK_PROFILE` reader.
- `web/src/PaymentAuthorization.tsx` — Payment Element for `DEMO_MODE=false`.
- `src/marketplace/stripe/payment.ts` — PaymentIntent with `payment_method_data.shared_payment_granted_token`.
- `src/marketplace/stripe/webhooks.ts` — signature-aware, idempotent webhook handler.
- `web/` — React/Vite developer flow console.

## Learn more

- [Stripe Agentic Commerce](https://docs.stripe.com/agentic-commerce)
- [Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/protocol)
- [Shared Payment Tokens](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens)
