import { crmsDatabase } from "@/lib/crms-db";
import { FreeDeliveryForm } from "@/features/management/free-delivery-form";
import { loadFreeDeliveryThreshold } from "@/features/management/free-delivery-threshold";
import { SeniorPwdDiscountForm } from "@/features/management/senior-pwd-discount-form";
import { loadSeniorPwdDiscount } from "@/features/management/senior-pwd-discount";
import { PaymentAccountList } from "@/features/management/payment-account-list";
import { listDisabledMethods, listPaymentAccounts } from "@/features/management/payment-accounts";
import { CommerceSettingsFrame } from "@/features/management/commerce-settings-frame";
import { ApprovalLimitForm } from "@/features/management/approval-limit-form";
import { AutomaticChecksForm } from "@/features/management/automatic-checks-form";
import { ServiceLevelsForm } from "@/features/management/service-levels-form";
import { loadAutomaticChecks } from "@/features/settings/automatic-checks";
import { currentTargets } from "@/features/tickets/service-level-store";
import { requireManagement } from "@/lib/portal/staff";

// The server refuses anyone but a Manager or the CEO holding the Management Module; hiding the link is not the gate.
export default async function CommerceSettingsPage() {
  await requireManagement();
  const db = crmsDatabase();
  const [accounts, disabled, threshold, discount, limit, targets, checks] = await Promise.all([
    listPaymentAccounts(db).catch(() => null),
    listDisabledMethods(db).catch(() => []),
    loadFreeDeliveryThreshold(db).catch(() => null),
    loadSeniorPwdDiscount(db).catch(() => null),
    db`select limit_in_centavos from crms.approval_settings where singleton`.then(([row]) => (row ? Number(row.limit_in_centavos) : null)).catch(() => null),
    currentTargets(db).catch(() => null),
    loadAutomaticChecks(db).catch(() => null),
  ]);

  return (
    <CommerceSettingsFrame>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-8">
          <PaymentAccountList accounts={accounts ?? []} failed={accounts === null} disabledMethods={disabled} />
        </div>
        <div className="min-w-0 border-t border-[#e6e1ee] pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <FreeDeliveryForm currentInCentavos={threshold} />
          <div className="mt-8 border-t border-[#e6e1ee] pt-8">
            <SeniorPwdDiscountForm current={discount} />
          </div>
          <div className="mt-8 border-t border-[#e6e1ee] pt-8">
            <ApprovalLimitForm currentInCentavos={limit} />
          </div>
          <div className="mt-8 border-t border-[#e6e1ee] pt-8">
            <ServiceLevelsForm current={targets} />
          </div>
        </div>
      </div>
      <div className="mt-8 border-t border-[#e6e1ee] pt-8">
        <AutomaticChecksForm initial={checks} />
      </div>
    </CommerceSettingsFrame>
  );
}
