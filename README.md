# Smart Fridge Agentic Commerce

A public Node.js 22 + TypeScript reference application for a smart-fridge shopping agent and the fictional GreenMart marketplace. It demonstrates bounded household authority, Shared Payment Tokens (SPTs), and the split between **Stripe Agentic Commerce Suite (ACS)** on the seller side and the **Agentic Commerce Protocol (ACP)** on the agent side.

> **Stripe Agentic Commerce Suite is not generally available (GA) as of July 27, 2026.**
> ACS is rolling out in limited preview (US and Canada). You must **request access** before you can use the real Stripe-hosted seller surface or Delegated Checkout APIs in your own Stripe accounts.
> Join the [ACS waitlist / contact sales](https://go.stripe.global/agentic-commerce-contact-sales) or complete [Agentic commerce onboarding](https://dashboard.stripe.com/agentic-commerce) if it appears on your Dashboard.
>
> **Until ACS is enabled on your accounts, use the defaults:** `DEMO_MODE=true` and `ACS_MODE=local`. No Stripe ACS access is required to explore the flow.

## What the sample demonstrates

1. A deterministic Friday-replenishment or same-day urgent fridge event triggers an ACP checkout against GreenMart.
2. The agent evaluates buyer-side policy against GreenMart’s **final** amount, items, substitutions, and delivery window.
3. If the policy approves, the household authorization step requests payment authority for that checkout.
4. A scoped Shared Payment Token (SPT) is granted to GreenMart with usage limits aligned to the checkout.
5. GreenMart (via ACS) creates and confirms a PaymentIntent using `payment_method_data.shared_payment_granted_token`.
6. Idempotent completion and webhook event handling make retries safe.

The fridge does not receive a card number. GreenMart does not receive a card number. The policy decision is not a payment credential.

## Architecture

```text
Smart fridge → shopping agent (:4243) ──ACP client──► GreenMart ACS seller surface (:4242/acp)
       │              │ issues SPT                         │
       │              │ (agent Stripe account)             │ validates SPT + PaymentIntent
       └──── inventory event                               │ (marketplace Stripe account)
                                                           └── catalog feed, webhooks, fulfillment
```

| Role | Service | Port | Stripe keys | Protocol / product |
|---|---|---|---|---|
| **GreenMart seller** | Marketplace | 4242 | `MARKETPLACE_STRIPE_*` | **Agentic Commerce Suite** — catalog feed, ACS onboarding, hosted ACP seller surface (`/acp/*`), PaymentIntent, webhooks |
| **Shopping agent + wallet** | Agent | 4243 | `AGENT_STRIPE_*` | **ACP client** — calls GreenMart’s ACS-exposed checkout, issues SPTs, Payment Element |
| **Developer console** | Web | 5173 | — | Proxies `/api` → agent; `/webhooks` → marketplace |

In production, GreenMart enables [Agentic Commerce Suite](https://docs.stripe.com/agentic-commerce/for-sellers) in the Stripe Dashboard (after access is granted), uploads a catalog feed, and Stripe hosts the ACP seller endpoint. This repository supports two agent integration paths:

| `ACS_MODE` | Agent checkout path | When to use |
|---|---|---|
| **`local`** (default) | HTTP ACP client → simulated ACS surface at `http://localhost:4242/acp/*` | No ACS access needed; default for this repo |
| **`stripe`** | Stripe **Delegated Checkout API** (`RequestedSession`) | After ACS is enabled on your agent + seller test accounts |

With `ACS_MODE=local`, the marketplace service simulates the ACS-hosted ACP seller surface. With `ACS_MODE=stripe`, the agent talks directly to Stripe and **`dev:marketplace` is optional** for checkout (still useful for webhooks and seller-side observability).

In Stripe test mode, agent and marketplace use **separate** Stripe test accounts so network profiles differ — required for real SPT issuance.

## Stripe ACS access (read this first)

As of **July 27, 2026**:

- **ACS is not GA.** Stripe documents it as a preview / rolling rollout, not a self-serve product every account can enable today.
- **Seller access:** onboard at [Agentic commerce](https://dashboard.stripe.com/agentic-commerce), upload catalog feeds, enable agents. If the tab is missing, [request access](https://go.stripe.global/agentic-commerce-contact-sales).
- **Agent access:** onboard as an agent in the Dashboard, enable the **Test Seller**, establish an orchestrated commerce agreement (OCA) with GreenMart. See [Embed commerce for agents](https://docs.stripe.com/agentic-commerce/for-agents).
- **Sandbox testing:** once enabled, use test mode, Dashboard **View feed → Test**, and Workbench’s **Trigger Agentic Purchase** blueprint.

This repo does **not** replace ACS onboarding. It lets you develop against a local simulation (`ACS_MODE=local`) while you wait for access, then switch to `ACS_MODE=stripe` when Delegated Checkout is available on your agent account.

## Run it locally

Prerequisites: Node.js 22+ and npm.

```bash
cp .env.example .env
npm install
npm run dev:marketplace   # terminal 1 — GreenMart ACS seller on :4242
npm run dev:agent         # terminal 2 — ACP client + wallet on :4243
npm run dev:web           # terminal 3 — console on :5173
```

Open `http://localhost:5173`. The header pills show `DEMO_MODE` and `ACS_MODE`.

**With `ACS_MODE=local` (default), both API servers must be running.** The agent calls the simulated ACS surface at `MARKETPLACE_URL/acp` (default `http://localhost:4242/acp`).

**With `ACS_MODE=stripe`, only `dev:agent` is required for checkout** (plus `DEMO_MODE=false` and agent Stripe keys). Run `dev:marketplace` if you want local webhooks or seller-side dev endpoints.

After changing `.env`, restart affected servers.

Generate GreenMart’s ACS catalog feed artifact:

```bash
npm run generate:feed   # writes greenmart-product-feed.json
```

## Operating modes

Two independent toggles in `.env`:

### `DEMO_MODE` — Stripe API calls on/off

Defaults to `true` in `.env.example`.

| | `DEMO_MODE=true` (default) | `DEMO_MODE=false` |
|---|---|---|
| **Stripe API calls** | None | Real test-mode calls |
| **Stripe credentials** | Not required | Two separate test accounts (see below) |
| **Step 3 — payment authorization** | **Approve spend request (simulation)** button | Household wallet (Payment Element) or saved payment method |
| **SPT created** | Local `spt_demo_…` string | Real `spt_…` (see `ACS_MODE` below) |
| **PaymentIntent** | Simulated `pi_demo_…` | Real `pi_…` on the marketplace ACS account (local mode) or via Delegated Checkout (stripe mode) |
| **Webhooks** | Accepted without signature verification | Verified with `MARKETPLACE_STRIPE_WEBHOOK_SECRET` |

### `ACS_MODE` — how the agent reaches GreenMart checkout

Defaults to `local` in `.env.example`.

| | `ACS_MODE=local` (default) | `ACS_MODE=stripe` |
|---|---|---|
| **Requires ACS access** | No | **Yes** — agent + seller accounts must have ACS enabled |
| **Requires `DEMO_MODE=false`** | Only for live Stripe SPT/PI on completion | **Yes** |
| **Agent integration** | HTTP → `localhost:4242/acp/*` | Stripe `delegated_checkout/requested_sessions` |
| **Marketplace server** | Required | Optional |
| **Payment authorization** | Agent issues SPT via `issued_tokens`, marketplace charges on complete | Agent confirms `RequestedSession`; Stripe routes SPT + payment to seller |

`ACS_MODE=stripe` is for accounts that already have ACS preview access. It will fail with Stripe API errors if your account has not been onboarded.

### `DEMO_MODE=true` — local simulation (default)

Safe for first-run exploration. No Stripe Dashboard setup required.

**What works**

- Run Friday replenishment / urgent milk order scenarios end-to-end.
- Agent calls GreenMart via the ACP client (`/acp/checkouts`).
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

### `DEMO_MODE=false` + `ACS_MODE=local` — Stripe test integration (simulated ACS)

Use this when you have Stripe test keys but **not** ACS preview access yet.

**Requirements**

1. **Agent Stripe test account** — household wallet; issues SPTs via `issued_tokens`.
2. **Marketplace Stripe test account** — GreenMart seller; validates granted SPTs and creates PaymentIntents.
3. **`GREENMART_SELLER_NETWORK_PROFILE`** from the marketplace account (create a network business profile even without ACS).

See `.env` example below. Payment authorization uses `issued_tokens` on the agent account; completion charges the marketplace account.

### `DEMO_MODE=false` + `ACS_MODE=stripe` — Stripe ACS sandbox (requires access)

Use this **only after** Stripe enables ACS on your agent and seller test accounts.

**Additional requirements**

1. Complete [Agentic commerce onboarding](https://dashboard.stripe.com/agentic-commerce) on both accounts (or join the [waitlist](https://go.stripe.global/agentic-commerce-contact-sales)).
2. Seller: upload catalog feed; use Dashboard **Test** or Workbench blueprints.
3. Agent: enable **Test Seller**; use `GREENMART_SELLER_NETWORK_PROFILE` from the test seller.
4. Set `ACS_MODE=stripe` and `DEMO_MODE=false`.

The agent creates a `RequestedSession`, confirms it with the household wallet, and Stripe handles SPT creation and seller payment routing. You do not need the local `/acp` HTTP server for checkout.

### `DEMO_MODE=false` — shared requirements (both ACS modes)

1. **Agent Stripe test account** — `AGENT_STRIPE_SECRET_KEY`, `AGENT_STRIPE_PUBLISHABLE_KEY`
2. **Marketplace Stripe test account** (required for `ACS_MODE=local`) — `MARKETPLACE_STRIPE_SECRET_KEY`, `MARKETPLACE_STRIPE_WEBHOOK_SECRET`
3. **`GREENMART_SELLER_NETWORK_PROFILE`** from the marketplace account — must differ from the agent account’s own profile

**Step 3 in the web console**

- **Payment Element** — tokenize a card and authorize (`issued_tokens` in local mode, `RequestedSession` confirm in stripe mode).
- **Saved payment method** — if `HOUSEHOLD_PAYMENT_METHOD=pm_…` is set.

The simulation **Approve** button is disabled; use the wallet instead.

**Step 4 — complete checkout**

- **`ACS_MODE=local`:** agent forwards the approved `spt_…` to GreenMart’s `/acp/.../complete` endpoint; marketplace confirms a PaymentIntent.
- **`ACS_MODE=stripe`:** payment is typically confirmed when the wallet authorizes the `RequestedSession`; step 4 retrieves the completed session.

**Where to find objects in the Stripe Dashboard (test mode)**

| Object | Stripe account | Dashboard |
|---|---|---|
| Issued SPT (`spt_…`) | Agent | Agent account, test mode |
| PaymentIntent (`pi_…`) | Marketplace (local mode) or seller via ACS (stripe mode) | Marketplace account → **Payments** |

**`.env` examples**

Local simulation (no ACS access needed):

```bash
DEMO_MODE=true
ACS_MODE=local
```

Stripe test + simulated ACS (no ACS preview access):

```bash
DEMO_MODE=false
ACS_MODE=local
GREENMART_SELLER_NETWORK_PROFILE=profile_test_...
AGENT_STRIPE_SECRET_KEY=sk_test_...
AGENT_STRIPE_PUBLISHABLE_KEY=pk_test_...
MARKETPLACE_STRIPE_SECRET_KEY=sk_test_...
MARKETPLACE_STRIPE_WEBHOOK_SECRET=whsec_...
```

Stripe ACS sandbox (**requires ACS preview access**):

```bash
DEMO_MODE=false
ACS_MODE=stripe
GREENMART_SELLER_NETWORK_PROFILE=profile_test_...   # test seller profile from ACS
AGENT_STRIPE_SECRET_KEY=sk_test_...
AGENT_STRIPE_PUBLISHABLE_KEY=pk_test_...
AGENT_STRIPE_API_VERSION=2026-04-22.preview
HOUSEHOLD_PAYMENT_METHOD=pm_...                       # optional
```

Preview API version `2026-04-22.preview` (or the version approved for your integration) is required for Shared Payment Token and Delegated Checkout endpoints.

### Wallet authorization flow (`DEMO_MODE=false`, `ACS_MODE=local`)

1. Payment Element creates a `PaymentMethod` client-side.
2. Agent calls `POST /v1/shared_payment/issued_tokens` on the **agent** account.
3. Browser handles any required customer action (e.g. 3D Secure).
4. Agent completes checkout via `/acp/.../complete`; marketplace confirms a PaymentIntent with the granted SPT.

### Wallet authorization flow (`DEMO_MODE=false`, `ACS_MODE=stripe`)

1. Payment Element creates a `PaymentMethod` client-side.
2. Agent confirms the `RequestedSession` via Stripe Delegated Checkout.
3. Stripe creates the SPT and routes payment to the ACS seller automatically.

This follows [Stripe’s Shared Payment Tokens documentation](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens) and [Delegated Checkout for agents](https://docs.stripe.com/agentic-commerce/for-agents).

## Webhooks

The marketplace (ACS seller) exposes `POST /webhooks/stripe`. Forward Stripe CLI to port **4242**:

```bash
stripe listen --forward-to localhost:4242/webhooks/stripe
```

Copy the signing secret into `MARKETPLACE_STRIPE_WEBHOOK_SECRET`.

- **`DEMO_MODE=true`**: signatures are not verified (local simulation only).
- **`DEMO_MODE=false`**: signatures are verified against the marketplace webhook secret.

In production ACS, listen for events such as `checkout.session.completed`. The sample also records `payment_intent.succeeded` and `shared_payment.granted_token.deactivated` in the audit timeline.

## Validate

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run generate:feed
```

The suite covers policy limits, ACS-exposed ACP checkout contracts, the invariant that no payment may occur before both policy approval and payment authorization, idempotent completion, and duplicate webhook delivery.

## Production checklist

Set `DEMO_MODE=false` only after validating current product access and API behavior for your Stripe accounts. **Confirm ACS is enabled on your account before setting `ACS_MODE=stripe`.**

- Request or confirm **Agentic Commerce Suite** access (not GA as of July 2026).
- Onboard the shopping agent; establish an orchestrated commerce agreement (OCA) with GreenMart.
- Use separate agent and marketplace Stripe accounts with distinct network profiles.
- Set `AGENT_STRIPE_*`, `MARKETPLACE_STRIPE_*`, and pin preview API versions.
- Set `GREENMART_SELLER_NETWORK_PROFILE` from the marketplace ACS account only.
- Configure and verify `MARKETPLACE_STRIPE_WEBHOOK_SECRET`.
- Replace the simulation approve path with your production household wallet flow.
- Keep SPT usage limits (merchant profile, amount, currency, expiry) aligned with the final checkout.

For live-mode testing from a personal Link account, Stripe documents [`link-cli`](https://link.com/agents).

## Key files

- `src/marketplace/acs/seller-config.ts` — ACS seller identity and `/acp` base URL.
- `src/marketplace/acp/routes.ts` — ACP seller checkout surface exposed by ACS (simulated locally at `/acp/*`).
- `src/marketplace/routes.ts` — ACS seller health, config, and dev flow endpoints.
- `src/agent/acp/client.ts` — local HTTP ACP client (`ACS_MODE=local`).
- `src/agent/acp/stripe-client.ts` — Stripe Delegated Checkout ACP client (`ACS_MODE=stripe`).
- `src/agent/acp/mode.ts` — `ACS_MODE` resolution.
- `src/agent/routes.ts` — fridge demo flow, policy, spend requests, and checkout orchestration.
- `src/agent/policy/evaluate-checkout.ts` — bounded weekly and urgent household policies.
- `src/agent/consent/spend-request.ts` — spend request model; demo simulation and granted-token attachment.
- `src/agent/stripe/issue-token.ts` — `issued_tokens` on the agent account.
- `scripts/generate-product-feed.ts` — ACS catalog feed artifact for GreenMart.
- `web/src/PaymentAuthorization.tsx` — Payment Element for `DEMO_MODE=false`.
- `src/marketplace/stripe/payment.ts` — PaymentIntent with `payment_method_data.shared_payment_granted_token`.
- `web/` — React/Vite developer flow console.

## Learn more

- [Stripe Agentic Commerce](https://docs.stripe.com/agentic-commerce)
- [Agentic Commerce Suite for sellers](https://docs.stripe.com/agentic-commerce/for-sellers)
- [Agentic Commerce Suite for agents](https://docs.stripe.com/agentic-commerce/for-agents)
- [Shared Payment Tokens](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens)
