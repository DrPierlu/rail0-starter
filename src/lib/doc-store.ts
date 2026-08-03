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
 */
export interface DocStore<T> {
  read(): Promise<T>;
  write(data: T): Promise<void>;
}

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
  // Resolved lazily so tests can point the store at a temp directory by
  // changing the working directory before the first call.
  const dataFile = () => path.join(process.cwd(), ".data", opts.file);

  const fileDriver: DocStore<T> = {
    async read() {
      try {
        return JSON.parse(readFileSync(dataFile(), "utf8")) as T;
      } catch {
        return opts.empty();
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

  const redisDriver: DocStore<T> = {
    async read() {
      const raw = (await redis(["GET", opts.redisKey])) as string | null;
      return raw ? (JSON.parse(raw) as T) : opts.empty();
    },
    async write(data) {
      await redis(["SET", opts.redisKey, JSON.stringify(data)]);
    },
  };

  // The driver is picked per call, not at module load: env-driven, and tests
  // flip it by (un)setting the credentials.
  return {
    read: () => (redisCredentials() ? redisDriver : fileDriver).read(),
    write: (data) => (redisCredentials() ? redisDriver : fileDriver).write(data),
  };
}
