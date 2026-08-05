import { makeDocStore } from "@/lib/doc-store";

/**
 * In-flight keyless-checkout state, owned by the BUYER AGENT side.
 *
 * It used to live in `src/lib/store.ts` — the MERCHANT's store — and that was two
 * problems in one place. (#6)
 *
 * It broke the split. `putSigning`/`getSigning` were called by the agent's checkout
 * code AND by a route under `/api/shop`, the merchant's namespace. Deploy the two
 * separately and they are different stores: the browser deposits its signature with
 * the merchant, the agent reads its own empty stash, and `submitSignedPayment`
 * raises "the payment signature has not arrived yet" forever — a checkout that hangs
 * with no error anywhere.
 *
 * And it put a credential across a trust boundary. `auth_token` is the buyer's
 * gateway JWT: 24 hours, and `payer_must_be_caller` already satisfied. Whoever owns
 * that store can act AS the buyer on the gateway — create payments, sign them, read
 * the buyer's whole payment history. This app's premise is that the server never
 * holds the buyer's private KEY; it did not, and instead held something that for a
 * day is close enough.
 *
 * Now it belongs to the agent, which is the party that legitimately needs it: the
 * gateway requires the payer to be the caller, so the buyer's own side must create
 * and sign the payment. The merchant never sees it.
 *
 * WHY A DOC STORE AND NOT eve SESSION STATE: `defineState` only resolves inside
 * authored runtime execution (tools, hooks). The browser hands its signature to a
 * plain HTTP route, which is not that — so the two ends need a store both can
 * reach. It rides the SAME file/Redis drivers as the merchant store (its own
 * document and key, not a section of the merchant's — co-locating them is how the
 * ownership blurred in the first place): the file-only version it briefly had
 * could not work on Vercel at all — `.data/` is read-only there (`EROFS` on
 * `checkout_begin`), and the Next routes and the agent service are separate
 * instances, so a file written by one was invisible to the other.
 *
 * The SIGNATURES themselves are public artifacts (they end up on-chain and at the
 * gateway), so parking them is not the risk; routing them through the model's
 * context, where a mangled hex digit burns the payment, is what this avoids.
 */
export interface SigningEntry {
  /** Checksummed buyer address, fixed at checkout_begin. */
  address: string;
  siwe_message: string;
  siwe_signature?: string;
  /** Buyer-session JWT, held only for this checkout — never sent to the merchant. */
  auth_token?: string;
  rail0_id?: string;
  eip3009_signature?: string;
  /** Unix seconds of the first write — the TTL clock (see EXPIRY_SECS). */
  created_at: number;
}

type SigningData = Record<string, SigningEntry>;

/**
 * Entries expire with the credential they hold: `clearSigning` only runs on the
 * happy path, so an abandoned checkout used to park the buyer's 24h JWT on disk
 * indefinitely. The gateway token is the longest-lived thing in the entry —
 * once it has lapsed the stash is both useless and harmless, so it is purged
 * on the next read.
 */
const EXPIRY_SECS = 24 * 60 * 60;

const store = makeDocStore<SigningData>({
  file: "checkout-signing.json",
  redisKey: "rail0-starter:checkout-signing",
  empty: () => ({}),
});

const expired = (entry: SigningEntry) =>
  Math.floor(Date.now() / 1000) - (entry.created_at ?? 0) > EXPIRY_SECS;

/** Drop expired entries in place; true when anything was removed. */
function purgeExpired(data: SigningData): boolean {
  let removed = false;
  for (const [orderId, entry] of Object.entries(data)) {
    if (expired(entry)) {
      delete data[orderId];
      removed = true;
    }
  }
  return removed;
}

// Read with lazy expiry: expired entries are dropped, and the purge is
// persisted only when it removed something (no write amplification on the
// common empty/fresh case).
//
// Through mutate() like every other access to this store: ONE document holds every
// in-flight checkout, so a read-then-write here rewrote all of them from a stale
// copy. Two buyers signing at the same time meant the second write erased the
// first's entry, and that buyer's checkout then reported "the signature has not
// arrived yet" forever.
async function read(): Promise<SigningData> {
  return store.mutate((data, skip) => {
    if (!purgeExpired(data)) skip();
    return data;
  });
}

export async function getSigning(orderId: string): Promise<SigningEntry | undefined> {
  return (await read())[orderId];
}

/**
 * Create or merge the entry for an order. The first write must carry the fields
 * that define a checkout (address + message); a later patch with neither, against
 * an order that has no entry, is refused rather than creating a half one.
 */
export async function putSigning(
  orderId: string,
  patch: Partial<SigningEntry> & Pick<SigningEntry, "address" | "siwe_message">,
): Promise<SigningEntry>;
export async function putSigning(
  orderId: string,
  patch: Partial<SigningEntry>,
): Promise<SigningEntry | undefined>;
export async function putSigning(
  orderId: string,
  patch: Partial<SigningEntry>,
): Promise<SigningEntry | undefined> {
  return store.mutate((data, skip) => {
    purgeExpired(data);
    const existing = data[orderId];
    if (!existing && (!patch.address || !patch.siwe_message)) {
      skip();
      return undefined;
    }
    const entry = {
      ...(existing ?? {}),
      ...patch,
      // The TTL clock is the FIRST write's, whatever a later patch carries.
      created_at: existing?.created_at ?? Math.floor(Date.now() / 1000),
    } as SigningEntry;
    data[orderId] = entry;
    return entry;
  });
}

/** Drop the entry once the checkout settles or is abandoned — it holds a JWT. */
export async function clearSigning(orderId: string): Promise<void> {
  await store.mutate((data) => {
    purgeExpired(data);
    delete data[orderId];
  });
}
