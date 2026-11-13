"use client";

import { HeaderNotifications } from "./header-notifications";
import { useFeedActions, useLiveFeed } from "@/features/notifications/live-updates";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function Header() {
  const notifications = useLiveFeed();
  const { markRead, markAllRead } = useFeedActions();

  return (
    <header className="sticky top-0 z-50 flex justify-between items-center w-full gap-4 px-4 sm:px-6 h-16 bg-background border-b border-sidebar-border">
      <SidebarTrigger className="h-8 w-8 shrink-0 rounded-md hover:bg-sidebar-accent text-foreground transition-all cursor-pointer" />
      <div className="flex-1" />

      {/* Right: Notifications */}
      <div className="flex items-center gap-xs shrink-0">
        <HeaderNotifications feed={notifications} onMarkRead={markRead} onMarkAllRead={markAllRead} />
      </div>
    </header>
  );
}
