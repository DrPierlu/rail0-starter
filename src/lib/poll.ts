/**
 * The visibility-aware half of a polling loop, in one place.
 *
 * Three screens poll here — the merchant's order list and the buyer's two order views —
 * and each one costs a gateway read per order plus a store rewrite per tick. A tab left
 * open behind another one was paying that around the clock, which on a metered store
 * (Upstash's free tier is 500K commands a month) is most of the budget spent rendering
 * screens nobody is looking at.
 *
 * `tick` runs immediately when visible, then every `ms`. Hidden, the loop stops
 * entirely; on return it runs `tick` again straight away and resumes. That immediate
 * run on return is the load-bearing half: without it you come back to whatever the
 * screen held when you left, which on anything showing payment state is worse than a
 * slow refresh — it looks current and is not.
 *
 * The document is a parameter so the behaviour can be tested without a DOM: the suite
 * runs in node, and a real `document` would mean pulling in jsdom for one function.
 */
export interface VisibilityDocument {
  hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Starts the loop and returns the stop function — call it from an effect's cleanup. */
export function pollWhileVisible(
  tick: () => void,
  ms: number,
  doc: VisibilityDocument = document,
): () => void {
  let interval: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
  };

  const sync = () => {
    if (doc.hidden) {
      stop();
      return;
    }
    tick();
    // Guarded rather than restarted: visibilitychange can fire while already visible,
    // and a second interval would double the rate for the rest of the page's life —
    // the kind of leak that only shows up as a bill.
    if (interval === undefined) interval = setInterval(tick, ms);
  };

  sync();
  doc.addEventListener("visibilitychange", sync);

  return () => {
    doc.removeEventListener("visibilitychange", sync);
    stop();
  };
}
