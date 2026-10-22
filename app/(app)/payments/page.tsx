import { PAYMENTS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function PaymentsPage() {
  await requireModule(PAYMENTS_MODULE);

  return (
    <div className="p-md sm:p-lg space-y-sm">
      <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Payments</h1>
      <p className="text-muted-foreground">This is where Staff will check Payment proof and mark Orders paid. It is not built yet.</p>
    </div>
  );
}
