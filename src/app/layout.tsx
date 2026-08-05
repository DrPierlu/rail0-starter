import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Rail0Logo } from "./rail0-logo";
import { RoleSwitch } from "./role-switch";

export const metadata: Metadata = {
  title: "rail0 starter — agentic commerce over escrow",
  description:
    "An AI buyer agent that purchases goods from a merchant's catalog, paying in stablecoins over rail0 escrow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning covers THIS element's own attributes and text — not
          its descendants, which keep reporting mismatches normally. Scoped that
          narrowly it is safe here and nowhere else: the only attribute this app puts on
          <body> is the constant className above, so there is no real mismatch it could
          hide. What it does hide is the one that fires on every load — browser
          extensions inject their own attributes into <body> before React hydrates
          (ColorZilla's cz-shortcut-listen is the usual culprit), and a console error
          that is always there and never actionable is how you learn to ignore hydration
          errors that matter. */}
      <body className="antialiased" suppressHydrationWarning>
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="flex items-center gap-1.5" aria-label="rail0 starter — home">
              <Rail0Logo className="h-3.5" />
              <span className="font-semibold tracking-tight">starter</span>
            </Link>
            <RoleSwitch />
            <span className="ml-auto hidden text-xs text-neutral-500 sm:inline">
              stablecoin escrow payments
            </span>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
