import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadPayments } from "@/features/orders/actions";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { PaymentsView } from "@/features/orders/payment-queue";
import { PAYMENTS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { approvals } from "@/features/approvals/server";
import { toView, WAITING } from "@/features/approvals/view";
import { shopRole } from "@/lib/portal/roles";

export default async function PaymentsPage() {
  const staff = await requireModule(PAYMENTS_MODULE);

  const result = await loadPayments();

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg space-y-md">
        <BackgroundRefresh />
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Payments</h1>
        <Alert variant="destructive">
          <AlertTitle>Payments are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Orders. Reload to try again; if it keeps happening, tell
            whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const requests = (await approvals().list(staff, PAYMENTS_MODULE).catch(() => []))
    .map((row) => toView(row as unknown as Record<string, unknown>))
    .filter((r) => r.action === "payment.approve-anyway");
  const approvalsByOrder: Record<number, { approvalId?: string; waiting?: boolean }> = {};
  for (const r of requests) {
    const entry = (approvalsByOrder[Number(r.targetId)] ??= {});
    if (r.status === "approved") entry.approvalId ??= r.id;
    if (WAITING.includes(r.status)) entry.waiting = true;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Payments</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Customers send a GCash reference number and, optionally, a screenshot. Check it, then mark the Order paid or cancel it. Paid, collected and rejected cover the last 30 days.
        </p>
      </div>
      <PaymentsView rows={result.rows} now={result.now} role={shopRole(staff.role)} approvals={approvalsByOrder} />
    </div>
  );
}
