"use client";

import React from "react";
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

export function HeaderNotifications() {
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
          <Badge className="absolute top-1.5 right-1.5 w-2 h-2 p-0 bg-destructive rounded-full" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-80 bg-popover border-border text-popover-foreground z-[99999]" align="end">
        <div className="flex items-center justify-between p-sm border-b border-border">
          <DropdownMenuLabel className="p-0 text-body-sm font-bold text-foreground">
            Notifications
          </DropdownMenuLabel>
          <Button variant="ghost" size="sm" className="h-auto p-0 text-label-sm text-muted-foreground hover:text-foreground">
            <CheckCheck /> Mark all read
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto p-md text-center text-label-sm text-muted-foreground">
          No notifications yet.
        </div>

        <DropdownMenuSeparator className="bg-border m-0" />
        <div className="p-xs text-center">
          <Button variant="ghost" size="sm" className="w-full h-8 text-label-sm font-semibold text-foreground hover:bg-accent">
            View all notifications
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
