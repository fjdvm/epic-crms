import { redirect } from "next/navigation";

import { APPROVALS_ID_CHECKS } from "@/lib/portal/pages";

/** The Senior/PWD checks tab was folded into Approvals; old links and bookmarks land on its ID checks. */
export default function SeniorPwdMoved() {
  redirect(APPROVALS_ID_CHECKS);
}
