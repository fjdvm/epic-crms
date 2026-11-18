"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { OrderActionDialog } from "./action-dialog";
import { correctProofReading, proceedDespiteFlag } from "./proof-read-actions";
import type { Field } from "./proof-reader";

const SMALL = "h-auto rounded-md bg-white px-2.5 py-1 text-xs text-[#5b2a86] border border-[#d9cce8] hover:bg-[#f6f2fa]";

/**
 * Correct one detail, or proceed despite its flag. Each asks for a reason behind a confirm dialog and only adds a record;
 * neither marks the Order paid. Reversible and with no outside effect, but the server is the one that checks the reader has run, so it waits.
 */
export function ProofReadControls({ proofId, field, label, flagged }: { proofId: number; field: Field; label: string; flagged: boolean }) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [why, setWhy] = useState("");
  return (
    <span className="flex flex-wrap gap-1.5 pt-1">
      <OrderActionDialog
        trigger="Correct"
        triggerClassName={SMALL}
        title={`Correct the ${label.toLowerCase()}?`}
        description="The original reading is kept. Your correction and reason are recorded with your name."
        confirm="Save correction"
        busy="Saving…"
        disabled={!value.trim() || !reason.trim()}
        run={() => correctProofReading(proofId, field, value, reason)}
        successMessage="Correction recorded."
      >
        <div className="space-y-1.5">
          <Label htmlFor={`fix-${proofId}-${field}`} className="text-[13px] font-medium text-foreground">Corrected {label.toLowerCase()}</Label>
          <Input id={`fix-${proofId}-${field}`} value={value} maxLength={200} onChange={e => setValue(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`fix-reason-${proofId}-${field}`} className="text-[13px] font-medium text-foreground">Reason</Label>
          <Textarea id={`fix-reason-${proofId}-${field}`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
        </div>
      </OrderActionDialog>
      {flagged && (
        <OrderActionDialog
          trigger="Proceed anyway"
          triggerClassName={SMALL}
          title={`Proceed despite the ${label.toLowerCase()} flag?`}
          description="This records that you looked at it and went ahead. It does not mark the Order paid, and a reused reference or a third rejected proof still needs a Manager."
          confirm="Record and proceed"
          busy="Saving…"
          disabled={!why.trim()}
          run={() => proceedDespiteFlag(proofId, field, why)}
          successMessage="Recorded."
        >
          <div className="space-y-1.5">
            <Label htmlFor={`go-${proofId}-${field}`} className="text-[13px] font-medium text-foreground">Reason</Label>
            <Textarea id={`go-${proofId}-${field}`} value={why} maxLength={500} onChange={e => setWhy(e.target.value)} />
          </div>
        </OrderActionDialog>
      )}
    </span>
  );
}
