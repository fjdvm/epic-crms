import { AppShell } from "@/components/layout/app-shell";
import { loadNotifications, viewerFor } from "@/features/notifications/load";
import { crmsDatabase } from "@/lib/crms-db";
import { getShell } from "@/lib/portal/staff";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, permittedPages } = await getShell();

  // Alerts name Customers, so only Staff with a Module that raises them see any, and each sees their own.
  const viewer = viewerFor(staff, permittedPages);
  const notifications = viewer ? await loadNotifications(crmsDatabase, viewer) : null;

  return (
    <AppShell staff={staff} permittedPages={permittedPages} notifications={notifications} hasBell={viewer !== null}>
      {children}
    </AppShell>
  );
}
