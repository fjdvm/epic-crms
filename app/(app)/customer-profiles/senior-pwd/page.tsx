import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadVerifications } from "@/features/senior-pwd/actions";
import { SeniorPwdChecksList } from "@/features/senior-pwd/checks-list";
import { SENIOR_PWD_MODULE } from "@/lib/portal/config";
import { canWork } from "@/lib/portal/roles";
import { canOpenOrders, requireModule } from "@/lib/portal/staff";
import Loading from "./loading";

/** Nothing outside the Suspense waits on the Portal or the database, so the skeleton reaches the browser at once. */
export default function SeniorPwdChecksPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Data />
    </Suspense>
  );
}

async function Data() {
  const staff = await requireModule(SENIOR_PWD_MODULE);
  const result = await loadVerifications();
  if (!result.ok) {
    return (
      <div className="px-8 py-7">
        <Alert variant="destructive">
          <AlertTitle>Senior/PWD checks are temporarily unavailable</AlertTitle>
          <AlertDescription>{result.reason} Reload to try again.</AlertDescription>
        </Alert>
      </div>
    );
  }
  return <SeniorPwdChecksList list={result.list} now={result.now.toISOString()} readOnly={!canWork(staff)} canOpenOrder={await canOpenOrders()} />;
}
