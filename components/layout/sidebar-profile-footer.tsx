"use client";

import React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Placeholder staff profile until authentication is introduced.
const staff = { name: "Staff Member", role: "Staff" };

export function SidebarProfileFooter() {
  const initials = staff.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-sm p-sm rounded-xl">
      <div className="relative shrink-0">
        <Avatar className="w-11 h-11 border-2 border-border shadow-sm">
          <AvatarFallback className="text-sm bg-primary text-primary-foreground font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span
          className="absolute bottom-0 right-0 w-3 h-3 bg-success rounded-full border-2 border-sidebar"
          title="Online"
        />
      </div>
      <div className="flex-1 overflow-hidden space-y-0.5">
        <p className="text-sm font-bold truncate text-sidebar-foreground leading-tight">
          {staff.name}
        </p>
        <p className="text-xs font-medium text-muted-foreground truncate leading-tight">
          {staff.role}
        </p>
      </div>
    </div>
  );
}
