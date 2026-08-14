import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * One JSON document behind a pluggable driver: a file under `.data/` in local
 * dev, a single Redis key when Redis REST credentials are present (Vercel KV /
 * Upstash) — which is what makes a deployable work on Vercel's ephemeral
 * filesystem.
 *
 * Extracted from the merchant store so BOTH documents ride the same drivers:
 * the checkout signing stash grew its own file-only copy of this logic when it
 * moved out of the store (#6), and that quietly broke the Vercel deploy — the
 * browser's signature deposit hit a read-only filesystem (`EROFS` on
 * `checkout_begin`), and even on a writable one the Next routes and the eve
 * agent service are separate instances, so a file written by one was invisible
 * to the other: the exact "checkout hangs with no error" split #6 fixed for
 * the merchant path.
 *
 * Sharing the driver was necessary and not sufficient. The file driver resolved its
 * path from `process.cwd()`, and the agent service's cwd is a per-build snapshot
 * directory — so locally the split persisted, invisibly, until STARTER_DATA_DIR pinned
 * both processes to one directory (see dataDir below).
 */
export interface DocStore<T> {
  read(): Promise<T>;
  write(data: T): Promise<void>;
  /**
   * Serialized read-modify-write. `fn` receives the current document and mutates it
   * in place; its return value is passed through, and the document is written once
   * `fn` resolves. Call the second argument, `skip()`, to leave the stored document
   * untouched — separate from the return value, so a callback can both report
   * something and decline to write.
   *
   * Every read-then-write on this store must go through here. `read()` + mutate +
   * `write()` at the call site is a lost-update waiting to happen: the whole
   * document is rewritten, so two overlapping callers each write what they read,
   * and the one that finishes last erases the other's change entirely.
   *
   * That is not hypothetical here — `GET /api/shop/orders` refreshes every order
   * with `Promise.allSettled(stored.map(refreshOrder))`, so N of these overlap on
   * every poll, and the merchant dashboard polls every 5s (only while visible) while each buyer card
   * polls every 3s. The casualty was the checkout write-ahead: a refresh that read
   * before it and wrote after it dropped the order's `rail0_id` and `authorizing`
   * state, and nothing could heal that — the refresh path returns early without a
   * rail0_id, and re-attaching fails because the payment is no longer `signed`.
   * Funds escrowed, order stuck at awaiting_payment: exactly the gap the
   * write-ahead exists to close.
   *
   * SCOPE, stated plainly: this serializes callers **within one process**, which is
   * what the polling above produces. It does NOT make the store safe across
   * instances (several Vercel lambdas, or the Next app and the eve agent service
   * writing the same Redis key) — that needs a real compare-and-set, which the
   * single-command REST driver cannot express. Cross-instance writers still race.
   */
  mutate<R>(fn: (data: T, skip: () => void) => R | Promise<R>): Promise<R>;
}

/**
 * What a storage backend has to implement: the plain document read/write pair.
 * `mutate` is not part of it — it is composed once, on top, so the serialization
 * cannot differ between drivers or be forgotten by a new one.
 */
type Driver<T> = Pick<DocStore<T>, "read" | "write">;

/**
 * The stored document exists and cannot be read.
 *
 * Its own class so it is never confused with the legitimately-empty case (nothing
 * stored yet, which is `empty()`), and so a reader can tell "the store is broken"
 * from "the request was wrong". errorResponse needs no branch for it: an Error it
 * does not recognise becomes a 500 with the message verbatim, which is exactly
 * what a corrupt store deserves — the message names the file or key to fix.
 */
export class DocStoreError extends Error {}

function redisCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// Single-command Upstash REST call: POST the command as a JSON array.
async function redis(command: unknown[]): Promise<unknown> {
  const { url, token } = redisCredentials() as { url: string; token: string };
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || body.error) {
    throw new Error(`store redis error: ${body.error ?? response.status}`);
  }
  return body.result;
}

