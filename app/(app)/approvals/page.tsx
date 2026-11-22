import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApprovalsList } from "@/features/approvals/approvals-list";
import { loadApprovalRows } from "@/features/approvals/overview";
import { isKindFilter } from "@/features/approvals/view";
import { shopRole } from "@/lib/portal/roles";
import { redirect } from "next/navigation";
import { NO_ACCESS_PATH } from "@/lib/portal/config";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Figma "Manager · Approvals". Everything that waits for a person's decision, grouped by type: ID checks, Refunds,
 * Payments, Cancellations, Write-offs, Returns. Staff see the ID checks and the requests they raised; a Manager sees
 * all and decides; CEO and VP decide as Managers; Admin views.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { type } = await searchParams;
  const { staff, rows, unavailable } = await loadApprovalRows();
  const role = shopRole(staff.role);
  if (!role) redirect(NO_ACCESS_PATH);

  const kind = Array.isArray(type) ? type[0] : type;

  return (
    <>
      {unavailable.length > 0 && (
        <Alert variant="destructive" className="mx-8 mt-7">
          <AlertTitle>Some approvals are temporarily unavailable</AlertTitle>
          <AlertDescription>The {unavailable.join(", ")} requests could not be read. Reload to try again.</AlertDescription>
        </Alert>
      )}
      <ApprovalsList requests={rows} role={role} now={new Date().getTime()} initialKind={isKindFilter(kind) ? kind : "all"} />
    </>
  );
}
