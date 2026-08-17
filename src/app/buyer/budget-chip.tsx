"use client";

import { useEffect, useState } from "react";
import { pollWhileVisible } from "@/lib/poll";

interface Budget {
  configured: boolean;
  spent?: string;
  symbol?: string;
  perOrder: number;
  perWindow: number;
  hours: number;
}

const POLL_MS = 5000;

/**
 * The agent's spending ceiling, consumed live (#3).
 *
 * This is the answer to the question every agentic-commerce demo raises and few show:
 * how does an AI pay without being handed a card? It has its OWN wallet and its own
 * ceiling, and the ceiling is measured against the gateway's record of what that wallet
 * has paid — not against anything this app remembers.
 *
 * Worth knowing why that is sound, and why the copy says it: the gateway requires the
 * payer of a new payment to BE the authenticated wallet. Without that rule anyone could
 * create payments naming the agent as payer, and this budget could be exhausted by a
 * third party without a cent being spent — the control would measure someone else's
 * claims. (rail0-gateway#194 records the decision to keep it.)
 */
export function BudgetChip() {
  const [budget, setBudget] = useState<Budget | null>(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/buyer/budget");
      if (res.ok) setBudget(await res.json());
    };
    void load();
    return pollWhileVisible(() => void load(), POLL_MS);
  }, []);

  if (!budget?.configured || budget.perWindow === 0) return null;

  const spent = Number(budget.spent ?? "0");
  const used = Math.min(100, (spent / budget.perWindow) * 100);
  // Amber past four fifths: the interesting moment is not the ceiling itself but the
  // approach to it, because that is when the agent starts asking for a human.
  const bar = used >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div
      className="min-w-44"
      title="Enforced against the gateway's record of this wallet's payments"
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-neutral-500">agent budget · {budget.hours}h</span>
        <span className="font-medium tabular-nums">
          {spent.toFixed(2)} / {budget.perWindow.toFixed(2)} {budget.symbol}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${used}%` }} />
      </div>
      <p className="mt-1 text-[10px] leading-tight text-neutral-400">
        Max {budget.perOrder.toFixed(2)} per order. Over either ceiling the agent asks you first.
      </p>
    </div>
  );
}
