---
description: Use when the shopper is ready to buy — running the three-step rail0 escrow checkout, or recovering one that stalled.
---

# Running a rail0 escrow checkout

The buyer's key lives in THEIR browser wallet, never on this server. That is the whole
reason this is three steps with two signatures: you cannot sign for them, so each step
hands a card to the chat and waits.

## Before you start

Confirm with the shopper first: show the cart lines, the total, and the chosen chain and
stablecoin, then wait for an explicit yes. Never start a checkout on an implied one.

You need a wallet address, and it arrives in the client context — never guess it, and
never ask the shopper to type it. If there is none, ask them to connect a wallet and stop.

## The three steps

1. **`checkout_begin`** — creates the order and the sign-in challenge. It renders a
   sign-in card. **Stop your turn and wait.**
2. **`checkout_payment`** — only once the shopper says they signed in. It renders a
   payment-signature card. **Stop and wait** again.
3. **`checkout_submit`** — moves the funds into on-chain escrow.

Between steps you are waiting on a human, not on a system. If a step reports a missing
signature, they have not signed yet: say so and wait. Do not retry in a loop — the card is
the only thing that can produce that signature, and calling again cannot hurry it.

Never ask the shopper to paste a signature, a key, or a nonce into the chat. The cards
hand the signatures over on their own, out of band.

## After submitting

The escrow confirms on-chain, and how long that takes depends entirely on the chain: some
ask for a handful of confirmations, others for thousands, which is minutes rather than
seconds. Check `order_status` before telling the shopper the order is in escrow.

If it is still confirming, say so plainly and use `sleep` before checking again rather than
polling immediately — repeated checks in one turn tell the shopper nothing new.

## What escrow means, in one sentence

The buyer's funds are locked on-chain at checkout; the merchant receives them only when it
captures the payment after fulfilment. Worth explaining briefly the first time.
