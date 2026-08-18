/**
 * The server-side log: one line per thing that happened, and nothing per thing that
 * merely got requested.
 *
 * Next's own request log is the default answer, and on this app it is the wrong one. The
 * three screens here poll — the order list every 5s, the buyer's order card faster than
 * that — so a session's output is hundreds of `GET /api/shop/orders 200 in 24ms` lines,
 * identical, saying only that polling works. What is actually worth reading is what the
 * app did against the gateway and the chain: which operation, on which payment, on which
 * chain, and what state it left it in. Those are rare (a handful per order) and they are
 * what a debug session is looking for. The poll routes are silenced in `next.config.ts`;
 * this is what replaces them.
 *
 * NEVER log a key, a signature, a signed transaction, a JWT or the merchant token. Every
 * caller passes fields explicitly for that reason, and `render` still drops secret-looking
 * names and truncates long values as a backstop — a signed transaction is a few thousand
 * hex characters, so a slip would be both a leak and an unreadable log.
 */

export type LogFields = Record<string, string | number | boolean | undefined>;

// Off is a supported choice (a deployment that ships its own instrumentation), but the
// default is on: the whole point is that these lines exist when something goes wrong,
// which is not a moment anyone has spent configuring logging for.
const enabled = process.env.STARTER_LOG !== "off";

/** Field names that must never carry a value into the log, whatever a caller passes. */
const SECRET = /key|secret|signature|signed|jwt|password|private|cookie|auth/i;

/** The longest value worth printing — above this it is a blob, not an identifier. */
const MAX_VALUE = 88;

/**
 * A 0x id or hash, shortened to something a person can compare across two lines.
 *
 * Full ids are 66 characters here (a rail0 id is a 32-byte hash) and three of them on one
 * line is a line nobody reads. Head and tail, because those are the halves that differ.
 */
export function short(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function render(fields: LogFields): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === "") continue;
    if (SECRET.test(name)) continue;
    const text = String(value);
    parts.push(`${name}=${text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text}`);
  }
  return parts.join(" ");
}

function write(line: string): void {
  if (enabled) console.log(`rail0 ${line}`);
}

/** One event, no duration — a session refresh, a decision taken. */
export function logEvent(name: string, fields: LogFields = {}): void {
  write(`${name} ${render(fields)}`.trimEnd());
}

export interface TracedOp {
  /** The operation finished. `fields` describes what it left behind (state, tx). */
  ok(fields?: LogFields): void;
  /** The operation failed. Logs the error's message — never the error object. */
  fail(error: unknown, fields?: LogFields): void;
}

/**
 * Start timing an operation, and log it once when it ends.
 *
 * Nothing is written at the start on purpose: a started line pairs with an ended line
 * only when nothing else is happening, and the gateway calls here overlap (a poll while
 * a capture is in flight). One line per operation, carrying its own outcome, stays
 * readable when three are interleaved.
 */
export function startOp(name: string, fields: LogFields = {}): TracedOp {
  const started = Date.now();
  const finish = (marker: string, extra: LogFields) => {
    const detail = render({ ...fields, ...extra });
    write(`${name} ${marker}${detail ? ` ${detail}` : ""} ${Date.now() - started}ms`);
  };
  return {
    ok: (extra = {}) => finish("ok", extra),
    fail: (error, extra = {}) =>
      finish("FAILED", {
        ...extra,
        error: error instanceof Error ? error.message : String(error),
      }),
  };
}
