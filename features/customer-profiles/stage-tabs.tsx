"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useOptimistic, useTransition } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Stage } from "./rules";

export interface StageTab {
  /** Undefined is All. */
  stage?: Stage;
  label: string;
  count: number;
  href: string;
}

const PendingContext = createContext(false);

/** Lets a tab click highlight at once and the list show a skeleton until the new data arrives. */
export function StageNavigation({
  tabs,
  activeStage,
  children,
}: {
  tabs: StageTab[];
  activeStage?: Stage;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticStage, setOptimisticStage] = useOptimistic(activeStage);

  const select = (stage: Stage | undefined, href: string) => {
    startTransition(() => {
      setOptimisticStage(stage);
      router.push(href);
    });
  };

  return (
    <PendingContext.Provider value={pending}>
      <StageTabs tabs={tabs} active={optimisticStage} select={select} />
      {children}
    </PendingContext.Provider>
  );
}

function StageTabs({
  tabs,
  active,
  select,
}: {
  tabs: StageTab[];
  active?: Stage;
  select: (stage: Stage | undefined, href: string) => void;
}) {
  return (
    <nav aria-label="Stage" className="flex flex-wrap gap-1">
      {tabs.map((tab) => {
        const isActive = active === tab.stage;

        return (
          <Link
            key={tab.stage ?? "all"}
            href={tab.href}
            prefetch
            aria-current={isActive ? "page" : undefined}
            onClick={(event) => {
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.button !== 0
              )
                return;
              event.preventDefault();
              select(tab.stage, tab.href);
            }}
            className={cn(
              "rounded-lg px-3.5 py-2 text-sm font-medium",
              isActive
                ? "bg-accent text-primary"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {tab.label} {tab.count}
          </Link>
        );
      })}
    </nav>
  );
}

/** Shows the skeleton in place of the list while a tab's data is loading. */
export function PendingList({ children }: { children: React.ReactNode }) {
  const pending = useContext(PendingContext);

  if (!pending) return children;

  return (
    <div role="status" aria-label="Loading customers" className="space-y-2">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}
