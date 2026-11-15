import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { loadVerifications } from "@/features/senior-pwd/actions";
import { VerificationsView } from "@/features/senior-pwd/review-view";
import { SENIOR_PWD_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

export default async function SeniorPwdPage() {
  const staff = await requireModule(SENIOR_PWD_MODULE);
  const result = await loadVerifications();
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      <div className="shrink-0 space-y-1">
        <Link href="/orders" className="text-sm text-[#5b2a86]">Orders</Link>
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Senior/PWD verification</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Check the account name, the ID photo and its number, then approve or decline. The photo is deleted right after review.
        </p>
      </div>
      {result.ok ? (
        <VerificationsView list={result.list} role={shopRole(staff.role)} />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Senior/PWD verification is temporarily unavailable</AlertTitle>
          <AlertDescription>{result.reason} Reload to try again.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
