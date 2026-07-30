import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "rail0 starter — agentic commerce over escrow",
  description:
    "An AI buyer agent that purchases goods from a merchant's catalog, paying in stablecoins over rail0 escrow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3 text-sm">
            <span className="font-semibold tracking-tight">rail0 starter</span>
            <Link href="/" className="hover:underline">
              Buyer agent
            </Link>
            <Link href="/merchant" className="hover:underline">
              Merchant
            </Link>
            <span className="ml-auto text-xs text-neutral-500">stablecoin escrow payments</span>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
