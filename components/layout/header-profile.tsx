"use client";

import React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Placeholder staff profile until authentication is introduced.
const staff = { name: "Staff Member", role: "Staff" };

export function HeaderProfile() {
  const initials = staff.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-sm pl-sm">
      <Avatar className="w-8 h-8 border border-border">
        <AvatarFallback className="text-xs bg-primary text-primary-foreground font-bold">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="hidden sm:flex flex-col leading-tight">
        <span className="text-xs font-bold text-foreground">{staff.name}</span>
        <span className="text-[11px] text-muted-foreground">{staff.role}</span>
      </div>
    </div>
  );
}
