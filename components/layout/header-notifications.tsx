"use client";

import React, { useTransition } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatAgo } from "@/features/customer-profiles/format";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/features/notifications/actions";
import type { NotificationFeed } from "@/features/notifications/notifications";

export function HeaderNotifications({ feed }: { feed: NotificationFeed | null }) {
  const [pending, startTransition] = useTransition();
  const unread = feed?.unread ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground relative w-8 h-8 cursor-pointer"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <Badge
              variant="notification"
              aria-label={`${unread} unread`}
              className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 py-0 text-[10px] leading-none justify-center"
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-80 bg-popover border-border text-popover-foreground z-[99999]" align="end">
        <div className="flex items-center justify-between p-sm border-b border-border">
          <DropdownMenuLabel className="p-0 text-body-sm font-bold text-foreground">
            Notifications
          </DropdownMenuLabel>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || unread === 0}
            onClick={() => startTransition(() => markAllNotificationsRead())}
            className="h-auto p-0 text-label-sm text-muted-foreground hover:text-foreground"
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto">
          {feed === null ? (
            <p className="p-md text-center text-label-sm text-muted-foreground">
              Notifications are temporarily unavailable.
            </p>
          ) : feed.notifications.length === 0 ? (
            <p className="p-md text-center text-label-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul>
              {feed.notifications.map((n) => (
                <li key={n.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/customer-profiles/${encodeURIComponent(n.customerId)}`}
                    onClick={() => {
                      if (!n.read) startTransition(() => markNotificationRead(n.id));
                    }}
                    className="flex items-start gap-sm p-sm hover:bg-accent"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-badge-notification"}`}
                    />
                    <span className="min-w-0">
                      <span className={`block truncate text-body-sm ${n.read ? "" : "font-semibold"}`}>
                        {n.customerName} became a Customer
                      </span>
                      <span className="block text-label-sm text-muted-foreground">
                        {formatAgo(n.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DropdownMenuSeparator className="bg-border m-0" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
