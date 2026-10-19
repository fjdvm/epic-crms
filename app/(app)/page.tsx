import { redirect } from "next/navigation";
import { homePage } from "@/lib/portal/staff";

export default async function Home() {
  redirect(await homePage());
}
