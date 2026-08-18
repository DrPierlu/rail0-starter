import { withEve } from "eve/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Three screens here poll (the order list, the buyer's order card, the budget chip), so
  // the default request log is hundreds of identical `GET /api/shop/orders 200 in 24ms`
  // lines — the one shape of line that never carries information, drowning the ones that
  // do. Silenced per route rather than globally: a POST to capture or void still logs its
  // status, and lib/log.ts adds a line for every gateway operation behind these routes.
  //
  // Anchored and query-tolerant, and the detail pattern stops at one path segment on
  // purpose: `/api/shop/orders/<id>/capture` must keep logging.
  logging: {
    incomingRequests: {
      ignore: [
        /^\/api\/shop\/orders(\?|$)/,
        /^\/api\/shop\/orders\/[^/?]+(\?|$)/,
        /^\/api\/buyer\/budget(\?|$)/,
        // The chat asks this on every mount, and every HMR recompile is a mount.
        /^\/api\/buyer\/session(\?|$)/,
        // The two pages themselves. In dev they are re-fetched on every recompile, so a
        // session of editing prints them dozens of times; what is worth reading there is
        // the compile line and the rail0 operation lines, not that a page rendered again.
        // Only these two exact paths — a 404 on a mistyped route still logs.
        /^\/(buyer|merchant)(\?|$)/,
      ],
    },
  },
  // 127.0.0.1 and localhost are DIFFERENT origins to a browser, and Next blocks
  // cross-origin requests to its dev resources by default — with a 403, not just a
  // warning, so HMR silently stops working. That matters here rather than being a
  // typo the user can avoid: the eve agent service listens on 127.0.0.1 (its
  // "server listening at http://127.0.0.1:<port>" line is what you attach the
  // terminal UI to), so requests carrying that origin are normal for this app.
  //
  // Loopback only. A LAN address here would let other machines on the network reach
  // the dev server, which is the thing the default is protecting against — testing
  // from a phone is a deliberate choice, not something this should grant quietly.
  allowedDevOrigins: ["127.0.0.1"],
};

// Mounts the eve agent from ./agent on this app's origin (/eve/v1/*): one dev
// server, one Vercel deploy, and the browser hook finds the routes on its own.
export default withEve(nextConfig);
