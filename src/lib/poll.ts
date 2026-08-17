/**
 * The visibility-aware half of a polling loop, in one place.
 *
 * Three screens poll here — the merchant's order list and the buyer's two order views —
 * and each tick is a gateway read (the local store this used to rewrite is gone; an order
 * is the payment now). A tab left open behind another one was paying that around the
 * clock, against a rate-limited API, to render screens nobody is looking at.
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

/**
 * How long to wait before the nth poll of a visible stretch.
 *
 * A number is a fixed interval. An ARRAY is a ramp: its entries are used in order and
 * the last one repeats forever — `[500, 1000, 3000]` polls fast twice and then settles.
 *
 * The ramp exists for the chains that settle instantly. Arc reaches its `safe` block at
 * the head, so an authorize is done in well under a second, and a flat 3s interval made
 * the demo's fastest chain look like its slowest: the state was already `in_escrow` and
 * the screen was waiting out an interval to notice. The cost is two extra reads at the
 * start of a wait, not a higher steady rate.
 */
export type PollSchedule = number | readonly number[];

function delayFor(schedule: PollSchedule, attempt: number): number {
  if (typeof schedule === "number") return schedule;
  if (schedule.length === 0) return 1000;
  return schedule[Math.min(attempt, schedule.length - 1)] as number;
}

/** Starts the loop and returns the stop function — call it from an effect's cleanup. */
export function pollWhileVisible(
  tick: () => void,
  schedule: PollSchedule,
  doc: VisibilityDocument = document,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Counts the polls of the CURRENT visible stretch, so coming back to a hidden tab
  // starts the ramp again — which is exactly when the screen is most stale and the fast
  // polls are most useful.
  let attempt = 0;

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  // setTimeout chained rather than setInterval: the delay changes between polls, and a
  // chain also cannot overlap itself if a tick ever takes longer than its own delay.
  const schedulePoll = () => {
    timer = setTimeout(
      () => {
        timer = undefined;
        if (doc.hidden) return;
        attempt += 1;
        tick();
        schedulePoll();
      },
      delayFor(schedule, attempt),
    );
  };

  const sync = () => {
    if (doc.hidden) {
      stop();
      return;
    }
    attempt = 0;
    tick();
    // Guarded rather than restarted: visibilitychange can fire while already visible,
    // and a second chain would double the rate for the rest of the page's life — the
    // kind of leak that only shows up as a bill.
    if (timer === undefined) schedulePoll();
  };

  sync();
  doc.addEventListener("visibilitychange", sync);

  return () => {
    doc.removeEventListener("visibilitychange", sync);
    stop();
  };
}
