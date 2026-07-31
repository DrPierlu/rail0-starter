import Link from "next/link";
import { VercelLogo } from "./vercel";

// Static landing page: the app plays both sides of the trade, so the entry
// point is a choice of role rather than one of the two views. No data fetching
// here on purpose — the two sides read their own state once you pick one.

const ROLES = [
  {
    href: "/buyer",
    title: "Buyer agent",
    tagline: "Shop by chatting",
    body: "An AI agent browses the merchant's catalog, builds your cart and — on your confirmation — creates the rail0 payment and signs it with the buyer's own key. The funds go into escrow, not to the merchant.",
  },
  {
    href: "/merchant",
    title: "Merchant",
    tagline: "Fulfil and settle",
    body: "The back-office: orders with their live payment state. Fulfil an order to capture the escrow, or cancel it to void the authorization and hand the funds back. Signed with the seller's own key.",
  },
];

const LIFECYCLE = [
  ["authorize", "the buyer's stablecoins move into on-chain escrow at checkout"],
  ["capture", "the merchant settles them after fulfilment"],
  ["void", "or gives them back, and the buyer is made whole"],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Agentic commerce over stablecoin escrow
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-neutral-500">
        This one app plays both sides of the trade, talking to itself over HTTP the way two real
        deployments would. Pick a side.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {ROLES.map((role) => (
          <Link
            key={role.href}
            href={role.href}
            className="group rounded-xl border border-neutral-200 p-5 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
          >
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold">{role.title}</h2>
              <span className="text-xs text-neutral-400">{role.tagline}</span>
              <span className="ml-auto text-neutral-400 transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </div>
            <p className="mt-2 text-sm text-neutral-500">{role.body}</p>
          </Link>
        ))}
      </div>

      <div className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          The lifecycle
        </h3>
        <dl className="mt-3 space-y-1.5 text-sm">
          {LIFECYCLE.map(([step, what]) => (
            <div key={step} className="flex gap-3">
              <dt className="w-24 shrink-0 font-mono text-xs leading-5 text-emerald-600 dark:text-emerald-400">
                {step}
              </dt>
              <dd className="text-neutral-500">{what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-neutral-400">
          Neither key ever leaves its own side: the buyer signs its payments, the seller signs its
          transactions, and the gateway custodies nothing.
        </p>
        <a
          href="https://vercel.com/new"
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
        >
          <VercelLogo className="h-2.5 w-2.5" />
          Deploy on Vercel
        </a>
      </div>
    </main>
  );
}
