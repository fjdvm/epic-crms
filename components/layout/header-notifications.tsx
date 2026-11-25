"use client";

import React from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { describeNotification } from "@/features/notifications/describe";
import type { NotificationFeed } from "@/features/notifications/notifications";

/** Same date and time as the other Systems' bells, e.g. "11/26/2026, 12:26:48 AM", in Philippine time. */
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export function HeaderNotifications({
  feed,
  onMarkRead,
  onMarkAllRead,
}: {
  feed: NotificationFeed | null;
  /** Called as a row is opened, before navigation, so a slow link cannot leave it highlighted. */
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
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

      <DropdownMenuContent className="w-80 p-0 bg-popover border-border text-popover-foreground shadow-lg z-[99999]" align="end">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <DropdownMenuLabel className="p-0 text-base font-semibold text-foreground">
            Notifications
          </DropdownMenuLabel>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            onClick={onMarkAllRead}
            className="h-auto p-0 text-sm font-medium text-primary hover:bg-transparent hover:text-primary/80"
          >
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {feed === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Notifications are temporarily unavailable.
            </p>
          ) : feed.notifications.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground space-y-1">
              <Bell aria-hidden className="size-6 mx-auto opacity-30" />
              <p className="text-sm font-medium">No notifications yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {feed.notifications.map((n) => {
                const { text, href } = describeNotification(n);
                const createdAt = new Date(n.createdAt);

                return (
                <li key={n.id}>
                  <Link
                    href={href}
                    onClick={() => {
                      if (!n.read) onMarkRead(n.id);
                    }}
                    className={`flex items-start gap-2.5 p-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${n.read ? "" : "bg-muted/50"}`}
                  >
                    <span aria-hidden className="p-1.5 rounded-full bg-muted border border-border mt-0.5 shrink-0">
                      <Bell className="size-3.5 text-muted-foreground" />
                    </span>
                    <span className="flex-1 min-w-0 space-y-0.5">
                      <span className="block text-sm font-semibold text-foreground break-words">{text}</span>
                      <time dateTime={createdAt.toISOString()} className="block text-xs text-muted-foreground">
                        {timeFormat.format(createdAt)}
                      </time>
                      {!n.read && <span className="sr-only">Unread</span>}
                    </span>
                  </Link>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
