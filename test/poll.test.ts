import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWhileVisible, type VisibilityDocument } from "@/lib/poll";

/** A document whose visibility the test drives. */
function fakeDoc(hidden = false) {
  const listeners = new Set<() => void>();
  const doc: VisibilityDocument & { setHidden(value: boolean): void; listeners: number } = {
    hidden,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    setHidden(value: boolean) {
      doc.hidden = value;
      for (const listener of listeners) listener();
    },
    get listeners() {
      return listeners.size;
    },
  };
  return doc;
}

describe("pollWhileVisible", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks immediately, then on the interval", () => {
    const tick = vi.fn();
    const doc = fakeDoc();
    pollWhileVisible(tick, 1000, doc);

    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("does not tick at all while hidden", () => {
    const tick = vi.fn();
    const doc = fakeDoc(true);
    pollWhileVisible(tick, 1000, doc);

    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("stops when the tab is hidden and resumes when it returns", () => {
    const tick = vi.fn();
    const doc = fakeDoc();
    pollWhileVisible(tick, 1000, doc);
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(3);

    doc.setHidden(true);
    vi.advanceTimersByTime(60_000);
    // The whole point: a minute in the background costs nothing.
    expect(tick).toHaveBeenCalledTimes(3);

    doc.setHidden(false);
    // Immediately, not on the next interval — coming back to a stale screen that looks
    // current is the failure this avoids.
    expect(tick).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it("does not stack a second interval when visibility fires while visible", () => {
    // visibilitychange can fire without the value changing; a naive restart would leave
    // two intervals running and double the rate for the life of the page.
    const tick = vi.fn();
    const doc = fakeDoc();
    pollWhileVisible(tick, 1000, doc);
    doc.setHidden(false);
    doc.setHidden(false);
    tick.mockClear();

    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("stop() clears the interval and unsubscribes", () => {
    const tick = vi.fn();
    const doc = fakeDoc();
    const stop = pollWhileVisible(tick, 1000, doc);
    tick.mockClear();

    stop();
    vi.advanceTimersByTime(10_000);
    expect(tick).not.toHaveBeenCalled();
    // The listener has to go too, or every remount leaves one behind holding its own
    // closure — and a hidden/visible flip would then tick once per past mount.
    expect(doc.listeners).toBe(0);
  });
});
