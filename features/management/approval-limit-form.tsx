"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { changeApprovalLimit } from "./settings-actions";
import { pesosText, toCentavos } from "./settings-format";

/** The Approval limit: refunds and write-offs over it need the CEO's final approval. Money authority, so never optimistic. */
export function ApprovalLimitForm({ currentInCentavos }: { currentInCentavos: number | null }) {
  const [value, setValue] = useState(currentInCentavos === null ? "" : String(currentInCentavos / 100));
  const amount = toCentavos(value);
  const error = value.trim() && amount === null ? "Enter an amount in pesos, such as 5000 or 5,000.50." : null;

  return (
    <section className="w-full max-w-[28rem] space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[#1f1a2e]">Approval limit</h2>
        <p className="text-sm text-[#6e6680]">
          A refund or write-off of more than this amount also needs the CEO&apos;s final approval. An amount equal to the limit stops at the Manager.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="approval-limit">Limit (₱)</Label>
        <Input
          id="approval-limit"
          inputMode="decimal"
          value={value}
          disabled={currentInCentavos === null}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "approval-limit-error" : undefined}
        />
        {error && <p id="approval-limit-error" role="alert" className="text-xs text-[#dc2626]">{error}</p>}
        {currentInCentavos !== null ? (
          <p className="text-xs text-[#6e6680]">Current: {pesosText(currentInCentavos)}. Requests keep the limit that applied when they were sent.</p>
        ) : (
          <p role="status" className="text-xs text-[#8a5a00]">The current limit could not be loaded. Reload before changing it.</p>
        )}
      </div>
      <OrderActionDialog
        trigger="Save limit"
        title="Change the Approval limit?"
        description={amount === null ? "Enter a valid amount first." : `Refunds and write-offs of more than ${pesosText(amount)} will need the CEO's final approval. The change is logged under your name.`}
        confirm="Change limit"
        busy="Saving…"
        disabled={amount === null || amount === currentInCentavos}
        run={() => changeApprovalLimit(amount ?? -1)}
        successMessage="Approval limit saved."
      />
    </section>
  );
}
