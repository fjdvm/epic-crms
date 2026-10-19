import { AppShell } from "@/components/layout/app-shell";
import { loadNotifications } from "@/features/notifications/load";
import { crmsDatabase } from "@/lib/crms-db";
import { getShell } from "@/lib/portal/staff";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, permittedPages } = await getShell();

  const notifications = await loadNotifications(crmsDatabase);

  return (
    <AppShell staff={staff} permittedPages={permittedPages} notifications={notifications}>
      {children}
    </AppShell>
  );
}
