import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadPayments } from "@/features/orders/actions";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { PaymentsView } from "@/features/orders/payment-queue";
import { PAYMENTS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function PaymentsPage() {
  await requireModule(PAYMENTS_MODULE);

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

    return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Payments</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Customers send a GCash reference number and, optionally, a screenshot. Check it, then mark the Order paid or cancel it. Paid, collected and rejected cover the last 30 days.
        </p>
      </div>
      <PaymentsView rows={result.rows} now={result.now} />
    </div>
  );
}
