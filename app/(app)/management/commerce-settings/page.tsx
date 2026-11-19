import { crmsDatabase } from "@/lib/crms-db";
import { FreeDeliveryForm } from "@/features/management/free-delivery-form";
import { loadFreeDeliveryThreshold } from "@/features/management/free-delivery-threshold";
import { PaymentAccountForm } from "@/features/management/payment-account-form";
import { PaymentAccountList } from "@/features/management/payment-account-list";
import { listDisabledMethods, listPaymentAccounts } from "@/features/management/payment-accounts";
import { CommerceSettingsFrame } from "@/features/management/commerce-settings-frame";
import { requireManagement } from "@/lib/portal/staff";

// The server refuses anyone but a Manager or the CEO holding the Management Module; hiding the link is not the gate.
export default async function CommerceSettingsPage() {
  await requireManagement();
  const db = crmsDatabase();
  const [accounts, disabled, threshold] = await Promise.all([
    listPaymentAccounts(db).catch(() => null),
    listDisabledMethods(db).catch(() => []),
    loadFreeDeliveryThreshold(db).catch(() => null),
  ]);

  return (
    <CommerceSettingsFrame>
      <div className="space-y-8">
        <PaymentAccountList accounts={accounts ?? []} failed={accounts === null} disabledMethods={disabled} />
        <PaymentAccountForm />
        <hr className="border-[#e6e1ee]" />
        <FreeDeliveryForm currentInCentavos={threshold} />
      </div>
    </CommerceSettingsFrame>
  );
}
