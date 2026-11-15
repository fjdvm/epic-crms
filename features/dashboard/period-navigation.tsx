"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useOptimistic, useTransition } from "react";

import { DashboardExportButton } from "./export-button";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "./period";

interface PeriodState {
  preset: PeriodPreset;
  select: (preset: PeriodPreset) => void;
  basePath: string;
}

const PeriodContext = createContext<PeriodState | null>(null);

function usePeriod() {
  const state = useContext(PeriodContext);
  if (!state) throw new Error("Period controls must sit inside PeriodNavigation");

  return state;
}

/** Highlight the chosen period immediately; let navigation reuse cached figures without forcing skeletons. */
export function PeriodNavigation({
  preset, basePath = "/dashboard", children,
}: { preset: PeriodPreset; basePath?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(preset);

  const select = (next: PeriodPreset) => {
    startTransition(async () => {
      setOptimistic(next);
      await router.push(`${basePath}?period=${next}`);
    });
  };

  return <PeriodContext.Provider value={{ preset: optimistic, select, basePath }}>{children}</PeriodContext.Provider>;
}

export function PeriodPicker({ exportable = true }: { exportable?: boolean } = {}) {
  const { preset, select, basePath } = usePeriod();

  return (
    <>
      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {PERIOD_PRESETS.map((p) => (
          <Link
            key={p}
            href={`${basePath}?period=${p}`}
            prefetch
            aria-current={p === preset ? "true" : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              select(p);
            }}
            className="rounded-lg border border-[#e4e4e7] bg-white px-3 py-2 text-sm font-medium text-[#18181b] aria-[current=true]:border-[#5b2a86] aria-[current=true]:bg-[#5b2a86] aria-[current=true]:text-white"
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
      </nav>
      {exportable && <DashboardExportButton period={preset} />}
    </>
  );
}
