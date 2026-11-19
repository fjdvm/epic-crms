import { Suspense } from "react";
import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadVerificationDetail } from "@/features/senior-pwd/actions";
import { SeniorPwdCheckDetail } from "@/features/senior-pwd/check-detail";
import { SENIOR_PWD_MODULE } from "@/lib/portal/config";
import { canWork, shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import Loading from "./loading";

export default async function SeniorPwdCheckPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Data params={params} />
    </Suspense>
  );
}

async function Data({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(SENIOR_PWD_MODULE);
  const { id } = await params;
  const result = await loadVerificationDetail(/^\d+$/.test(id) ? Number(id) : 0);
  if (!result.ok) {
    if (result.missing) notFound();
    return (
      <div className="px-8 py-7">
        <Alert variant="destructive">
          <AlertTitle>This ID check is temporarily unavailable</AlertTitle>
          <AlertDescription>{result.reason} Reload to try again.</AlertDescription>
        </Alert>
      </div>
    );
  }
  return <SeniorPwdCheckDetail verification={result.verification} now={result.now.toISOString()} readOnly={!canWork(staff)} role={shopRole(staff.role)} />;
}
