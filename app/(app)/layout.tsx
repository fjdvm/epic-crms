import { AppShell } from "@/components/layout/app-shell";
import { getStaff } from "@/lib/portal/staff";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();

  return <AppShell staff={staff}>{children}</AppShell>;
}
