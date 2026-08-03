# rail0 starter — agentic commerce over escrow

A fullstack template showing an **AI buyer agent** purchasing physical goods
from a **merchant server**, paying in stablecoins through the
[rail0](https://github.com/commercelayer/rail0) payment gateway.

Unlike pay-per-request protocols (x402 and friends), rail0 brings the
**authorize → capture** lifecycle of card networks to stablecoin payments: at
checkout the buyer's funds are locked in an **on-chain escrow**, and the
merchant only receives them when it captures the payment after fulfilment —
or gives them back by voiding it. That lifecycle is exactly what buying
*goods* needs, and it's what this template demonstrates end to end.

## What's inside

One Next.js app playing both roles, talking to each other over HTTP (`/` is
just a landing page to pick a side):

| Piece | Where | What it does |
| --- | --- | --- |
| **Buyer agent** | `agent/` (durable [Vercel eve](https://eve.dev) agent, mounted on this app by `withEve()` in `next.config.ts`) + the chat UI on `/buyer` | Commerce tools: browses the catalog, builds a cart, and on your confirmation runs the three-step checkout below. The session is durable server-side and survives cold starts and deploys |
| **Storefront API** | `src/app/api/shop/*` + `src/app/api/checkout/*` | The merchant server: products, accepted payment methods (read live from the gateway), orders, and the signature drop-box. Verifies the buyer's payment against the order, then **authorizes it automatically** — funds move to escrow |
| **Merchant view** | `/merchant` | Minimal back-office: order list with live payment state, **Fulfil & capture** and **Cancel & void** buttons |

Both sides use the [`@rail0/sdk`](https://github.com/commercelayer/rail0-ts)
TypeScript SDK — no CLI or binary dependency, so the template deploys anywhere
Next.js does.

**The buyer's key never touches the server.** There is no buyer key in env:
you connect the buyer wallet in the browser (MetaMask, or a pasted key that
stays in the tab), and the checkout signs in chat via two signing cards —
SIWE sign-in, then the EIP-3009 payment authorization. Signatures reach the
storefront out-of-band (`POST /api/checkout/:id/signature`), never through the
model's context. The seller key is the only key server-side: that is the
merchant's own backend signing its own transactions.

## The flow

1. You chat with the agent; it reads the catalog and the merchant's accepted
   chain/stablecoin pairs (from the gateway's public `payment_methods`
   endpoint — what's accepted is configured on the gateway, not in this repo).
2. On your explicit confirmation the checkout runs in three tool steps:
   `checkout_begin` creates the order and the rail0 payment in `authorize`
   mode; `checkout_payment` puts a signing card in chat where your browser
   wallet signs the EIP-3009 payload; `checkout_submit` hands the signed
   payment to the storefront.
3. The storefront verifies the payment against the order (payee, amount,
   token, chain) and broadcasts the **authorize**: the buyer's funds are now in
   on-chain escrow. The order shows `in_escrow`.
4. On `/merchant`, fulfil the order: **capture** settles the funds to the
   merchant. Or **void** it: the escrow returns to the buyer.

## Running locally

Prerequisites: **Node 24+** (enforced via `engines`; `.nvmrc` provided), pnpm,
a rail0 gateway to talk to, and an Anthropic API key.

1. **Gateway.** Run the rail0 dev stack (`bin/dev` in `rail0-gateway` — API on
   `http://localhost:9292`), or point `GATEWAY_URL` at a deployed gateway.

2. **Wallets.**
   - The **buyer** wallet connects in the browser at checkout (MetaMask, or a
     pasted key that never leaves the tab). It needs the payment stablecoin
     (e.g. USDC) on the target testnet — EIP-3009 transfers are gasless for
     the buyer. No buyer env var exists.
   - The **seller** wallet must be registered as a payee wallet on the
     gateway, with the stablecoins it accepts activated, and needs native gas
     for authorize/capture/void transactions. Its key goes in
     `SELLER_PRIVATE_KEY`.
   - With the local dev stack, the seeded integration wallets work out of the
     box: the gateway's `config/seeds.yml` documents the test merchants, and
     the sibling `rail0-test/.env` (if you have it) carries usable keys.

3. **Environment.**

   ```bash
   cp .env.example .env.local
   ```

   Fill in `SELLER_PRIVATE_KEY` and `ANTHROPIC_API_KEY` — that's all a local
   run requires. Every variable the app reads is listed and commented in
   [`.env.example`](.env.example); note `SHOP_URL` if you run the app on a
   non-default port.

4. **Run.**

   ```bash
   bin/dev
   ```

   (`bin/dev` seeds `.env.local` from the example on first run, installs
   dependencies, and warns if no gateway is answering. Equivalent by hand:
   `pnpm install && pnpm dev` — one dev server runs Next and the agent
   service together.)

   Open [http://localhost:3000](http://localhost:3000) and pick a side: ask the
   agent to shop on [/buyer](http://localhost:3000/buyer), then capture the
   order on [/merchant](http://localhost:3000/merchant).

## What to change first

The pieces a template adopter always touches, and where they live:

| What | Where |
| --- | --- |
| Product catalog + merchant name | [`catalog.json`](catalog.json) |
| Site title / description | `src/app/layout.tsx` |
| Landing-page copy | `src/app/page.tsx` |
| Agent persona & rules | [`agent/instructions.md`](agent/instructions.md) |
| Chat suggestion chips | `src/app/buyer/page.tsx` |
| Order store (swap for a real DB) | [`src/lib/store.ts`](src/lib/store.ts) |

## Development

```bash
pnpm typecheck   # TypeScript
pnpm lint        # Biome (lint + format check); pnpm lint:fix to write
pnpm test        # Vitest unit tests
```

## Deploying to Vercel

1. Push the repo to GitHub and import it in Vercel (the SDK tarball in
   `vendor/` makes the install self-contained).
2. Add a Redis store: the file store cannot work on Vercel's ephemeral
   filesystem, so attach an Upstash Redis (Vercel Marketplace) or set
   `KV_REST_API_URL` + `KV_REST_API_TOKEN` (also accepted:
   `UPSTASH_REDIS_REST_URL`/`_TOKEN`). When those are present the order
   store automatically lives in a single Redis key instead of `.data/`.
3. Set the environment variables: `GATEWAY_URL` (a deployed rail0 gateway),
   `SELLER_PRIVATE_KEY`, `ANTHROPIC_API_KEY`.
4. Make sure the seller wallet is registered as a payee on that gateway with
   its tokens active and holds gas, and the buyer wallet holds the stablecoin.

## Notes for a real integration

- **Order store**: a deliberately tiny single-user document store
  (`.data/store.json` locally, one Redis key on Vercel) with no locking —
  swap `src/lib/store.ts` for a real database.
- **The seller key in an env var** is demo-grade: in production it belongs in
  a proper secret store or signer. The buyer side already models the real
  thing — the key stays in the buyer's own wallet, and the gateway never
  custodies keys.
- **Catalog** is a static `catalog.json`; the merchant identity is just the
  seller wallet — no accounts to create.
- The SDK is vendored as a tarball in `vendor/` until `@rail0/sdk` is published
  to npm. To pick up rail0-ts changes run `bin/sync-sdk` (builds and packs the
  sibling `../rail0-ts` — override with `RAIL0_TS_DIR` — straight into
  `vendor/`, then re-adds the dependency so the lockfile's integrity hash is
  recomputed), and commit the refreshed tarball.

## Related

- [`rail0`](https://github.com/commercelayer/rail0) — the escrow smart contract
- [`rail0-gateway`](https://github.com/commercelayer/rail0-gateway) — the HTTP API this template talks to
- [`rail0-ts`](https://github.com/commercelayer/rail0-ts) — the TypeScript SDK used here
- `rail0-demo` — the terminal cousin of this template: a buyer agent driving the `rail0` CLI, with the merchant side on rail0-admin
