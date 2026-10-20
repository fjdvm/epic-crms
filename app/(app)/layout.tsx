import { AppShell } from "@/components/layout/app-shell";
import { loadNotifications, viewerFor } from "@/features/notifications/load";
import { crmsDatabase } from "@/lib/crms-db";
import { getShell } from "@/lib/portal/staff";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, permittedPages } = await getShell();

  // Notifications name Customers, so only Staff with Customer Profiles or Tickets see them, and each sees their own.
  const viewer = viewerFor(staff, permittedPages);
  const notifications = viewer ? await loadNotifications(crmsDatabase, viewer) : null;

  return (
    <AppShell staff={staff} permittedPages={permittedPages} notifications={notifications}>
      {children}
    </AppShell>
  );
}
