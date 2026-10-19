import { AppShell } from "@/components/layout/app-shell";
import { loadNotifications } from "@/features/notifications/load";
import { crmsDatabase } from "@/lib/crms-db";
import { getShell } from "@/lib/portal/staff";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, permittedPages } = await getShell();

  // Notifications name Customers, so only Staff who may open Customer Profiles see them.
  const notifications = permittedPages.includes("/customer-profiles")
    ? await loadNotifications(crmsDatabase)
    : null;

  return (
    <AppShell staff={staff} permittedPages={permittedPages} notifications={notifications}>
      {children}
    </AppShell>
  );
}
