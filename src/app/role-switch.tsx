"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Switching side is the demo's main gesture — you shop as the buyer, then hop to the
// merchant to capture, then back — so the two roles are a segmented control in the
// header rather than two ordinary links lost among the rest of the nav.

const SIDES = [
  { href: "/buyer", label: "Buyer agent" },
  { href: "/merchant", label: "Merchant" },
];

export function RoleSwitch() {
  const pathname = usePathname();

  return (
    <div className="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-900">
      {SIDES.map((side) => {
        const active = pathname.startsWith(side.href);
        return (
          <Link
            key={side.href}
            href={side.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-white text-black shadow-sm dark:bg-neutral-700 dark:text-white"
                : "text-neutral-500 hover:text-black dark:hover:text-white"
            }`}
          >
            {side.label}
          </Link>
        );
      })}
    </div>
  );
}
