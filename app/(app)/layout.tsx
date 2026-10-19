import { AppShell } from "@/components/layout/app-shell";
import { getShell } from "@/lib/portal/staff";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, permittedPages } = await getShell();

  return (
    <AppShell staff={staff} permittedPages={permittedPages}>
      {children}
    </AppShell>
  );
}
