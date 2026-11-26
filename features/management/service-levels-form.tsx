"use client";

import { useState } from "react";

import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { SettingsCard } from "./settings-card";
import { changeServiceLevels } from "./settings-actions";
import { toHours } from "./settings-format";

export type Targets = { firstReplyHours: number; resolveHours: number };

/** First reply and resolve targets, the same for every Priority. Applies only to Tickets opened afterwards. Never optimistic. */
export function ServiceLevelsForm({ current }: { current: Targets | null }) {
  const [first, setFirst] = useState(current ? String(current.firstReplyHours) : "");
  const [resolve, setResolve] = useState(current ? String(current.resolveHours) : "");
  const firstHours = toHours(first);
  const resolveHours = toHours(resolve);
  const valid = firstHours !== null && resolveHours !== null && resolveHours >= firstHours;
  const unchanged = valid && firstHours === current?.firstReplyHours && resolveHours === current?.resolveHours;

  return (
    <SettingsCard
      title="Service levels"
      description="How long Staff have to first reply to a ticket and to resolve it. The same for every priority, and every hour counts. The clock stops while a ticket is On hold or waiting on the customer."
      footer={
        <>
          {current !== null ? (
            <p className="text-xs text-[#6e6680]">Current: {current.firstReplyHours} h reply · {current.resolveHours} h resolve</p>
          ) : (
            <p role="status" className="text-xs text-[#8a5a00]">The current Service levels could not be loaded. Reload before changing them.</p>
          )}
          <OrderActionDialog
            trigger="Save service levels"
            title="Change the Service levels?"
            description={valid ? `Tickets opened from now on get ${firstHours} h to first reply and ${resolveHours} h to resolve. Tickets already open keep theirs. The change is logged under your name.` : "Enter valid hours first."}
            confirm="Change service levels"
            busy="Saving…"
            disabled={!valid || unchanged}
            run={() => changeServiceLevels(firstHours ?? 0, resolveHours ?? 0)}
            successMessage="Service levels saved."
          />
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="first-reply-hours">First reply (hours)</Label>
          <NumericInput id="first-reply-hours" kind="whole" disabled={current === null} value={first} onChange={(e) => setFirst(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="resolve-hours">Resolve (hours)</Label>
          <NumericInput id="resolve-hours" kind="whole" disabled={current === null} value={resolve} onChange={(e) => setResolve(e.target.value)} />
        </div>
      </div>
      {(first || resolve) && !valid && (
        <p role="alert" className="text-xs text-[#dc2626]">Enter whole hours from 1 to 8760; the resolve target cannot be shorter than the first reply target.</p>
      )}
    </SettingsCard>
  );
}
