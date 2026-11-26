import { crmsDatabase } from "@/lib/crms-db";
import { FreeDeliveryForm } from "@/features/management/free-delivery-form";
import { loadFreeDeliveryThreshold } from "@/features/management/free-delivery-threshold";
import { SeniorPwdDiscountForm } from "@/features/management/senior-pwd-discount-form";
import { loadSeniorPwdDiscount } from "@/features/management/senior-pwd-discount";
import { PaymentAccountList } from "@/features/management/payment-account-list";
import { listDisabledMethods, listPaymentAccounts } from "@/features/management/payment-accounts";
import { CommerceSettingsFrame } from "@/features/management/commerce-settings-frame";
import { PaymentWindowForm } from "@/features/management/payment-window-form";
import { loadPaymentWindow } from "@/features/management/payment-window";
import { AutomaticChecksForm } from "@/features/management/automatic-checks-form";
import { ServiceLevelsForm } from "@/features/management/service-levels-form";
import { SettingsGroup } from "@/features/management/settings-card";
import { loadAutomaticChecks } from "@/features/settings/automatic-checks";
import { currentTargets } from "@/features/tickets/service-level-store";
import { requireManagement } from "@/lib/portal/staff";

// The server refuses anyone but a Manager-level Role (CEO and VP included) holding the Management Module; hiding the link is not the gate.
export default async function CommerceSettingsPage() {
  await requireManagement();
  const db = crmsDatabase();
  const [accounts, disabled, threshold, discount, targets, checks, paymentWindow] = await Promise.all([
    listPaymentAccounts(db).catch(() => null),
    listDisabledMethods(db).catch(() => []),
    loadFreeDeliveryThreshold(db).catch(() => null),
    loadSeniorPwdDiscount(db).catch(() => null),
    currentTargets(db).catch(() => null),
    loadAutomaticChecks(db).catch(() => null),
    loadPaymentWindow(db).catch(() => null),
  ]);

  return (
    <CommerceSettingsFrame>
      <SettingsGroup title="Payments">
        <PaymentAccountList accounts={accounts ?? []} failed={accounts === null} disabledMethods={disabled} />
      </SettingsGroup>
      <SettingsGroup title="Orders and tickets">
        {/* Equal-height cards in a 2×2 grid, so each row's Save buttons sit level. */}
        <div className="grid grid-cols-2 gap-5">
          <FreeDeliveryForm currentInCentavos={threshold} />
          <SeniorPwdDiscountForm current={discount} />
          <PaymentWindowForm currentHours={paymentWindow} />
          <ServiceLevelsForm current={targets} />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Checks and alerts">
        <AutomaticChecksForm initial={checks} />
      </SettingsGroup>
    </CommerceSettingsFrame>
  );
}
