"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WAITING, waitingLabel, type ApprovalView } from "@/features/approvals/view";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import { formatPesos } from "@/features/customer-profiles/format";
import type { ShopRole } from "@/lib/portal/roles";
import { inspectReturn, writeOffReturn } from "./actions";
import type { ReturnItem, ReturnStatus } from "./returns";

type Condition = "sellable" | "damaged";
const OPTIONS: [Condition, string, string][] = [
  ["sellable", "Sellable", "Added back to stock"],
  ["damaged", "Damaged", "Needs a write-off request"],
];

/**
 * Figma "Inspect what came back", with the spec's limits: whole line items only, no part quantities.
 * Saving adds sellable items back to IMS stock, which is an outside effect, so it waits for the server (spinner at once)
 * and is never optimistic. A write-off is a Manager decision, so it never is either.
 */
export function InspectReturn({ id, number, status, items, role = "manager", requests = [] }: {
  id: number; number: string; status: ReturnStatus; items: ReturnItem[]; role?: ShopRole | null; requests?: ApprovalView[];
}) {
  // One reference per sitting: retrying a lost answer is safe because the storefront repeats nothing it already did.
  const [inspectionId] = useState(() => crypto.randomUUID());
  const [choice, setChoice] = useState<Record<number, Condition>>({});
  const [note, setNote] = useState("");
  const inspected = items.length > 0 && items.every((item) => item.condition);
  const canWork = role === "staff" || role === "manager";
  const damaged = items.filter((item) => item.condition === "damaged");
  const pendingWriteOff = damaged.some((item) => !item.writtenOffAt);
  const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const waiting = requests.find((r) => r.action === "write-off" && WAITING.includes(r.status));
  const approved = requests.find((r) => r.action === "write-off" && r.status === "approved")?.id;
  const ready = items.length > 0 && items.every((item) => choice[item.orderLineId]);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.orderLineId} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#efebf4] pt-2 text-sm text-[#1f1a2e]">
            <span>
              <span className="font-medium">{item.product}</span> · {item.size} × {item.quantity}
              <span className="block text-xs text-[#6e6680]">{formatPesos(item.price)} each</span>
            </span>
            {item.condition ? (
              <span className="text-xs font-medium">
                {item.condition === "sellable" ? "Sellable · back in stock" : item.writtenOffAt ? "Damaged · written off" : "Damaged · write-off needed"}
              </span>
            ) : status === "goods received" && canWork ? (
              <fieldset className="flex gap-3">
                <legend className="sr-only">Condition of {item.product}</legend>
                {OPTIONS.map(([value, label, hint]) => (
                  <label key={value} title={hint} className="flex items-center gap-1.5">
                    <input type="radio" name={`condition-${id}-${item.orderLineId}`} checked={choice[item.orderLineId] === value}
                      onChange={() => setChoice((current) => ({ ...current, [item.orderLineId]: value }))} />
                    {label}
                  </label>
                ))}
              </fieldset>
            ) : (
              <span className="text-xs text-[#6e6680]">Not inspected</span>
            )}
          </li>
        ))}
      </ul>

      {!inspected && status === "goods received" && canWork && (
        <OrderActionDialog
          trigger="Save inspection"
          title={`Save inspection for ${number}?`}
          description="Sellable items go back into stock now. Damaged items need a write-off approval. This cannot be changed afterwards."
          confirm="Save inspection" busy="Saving…" disabled={!ready}
          run={() => inspectReturn(id, inspectionId, items.map((item) => ({ orderLineId: item.orderLineId, condition: choice[item.orderLineId] })))}
          successMessage={`${number} inspected.`}
        />
      )}

      {inspected && pendingWriteOff && canWork && (
        <div className="space-y-2">
          {waiting && <span className="inline-block rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]">{waitingLabel(waiting.status)}</span>}
          {!waiting && (
            <OrderActionDialog
              trigger={role === "staff" && !approved ? "Request approval to write off" : "Write off damaged items"}
              tone="destructive"
              title={`Write off damaged items on ${number}?`}
              description={`The Approval limit counts every item on the Return (${formatPesos(total)}). A Manager approves.`}
              confirm={role === "staff" && !approved ? "Send request" : "Write off"} busy="Saving…"
              disabled={!approved && !note.trim()}
              run={async () => {
                const result = await writeOffReturn(id, approved ? { approvalId: approved } : { reason: note });
                // A request waiting for the Manager is the expected answer, not a refusal.
                return !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
              }}
              successMessage="Write-off recorded, or sent for approval."
            >
              {!approved && (
                <div className="space-y-1.5">
                  <Label htmlFor={`writeoff-note-${id}`} className="text-[13px] font-medium text-foreground">Reason <span className="text-[#dc2626]">*</span></Label>
                  <Textarea id={`writeoff-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is wrong with the goods" />
                </div>
              )}
            </OrderActionDialog>
          )}
        </div>
      )}
    </div>
  );
}
