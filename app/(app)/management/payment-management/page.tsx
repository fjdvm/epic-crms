import { crmsDatabase } from "@/lib/crms-db";
import { PaymentAccountForm } from "@/features/management/payment-account-form";
import { PaymentAccountList } from "@/features/management/payment-account-list";
import { listPaymentAccounts } from "@/features/management/payment-accounts";
import { ManagementFrame } from "@/features/management/tabs";
import { requireManagement } from "@/lib/portal/staff";

// The server refuses anyone but a Manager or the CEO holding the Management Module; hiding the link is not the gate.
export default async function PaymentManagementPage() {
  await requireManagement();
  const accounts = await listPaymentAccounts(crmsDatabase()).catch(() => null);

  return (
    <ManagementFrame active="/management/payment-management">
      <div className="space-y-8">
        <PaymentAccountList accounts={accounts ?? []} failed={accounts === null} />
        <PaymentAccountForm />
      </div>
    </ManagementFrame>
  );
}
