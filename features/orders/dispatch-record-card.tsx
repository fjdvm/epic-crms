"use client";

import { useOptimistic } from "react";

import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";
import { OrderActionDialog } from "./action-dialog";
import { updateDispatchRecord } from "./actions";
import { CourierFields, useCourierForm } from "./courier-fields";
import type { CourierInput, DispatchRecord } from "./dispatch-record";

/** What the edit dialog sends, shown on the card at once. An empty rider box clears that detail. */
function applied(record: DispatchRecord, input: CourierInput): DispatchRecord {
  const text = (value: string | undefined) => value?.trim() || null;
  return {
    courier: input.courier === "Grab" ? "Grab" : "Lalamove", trackingUrl: text(input.trackingUrl),
    rider: record.rider && { name: text(input.riderName), plate: text(input.riderPlate), phone: text(input.riderPhone) },
  };
}

function EditDispatch({ id, record, onOptimistic }: { id: number; record: DispatchRecord; onOptimistic: (input: CourierInput) => void }) {
  const form = useCourierForm({
    courier: record.courier, trackingUrl: record.trackingUrl ?? "",
    riderName: record.rider?.name ?? "", riderPlate: record.rider?.plate ?? "", riderPhone: record.rider?.phone ?? "",
  });
  return (
    <OrderActionDialog
      trigger="Edit dispatch details"
      triggerClassName="h-8 px-3 py-1.5 text-[13px]"
      title={`Change the dispatch details of Order #${id}?`}
      description="Add or fix the courier, booking link or rider details. The Customer is not emailed again."
      confirm="Save changes"
      busy="Saving…"
      disabled={!form.valid}
      run={() => updateDispatchRecord(id, form.input)}
      onOptimistic={() => onOptimistic(form.input)}
      successMessage={`Dispatch details of Order #${id} saved.`}
    >
      <CourierFields form={form} idPrefix="edit-" />
    </OrderActionDialog>
  );
}

/**
 * The booking Staff recorded at dispatch. While the Order is dispatched it can be edited; the change shows at once and
 * rolls back with the reason if the server refuses. Rider details arrive only for Staff and Managers.
 */
export function DispatchRecordCard({ orderId, record, editable }: { orderId: number; record: DispatchRecord; editable: boolean }) {
  const [shown, change] = useOptimistic(record, applied);
  const rows: [string, React.ReactNode][] = [
    ["Courier", shown.courier],
    ["Booking link", shown.trackingUrl
      ? <a href={shown.trackingUrl} target="_blank" rel="noopener noreferrer" className="break-all text-[#5b2a86] underline">{shown.trackingUrl}</a>
      : "No link yet"],
    ...(shown.rider ? [
      ["Rider", shown.rider.name ?? "—"] as [string, string],
      ["Rider contact", shown.rider.phone ?? "—"] as [string, string],
      ["Plate no.", shown.rider.plate ?? "—"] as [string, string],
    ] : []),
  ];
  return (
    <section data-testid="dispatch-record" className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={CARD_TITLE}>Dispatch</h2>
        {editable && <EditDispatch key={JSON.stringify(record)} id={orderId} record={record} onOptimistic={change} />}
      </div>
      <dl className="space-y-1 text-sm text-[#1f1a2e]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="shrink-0 text-[#6e6680]">{label}</dt>
            <dd className="min-w-0 text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
