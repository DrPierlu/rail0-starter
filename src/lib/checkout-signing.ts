import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

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
 * the buyer's whole payment history. This branch's premise is that the server never
 * holds the buyer's private KEY; it did not, and instead held something that for a
 * day is close enough.
 *
 * Now it belongs to the agent, which is the party that legitimately needs it: the
 * gateway requires the payer to be the caller, so the buyer's own side must create
 * and sign the payment. The merchant never sees it.
 *
 * WHY A FILE AND NOT eve SESSION STATE: `defineState` only resolves inside authored
 * runtime execution (tools, hooks). The browser hands its signature to a plain HTTP
 * route, which is not that — so the two ends need a store both can reach. Scoped to
 * this deployable rather than shared with the merchant is the whole point.
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
}

type SigningData = Record<string, SigningEntry>;

// Its own file, not a section of the merchant's document: co-locating them is how
// the ownership blurred in the first place.
const FILE = path.join(process.cwd(), ".data", "checkout-signing.json");

function read(): SigningData {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as SigningData;
  } catch {
    return {};
  }
}

function write(data: SigningData): void {
  mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, FILE);
}

export async function getSigning(orderId: string): Promise<SigningEntry | undefined> {
  return read()[orderId];
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
  const data = read();
  const existing = data[orderId];
  if (!existing && (!patch.address || !patch.siwe_message)) return undefined;
  const entry = { ...(existing ?? {}), ...patch } as SigningEntry;
  data[orderId] = entry;
  write(data);
  return entry;
}

/** Drop the entry once the checkout settles or is abandoned — it holds a JWT. */
export async function clearSigning(orderId: string): Promise<void> {
  const data = read();
  delete data[orderId];
  write(data);
}
