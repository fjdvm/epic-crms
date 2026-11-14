import { redirect } from "next/navigation";

import { ApprovalsList } from "@/features/approvals/approvals-list";
import { approvals } from "@/features/approvals/server";
import { toView } from "@/features/approvals/view";
import { NO_ACCESS_PATH, RETURNS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

/** Figma "Manager · Approvals": Manager and CEO (view, plus the final step); Admin views; Staff have no access. */
export default async function ApprovalsPage() {
  const staff = await requireModule(RETURNS_MODULE);
  const role = shopRole(staff.role);
  if (role !== "manager" && role !== "ceo" && role !== "admin") redirect(NO_ACCESS_PATH);

  const now = new Date().getTime();
  const rows = await approvals().list(staff, RETURNS_MODULE);
  return <ApprovalsList requests={rows.map(row => toView(row as unknown as Record<string, unknown>))} role={role} now={now} />;
}