export function makeDocStore<T>(opts: {
  /** File name under `.data/` (local driver). */
  file: string;
  /** Redis key (REST driver). */
  redisKey: string;
  /** Fresh empty document, returned when nothing is stored yet. */
  empty: () => T;
}): DocStore<T> {
  // Resolved lazily so tests can point the store at a temp directory by changing the
  // working directory before the first call.
  //
  // STARTER_DATA_DIR wins over cwd, and it is not a convenience: the eve agent service
  // is a SEPARATE PROCESS whose cwd is a per-build snapshot
  // (.eve/dev-runtime/snapshots/<id>/source), so `process.cwd()` alone gave the browser's
  // deposit and the agent's read two different files — and a fresh, empty one after every
  // rebuild. The browser signed, the route wrote .data/checkout-signing.json, the agent
  // read the snapshot's own copy and answered "the sign-in signature has not arrived yet"
  // forever. bin/dev exports this so both processes resolve the same directory.
  //
  // The doc comment above claimed the shared driver had fixed that split. It fixed it
  // only where Redis is configured; on the file driver in local dev it was still two
  // files.
  const dataDir = () => process.env.STARTER_DATA_DIR ?? path.join(process.cwd(), ".data");
  const dataFile = () => path.join(dataDir(), opts.file);

  const fileDriver: Driver<T> = {
    async read() {
      const file = dataFile();
      try {
        return JSON.parse(readFileSync(file, "utf8")) as T;
      } catch (error) {
        // ENOENT is the ONLY absence: nothing has been written yet, so an empty
        // document is the right answer and a fresh install must not error.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return opts.empty();
        // Anything else means the document IS there and could not be read — a
        // truncated or hand-edited JSON, EACCES. Returning empty() here (which is
        // what a bare `catch` did) was silent, total data loss: the caller is
        // mutate(), which writes the document straight back, so ONE unreadable read
        // replaced every stored order with `{}`. Failing loudly leaves the file
        // untouched and names it, so the bad copy can still be inspected or moved
        // aside — a 500 on the next request is recoverable, an erased store is not.
        throw new DocStoreError(
          `store file ${file} exists but could not be read (${(error as Error).message}) — ` +
            "refusing to treat it as empty, because the next write would erase it. " +
            "Fix the file, or move it aside to start from an empty store.",
        );
      }
    },
    async write(data) {
      const file = dataFile();
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2));
      renameSync(tmp, file);
    },
  };

  const redisDriver: Driver<T> = {
    async read() {
      const raw = (await redis(["GET", opts.redisKey])) as string | null | undefined;
      // An UNSET key is the Redis equivalent of ENOENT — legitimately empty, and the
      // answer on every fresh deployment. That and nothing else: an empty string is a
      // value, i.e. a half-written document, and falls into the corrupt branch below
      // exactly as a zero-byte file does.
      if (raw === null || raw === undefined) return opts.empty();
      try {
        return JSON.parse(raw) as T;
      } catch (error) {
        // Same rule as the file driver, and here the loud failure is also the SAFE
        // one: a corrupt value swallowed as empty() would be written back over the
        // real document on the next mutate(). It stays put instead, which is why the
        // message names the key — deleting it is the deliberate way to start over.
        throw new DocStoreError(
          `store redis key ${opts.redisKey} holds a value that is not valid JSON ` +
            `(${(error as Error).message}) — refusing to treat it as empty, because the ` +
            "next write would erase it. Inspect the value, or DEL the key to start from " +
            "an empty store.",
        );
      }
    },
    async write(data) {
      await redis(["SET", opts.redisKey, JSON.stringify(data)]);
    },
  };

  // The driver is picked per call, not at module load: env-driven, and tests
  // flip it by (un)setting the credentials.
  const driver = () => (redisCredentials() ? redisDriver : fileDriver);

  // One promise chain per store, so overlapping mutate() calls run strictly one
  // after another instead of interleaving their read and write halves. A tail that
  // swallows rejections keeps the chain usable after a failed mutation — otherwise
  // one error would wedge every later write on this store.
  let tail: Promise<unknown> = Promise.resolve();

  return {
    read: () => driver().read(),
    write: (data) => driver().write(data),
    mutate<R>(fn: (data: T, skip: () => void) => R | Promise<R>): Promise<R> {
      const run = tail.then(async () => {
        const active = driver();
        const data = await active.read();
        let shouldWrite = true;
        const result = await fn(data, () => {
          shouldWrite = false;
        });
        // A throw from fn propagates before this line, so a failed mutation leaves
        // the stored document exactly as it was.
        if (shouldWrite) await active.write(data);
        return result;
      });
      tail = run.catch(() => {});
      return run;
    },
  };
}
