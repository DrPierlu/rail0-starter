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
| **Buyer agent** | `agent/` (durable [Vercel eve](https://eve.dev) agent, mounted on this app by `withEve()` in `next.config.ts`) + the chat UI on `/buyer` | Commerce tools: browses the catalog, builds a cart, and on your confirmation starts the checkout below. The session is durable server-side and survives cold starts and deploys |
| **Storefront API** | `src/app/api/shop/*` | The merchant server: products, accepted payment methods and prices (all read live from the gateway and the catalog), the order book, and the escrow. Re-prices what a payment claims to buy, then **authorizes it automatically** — funds move to escrow |
| **Checkout API** | `src/app/api/checkout/*` | The buyer's two server-side steps: create the payment from a SIWE signature, then submit it with the EIP-3009 one. The browser signs; these routes are what talk to rail0 |
| **Merchant view** | `/merchant` | Minimal back-office: order list with live payment state, **Fulfil & capture** and **Cancel & void** buttons. Gated on `MERCHANT_TOKEN` — sign in once per browser |

Both sides use the [`@rail0/sdk`](https://github.com/commercelayer/rail0-ts)
TypeScript SDK — no CLI or binary dependency, so the template deploys anywhere
Next.js does.

**A private key is never typed into the app.** The buyer connects MetaMask and the
checkout card in the chat asks for two signatures — SIWE sign-in, then the EIP-3009
payment authorization — so the key stays in the extension and the page never sees it.
Each signature goes straight to the server route that uses it (`/api/checkout/create`,
`/api/checkout/submit`), never through the model's context, and the browser never talks
to the gateway itself. Between the two, the buyer's gateway session rides in an httpOnly
cookie: the credential belongs to the buyer, not to this server, which is why nothing is
stored here.

**Or the agent buys on its own.** Set `BUYER_PRIVATE_KEY` and the deployment has
its own wallet: `checkout_begin` runs the whole checkout — sign-in, payment
authorization, escrow — with no browser and no human, and answers `step: "done"`.
The key never leaves the server, and no endpoint signs anything with it beyond
the checkout itself. Two ceilings bound that: `BUYER_MAX_ORDER`
(default 25) per order, and `BUYER_MAX_WINDOW` (default 100 over 24h) for the
total — the part a per-order cap cannot do. Above either, the agent asks a person
to approve, then still buys by itself. The window total is read from the
gateway's own record of what the wallet paid, so there is no ledger to keep and
nothing the agent could rewrite. The agent's channel
(`agent/channels/eve.ts`) is closed for the same reason: the approval for an
over-ceiling spend is answered over that channel, so it is gated on `BUYER_TOKEN`
everywhere except a local dev server.

The seller key is server-side by design: that is the merchant's own backend
signing its own transactions.

## The flow

1. You chat with the agent; it reads the catalog and the merchant's accepted
   chain/stablecoin pairs (from the gateway's public `payment_methods`
   endpoint — what's accepted is configured on the gateway, not in this repo).
2. On your explicit confirmation `checkout_begin` prices the cart and puts a
   checkout card in the chat. Your wallet signs in (SIWE), which creates the
   rail0 payment in `authorize` mode as you — the lines ride in the payment's
   `metadata` — and then signs the EIP-3009 payload that funds it.
3. The storefront re-prices what the payment claims to buy against its own
   catalog, checks it pays the right payee in an accepted token, and broadcasts
   the **authorize**: the buyer's funds are now in on-chain escrow. The order
   shows `in_escrow`. (That re-pricing stands in for a lookup a real shop does
   against its own order store — see the notes below.)
4. On `/merchant`, fulfil the order: **capture** settles the funds to the
   merchant. Or **void** it: the escrow returns to the buyer.

## Running locally

Prerequisites: **Node 24+** (enforced via `engines`; `.nvmrc` provided), pnpm,
a rail0 gateway to talk to, and an Anthropic API key.

1. **Gateway.** Run the rail0 dev stack (`bin/dev` in `rail0-gateway` — API on
   `http://localhost:9292`), or point `GATEWAY_URL` at a deployed gateway.

2. **Wallets.**
   - The **buyer** wallet connects in the browser at checkout (MetaMask). Set
     `BUYER_PRIVATE_KEY` instead and there is no browser buyer at all: the agent
     buys as itself, within the ceilings above. Either way it needs the payment
     stablecoin (e.g. USDC) on the target testnet — EIP-3009 transfers are
     gasless for the buyer.
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

   Fill in `SELLER_PRIVATE_KEY`, `ANTHROPIC_API_KEY` and `MERCHANT_TOKEN`
   (`openssl rand -hex 32`) — that's all a local run requires. Every variable
   the app reads is listed and commented in [`.env.example`](.env.example); note
   `SHOP_URL` if you run the app on a non-default port.

   `MERCHANT_TOKEN` guards the merchant's own endpoints — the order list and
   capture/void, which move real escrowed funds. They **fail closed**: while it
   is unset every one of them refuses, with an error that names the variable.
   Paste the same value into `/merchant` to sign in (it goes into an httpOnly
   cookie for 8 hours). The buyer's side needs no credential.

4. **Run.**

   ```bash
   bin/dev
   ```

   (`bin/dev` seeds `.env.local` from the example on first run, installs
   dependencies, and warns if no gateway is answering. Equivalent by hand:
   `pnpm install && pnpm dev` — one dev server runs Next and the agent
   service together.)

   Open [http://localhost:4000](http://localhost:4000) and pick a side: ask the
   agent to shop on [/buyer](http://localhost:4000/buyer), then capture the
   order on [/merchant](http://localhost:4000/merchant).

   **Port 4000 is deliberate.** A full local rail0 stack already holds 3000
   (rail0-admin) and 3001 (the indexer's API), so the app claims one of its own
   instead of drifting to whatever is free. That matters more than tidiness: the
   agent runs as a separate service with no request to derive the storefront
   origin from, so it is told via `SHOP_URL` — and `bin/dev` derives that from
   the same port it binds. Left to drift, the agent's shop calls landed on
   rail0-admin, which answers them.

**The buyer's chat opens clean, and remembers.** Conversations are kept in
`localStorage` (the last 5 — see [`src/lib/chat-history.ts`](src/lib/chat-history.ts)),
but none is resumed on load: the fresh chat comes from what the page mounts, not from
throwing the history away, so a demo handed to the next person never starts mid-sentence
in someone else's cart. **Past chats** in the chat header lists them, newest first, and
resuming one remounts the chat on that eve session — the conversation itself is durable
on the eve server, so a resumed chat continues rather than replays. Nothing is stored
server-side; `×` forgets one.

**What the server logs.** Next's per-request log is silenced for the polled routes (the
order list, an order's detail, the budget chip, the chat's session probe) and for the two
page paths themselves. Visible-tab polling made hundreds of identical
`GET /api/shop/orders 200 in 24ms` lines — the one shape of line that never carries
information — and in dev the pages are re-fetched on every recompile, so editing a
component printed them dozens of times more. Everything else still logs its status,
and [`src/lib/log.ts`](src/lib/log.ts) adds one line per gateway operation instead:

```
rail0 siwe login role=seller address=0x1234abcd…ef9012 expires=2026-08-18T18:22:04Z
rail0 authorize ok payment=0x3f0a12bc…9c1b4d chain=84532 amount=7.09 USDC state=authorizing 812ms
rail0 authorize refused payment=0x77de01aa…2b0f31 chain=84532 amount=2.60 USDC reason=does not cover the catalog price
rail0 capture ok payment=0x3f0a12bc…9c1b4d chain=84532 amount=7.09 USDC state=capturing 640ms
```

Keys, signatures, signed transactions and tokens never reach it: fields are passed by
name, and secret-looking names are dropped and long values truncated as a backstop. Set
`STARTER_LOG=off` to silence these too.

`next.config.ts` allows `127.0.0.1` as a dev origin. A browser treats it as a
different origin from `localhost`, and Next blocks cross-origin requests to its dev
resources with a **403** — not just a warning, so HMR stops working silently. The eve
agent service listens on `127.0.0.1`, so that origin is normal here. Loopback only: a
LAN address would let other machines reach the dev server, which is what the default
protects against.

### Chatting from the terminal (optional)

The browser at `/buyer` is the normal way in. To watch the same agent from a
terminal — tool calls, reasoning, subagents — attach to the running dev server:

```bash
pnpm agent http://127.0.0.1:<port>   # the port from bin/dev's "[eve:dev] server listening at …" line
```

`eve` is a project dev dependency, not a global CLI: run it through the package
manager (`pnpm agent`, i.e. `eve dev`) from the repo. Installing it globally
invites a version mismatch with the one the app runs, and eve keys its workflow
step names by its own version — see [After upgrading `eve`](#after-upgrading-eve).

## What to change first

The pieces a template adopter always touches, and where they live:

| What | Where |
| --- | --- |
| Product catalog + merchant name | [`catalog.json`](catalog.json) |
| Site title / description | `src/app/layout.tsx` |
| Landing-page copy | `src/app/page.tsx` |
| Agent persona & rules | [`agent/instructions.md`](agent/instructions.md) |
| Chat suggestion chips | `src/app/buyer/page.tsx` |
| What an order IS (projected from the payment) | [`src/lib/order-view.ts`](src/lib/order-view.ts) |
| Pricing and the anti-underpay check | [`src/lib/quote.ts`](src/lib/quote.ts) |

## Development

```bash
pnpm typecheck   # TypeScript
pnpm lint        # Biome (lint + format check); pnpm lint:fix to write
pnpm test        # Vitest unit tests
```

Those three are not the whole gate. `next build` and `tsc` both pass on setups where
`next dev` does not — Next drives its incremental compiler API only in dev — so a change
to the toolchain is verified by **starting the dev server and requesting every page**
(`/`, `/buyer`, `/merchant`), not by the three commands above.

Two pins worth knowing before you bump anything:

- **TypeScript stays on 6.x.** TS 7 is the native port and does not expose the JS
  compiler API Next's type-check integration calls, so `next dev` exits with
  *"TypeScript 7.x does not provide the compiler API required by Next.js"*. Next offers
  an experimental CLI fallback; supporting a major the framework doesn't is not a trade
  worth making here.
- **Tailwind must be told where Streamdown's classes live.** `globals.css` carries
  `@source "../../node_modules/streamdown/dist/*.js"` because Tailwind only scans this
  project's own files — without it Streamdown's markdown (lists, tables, code blocks)
  renders unstyled in the buyer chat, and nothing in the build reports it. `biome.json`
  enables `css.parser.tailwindDirectives` so that `@source` is not a parse error.

### The agent runs in a separate process

`withEve()` runs the agent as a sibling dev server, and its cwd is a **per-build
snapshot** under `.eve/dev-runtime/snapshots/<id>/source`. Anything the app resolves
relative to `process.cwd()` therefore resolves differently in the two processes — and
gets a fresh, empty copy after every rebuild.

That is why `bin/dev` exports `SHOP_URL`: the agent's tools call the storefront over
HTTP, and the fallback they would otherwise use (`http://localhost:4000`) is only right
when the app happens to be on that port. If you start the app with a bare `pnpm dev`,
set it by hand.

Nothing else crosses that boundary, which is deliberate — the app keeps no state on
disk, so there is no file the two processes could disagree about. There used to be
(`STARTER_DATA_DIR`, for the order store and the signature stash), and getting it wrong
hung the checkout with nothing visibly broken.

### After upgrading `eve`

Upgrading eve invalidates any workflow run that was still in flight, and the dev server
will say so loudly on the next boot:

```
[workflow-sdk] Workflow replay diverged … code REPLAY_DIVERGENCE
[workflow-sdk] Error while running workflow … CorruptedEventLogError
```

Not a bug and nothing to debug: eve records step names qualified by its own version
(`step//eve@0.29.2//createSessionStep`), so after an upgrade a replay produces a name
the recorded event log does not contain. It exhausts its recovery replays and declares
the log corrupted.

The cure is to discard the stale dev workflow state:

```bash
rm -rf .eve/.workflow-data
```

`.eve/` is gitignored scratch, and this only drops eve's own session/turn bookkeeping.
No orders are lost with it: they live on the gateway, as payments.

## Deploying to Vercel

> **Who may talk to the agent is `agent/channels/eve.ts`.** It is gated on `BUYER_TOKEN`
> everywhere except a local dev server: with an agent wallet configured, talking to the
> agent *is* spending, and the approval that bounds it is answered over this same
> channel. A deployment without the variable answers `401` to every message — fail-closed
> on purpose. The merchant side is gated separately by `MERCHANT_TOKEN`.


```bash
bin/deploy --check   # preflight only
bin/deploy           # preflight, then `eve deploy`
```

The deploy itself is **`eve deploy`** — eve's own command. The agent and the Next app are
one deployable (`withEve` mounts the agent on this app's origin), so there is no second
service to ship, and `eve deploy` links the directory first when it needs to.

`bin/deploy` adds the preflight: a clean tree (Vercel builds what you push), a vendored
SDK tarball that is not older than `../rail0-ts/src` (it is the only source of
`@rail0/sdk` and a tracked artifact, so a stale one ships silently), the three checks,
and the environment the deployed app needs. It refuses rather than deploying when any of
those fail. With the `vercel` CLI installed it reads the project's production
environment; without it, it prints what must be there.

Two things worth knowing before the first deploy:

- **There is nothing to provision.** No Redis, no KV, no database: the app keeps no state
  between requests, so Vercel's ephemeral filesystem has nothing to break.
- **`eve link` pulls AI Gateway credentials that this agent does not use.** `agent.ts`
  builds a direct provider model (`anthropic(...)`), so `ANTHROPIC_API_KEY` is what it
  reads — linking can look like it has supplied model access when it has not.

Manual equivalent, and what to set up once:

1. Push the repo to GitHub and import it in Vercel (the SDK tarball in
   `vendor/` makes the install self-contained).
2. Set the environment variables: `GATEWAY_URL` (a deployed rail0 gateway),
   `SELLER_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `MERCHANT_TOKEN` and `BUYER_TOKEN`
   (without those two the deployed `/merchant` and the chat refuse every request —
   they fail closed, which on a public URL is the only safe default).
3. Make sure the seller wallet is registered as a payee on that gateway with
   its tokens active and holds gas, and the buyer wallet holds the stablecoin.

## Notes for a real integration

- **There is no order store, on purpose.** An order IS a rail0 payment: the gateway
  already records its amount, token, chain, parties, status and every on-chain
  attempt, and the *lines* ride in the payment's `metadata` (jsonb, 4096 bytes). So
  the app reads orders back from the gateway and projects them
  ([`src/lib/order-view.ts`](src/lib/order-view.ts)) instead of keeping a second copy
  that could disagree — which is what the earlier version's write-ahead, stale flag
  and reconciliation map all existed to manage. It also means one less thing to
  provision, and no per-instance state on Vercel.

  The trade is real and worth knowing: the metadata is written by the PAYER, so it is
  a claim. The merchant prices that claim against its own catalog before authorizing
  ([`coversCatalogPrice`](src/lib/quote.ts)) — greater-or-equal, because overpaying is
  the buyer's business and underpaying is the attack. If you need merchant-side data
  the payment cannot carry (fulfilment, addresses, an internal order number), that is
  where a real database goes — keyed by `rail0_id`, alongside the payment rather than
  duplicating it.

  **This re-pricing is a stand-in, not a pattern to copy.** With an order store you
  already have the answer: the order recorded at checkout says what it should cost, and
  authorizing checks the payment against that record. Re-pricing exists here only
  because there is no record — the catalog is the one thing the payer cannot write. Two
  consequences worth keeping in mind if you build on this: the catalog is live while a
  claim is frozen, so editing `catalog.json` changes the verdict on past orders (which
  is why `/merchant` shows it only before the escrow exists — see
  [`priceCheckNote`](src/lib/order-ui.ts)), and a shop whose prices move at all needs
  the recorded order rather than this.
- **The seller key in an env var** is demo-grade: in production it belongs in
  a proper secret store or signer. The buyer side already models the real
  thing — the key stays in the buyer's own wallet, and the gateway never
  custodies keys.
- **Catalog** is a static `catalog.json`; the merchant identity is just the
  seller wallet — no accounts to create.
- **The merchant gate is one shared token**, which is the right size for a
  single-operator template and not for a real back-office: capture/void and the
  order list are exactly as protected as that one secret. A real integration puts
  merchant accounts and roles in front of them (and scopes orders to a buyer, so
  the per-order read is authenticated too — here it is open, which is what lets
  the buyer poll its own order without a credential).
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
