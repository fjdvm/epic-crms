import { redirect } from "next/navigation";
import { firstPermittedPageOrNoAccess } from "@/lib/portal/staff";

export default async function Home() {
  redirect(await firstPermittedPageOrNoAccess());
}
