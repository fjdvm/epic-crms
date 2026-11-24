"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_TRIGGER =
  "rounded-lg px-3.5 py-2 text-sm text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-primary data-[state=active]:shadow-none";

/** Every panel is already on the page (each streams on its own), so switching tabs is instant. */
export function InsightTabs({ tabs }: { tabs: { value: string; label: string; content: ReactNode }[] }) {
  if (tabs.length === 0) return null;
  return (
    <Tabs defaultValue={tabs[0].value} className="flex flex-col gap-4">
      <TabsList aria-label="Insights" className="h-auto w-fit flex-wrap justify-start gap-1 bg-transparent p-0">
        {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className={TAB_TRIGGER}>{tab.label}</TabsTrigger>)}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} forceMount className="mt-0 data-[state=inactive]:hidden">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
