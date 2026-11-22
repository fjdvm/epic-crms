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
      {/* One column on a phone. With two columns, the Payment window and the Service levels share a row so they sit level. */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:pr-8">
          <PaymentAccountList accounts={accounts ?? []} failed={accounts === null} disabledMethods={disabled} />
        </div>
        <div className="mt-8 min-w-0 border-t border-[#e6e1ee] pt-8 lg:col-start-1 lg:row-start-2 lg:pr-8">
          <PaymentWindowForm currentHours={paymentWindow} />
        </div>
        <div className="mt-8 min-w-0 border-t border-[#e6e1ee] pt-8 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <FreeDeliveryForm currentInCentavos={threshold} />
          <div className="mt-8 border-t border-[#e6e1ee] pt-8">
            <SeniorPwdDiscountForm current={discount} />
          </div>
        </div>
        <div className="mt-8 min-w-0 border-t border-[#e6e1ee] pt-8 lg:col-start-2 lg:row-start-2 lg:border-l lg:pl-8">
          <ServiceLevelsForm current={targets} />
        </div>
      </div>
      <div className="mt-8 border-t border-[#e6e1ee] pt-8">
        <AutomaticChecksForm initial={checks} />
      </div>
    </CommerceSettingsFrame>
  );
}
