import { redirect } from "next/navigation";

import { SENIOR_PWD_PAGE } from "@/lib/portal/pages";

/** The review moved under Customers; old links and bookmarks land there. */
export default function SeniorPwdMoved() {
  redirect(SENIOR_PWD_PAGE);
}
