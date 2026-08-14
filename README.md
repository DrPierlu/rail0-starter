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
| **Merchant view** | `/merchant` | Minimal back-office: order list with live payment state, **Fulfil & capture** and **Cancel & void** buttons. Gated on `MERCHANT_TOKEN` — sign in once per browser |

Both sides use the [`@rail0/sdk`](https://github.com/commercelayer/rail0-ts)
TypeScript SDK — no CLI or binary dependency, so the template deploys anywhere
Next.js does.

**A private key is never typed into the app.** The buyer connects MetaMask, and
the checkout signs in chat via two signing cards — SIWE sign-in, then the
EIP-3009 payment authorization — so the key stays in the extension and the page
never sees it. Signatures reach the storefront out-of-band (`POST
/api/checkout/:id/signature`), never through the model's context. That drop-box
is gated on a per-checkout nonce minted when the checkout begins — order ids are
not secret, so without it a guessed id could overwrite a buyer's stashed
signatures and kill the checkout.

For a demo on a machine with no extension, set `BUYER_PRIVATE_KEY` in
`.env.local`: the key stays on the server, the browser asks `/api/buyer/signer`
for a signature and never receives the key itself, and the route refuses to
exist outside `next dev` — so a deployed instance always uses MetaMask. The
seller key is server-side by design: that is the merchant's own backend signing
its own transactions.

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
   - The **buyer** wallet connects in the browser at checkout (MetaMask), or
     comes from `BUYER_PRIVATE_KEY` in `.env.local` when you want to demo
     without an extension — that one is local-development only. It needs the
     payment stablecoin (e.g. USDC) on the target testnet — EIP-3009 transfers
     are gasless for the buyer.
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
| Order store (swap for a real DB) | [`src/lib/store.ts`](src/lib/store.ts) |

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

That is why `bin/dev` exports `STARTER_DATA_DIR` (and `SHOP_URL`): the browser deposits
checkout signatures through a Next route while the agent's tools read them, and with a
cwd-relative path those were two different files. The symptom was a checkout stuck on
*"the sign-in signature has not arrived yet"* with nothing visibly broken. If you start
the app with a bare `pnpm dev`, set both by hand.

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

`.eve/` is gitignored scratch, and this only drops eve's own session/turn bookkeeping —
the order store lives in `.data/store.json` (or Redis) and is untouched.

## Deploying to Vercel

> **Who may talk to the agent is `agent/channels/eve.ts`.** It is set to `none()` —
> anonymous — because this is a public demo: there is no account to authenticate, the
> buyer's key never leaves their browser, and the merchant side is gated separately by
> `MERCHANT_TOKEN`. **Change that line before the app has real users**, or every session
> is anonymous and shared. Without the file at all eve is fail-closed and the deployed
> chat answers `401` to every visitor, which is why it exists.


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

- **A Redis store is not optional.** Vercel's filesystem is read-only for the app, so the
  file driver raises `EROFS` at `checkout_begin` and the buyer flow dies at step one.
- **`eve link` pulls AI Gateway credentials that this agent does not use.** `agent.ts`
  builds a direct provider model (`anthropic(...)`), so `ANTHROPIC_API_KEY` is what it
  reads — linking can look like it has supplied model access when it has not.

Manual equivalent, and what to set up once:

1. Push the repo to GitHub and import it in Vercel (the SDK tarball in
   `vendor/` makes the install self-contained).
2. Add a Redis store: the file store cannot work on Vercel's ephemeral
   filesystem, so attach an Upstash Redis (Vercel Marketplace) or set
   `KV_REST_API_URL` + `KV_REST_API_TOKEN` (also accepted:
   `UPSTASH_REDIS_REST_URL`/`_TOKEN`). When those are present the order
   store automatically lives in a single Redis key instead of `.data/`.
3. Set the environment variables: `GATEWAY_URL` (a deployed rail0 gateway),
   `SELLER_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `MERCHANT_TOKEN` (without it the
   deployed `/merchant` refuses every request — it fails closed, which on a
   public URL is the only safe default).
4. Make sure the seller wallet is registered as a payee on that gateway with
   its tokens active and holds gas, and the buyer wallet holds the stablecoin.

## Notes for a real integration

- **Order store**: a deliberately tiny single-user document store
  (`.data/store.json` locally, one Redis key on Vercel). Read-modify-write goes
  through `DocStore.mutate`, which serializes overlapping callers **inside one
  process** — enough for the order-list refresh, which updates every order at
  once on each poll, and which used to silently drop the checkout's write-ahead.
  It is NOT safe across instances (several Vercel lambdas, or the Next app and
  the agent service on the same Redis key): the whole document is still
  rewritten, with no compare-and-set. Swap `src/lib/store.ts` for a real
  database before more than one writer exists. A document that exists and cannot
  be read (truncated JSON, bad permissions, a corrupt Redis value) is a loud 500
  naming the file or key — never an empty store, because `mutate` writes what it
  read straight back and would erase it.
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
