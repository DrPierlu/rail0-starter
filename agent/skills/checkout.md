---
description: Use when the shopper is ready to buy — running the rail0 escrow checkout, or picking up one that stalled.
---

# Running a rail0 escrow checkout

There are two shapes, and `checkout_begin` tells you which one you are in from its
result. Read that result rather than assuming.

**Autonomous** (`step: "done"`). This deployment has its own wallet, so the checkout
already ran end to end — payment created, signed, escrow broadcast. There is no card,
nothing to wait for, and nobody to ask for a signature. Report what happened and poll
`order_status` until the escrow confirms.

**Human buyer** (`step: "checkout"`). The buyer's key lives in THEIR browser wallet,
never on this server, so you cannot sign for them — and because they hold the
signatures, they also hold the rest of the checkout. The card in the chat asks for both
signatures and submits the payment itself. **Stop your turn there.**

## Before you start

Confirm with the shopper first: show the cart lines, the total, and the chosen chain and
stablecoin, then wait for an explicit yes. Never start a checkout on an implied one.

Pass the wallet address from the client context when there is one — never guess it, and
never ask the shopper to type it. When there is none, still call `checkout_begin`: on a
deployment with its own wallet that is the normal case and the checkout runs anyway. It
answers with an error asking for a connected wallet when it genuinely needs one.

## What happens after `checkout_begin` (human buyer)

Nothing, from you. The card walks the shopper through it:

1. they sign in (a SIWE message — no funds move),
2. the payment is created as them, on the gateway,
3. they sign the payment, and the merchant escrows it.

You will get a chat message when it is done, carrying the order id. Until then you are
waiting on a person, not on a system: say what you are waiting for and stop. There is no
tool that can hurry it, and calling `checkout_begin` again starts a SECOND checkout for
the same cart — which is a second payment the shopper would have to sign.

If they say something went wrong, read the message: a checkout that failed part-way is
restartable with a fresh `checkout_begin`, because nothing was kept anywhere.

Never ask the shopper to paste a signature, a key, or a nonce into the chat.

## After the payment is in

The escrow confirms on-chain, and how long that takes depends entirely on the chain: some
ask for a handful of confirmations, others for thousands, which is minutes rather than
seconds. Check `order_status` with the order id before telling the shopper the order is in
escrow.

If it is still confirming, say so plainly and use `sleep` before checking again rather than
polling immediately — repeated checks in one turn tell the shopper nothing new.

## What escrow means, in one sentence

The buyer's funds are locked on-chain at checkout; the merchant receives them only when it
captures the payment after fulfilment. Worth explaining briefly the first time.
