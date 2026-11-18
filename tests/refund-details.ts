import { REFUND_FIELDS, todayInManila } from "@/features/returns/refund-record";

/** Adds the details Staff record with a refund (#613) to a form that already carries the proof. */
export function withRefundDetails(form: FormData, details: { amount?: string; via?: string; on?: string; reference?: string } = {}): FormData {
  form.set(REFUND_FIELDS.amount, details.amount ?? "100.00");
  form.set(REFUND_FIELDS.method, details.via ?? "gcash");
  form.set(REFUND_FIELDS.date, details.on ?? todayInManila());
  form.set(REFUND_FIELDS.reference, details.reference ?? "GC-2026-0001");
  return form;
}
