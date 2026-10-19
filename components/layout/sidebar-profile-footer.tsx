"use client";

import React from "react";
import { MoreVertical, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LOGOUT_PATH } from "@/lib/portal/config";
import { useStaff } from "./staff-context";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SidebarProfileFooter() {
  const { name, username, email, role } = useStaff();
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="w-full">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="flex items-center gap-3 rounded-xl hover:bg-sidebar-accent transition-colors cursor-pointer group">
            <div className="relative shrink-0">
              <Avatar className="size-[38px]">
                <AvatarFallback className="text-[13px] bg-zinc-900 text-white font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span
                className="absolute bottom-0 right-0 size-[11px] bg-success rounded-full border-2 border-sidebar"
                title="Online"
              />
            </div>
            <div className="flex-1 overflow-hidden space-y-0.5">
              <p className="text-sm font-semibold truncate text-zinc-900 leading-tight">
                {name}
              </p>
              <p className="text-xs text-zinc-500 truncate leading-tight">
                {role}
              </p>
            </div>
            <MoreVertical className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-sidebar-foreground transition-colors" />
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className="w-64 bg-popover border-border text-popover-foreground z-[99999] shadow-xl p-sm"
          side="top"
          align="start"
        >
          <div className="p-sm bg-muted/40 rounded-lg border border-border mb-sm flex items-center gap-sm">
            <Avatar className="w-10 h-10 border border-border shrink-0">
              <AvatarFallback className="text-xs bg-primary text-primary-foreground font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0 overflow-hidden">
              <span className="text-xs font-bold text-foreground truncate">
                {name}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground truncate">
                {username}
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                {email}
              </span>
              <Badge
                variant="outline"
                className="text-[9px] w-fit mt-xs px-xs.5 py-0 font-semibold"
              >
                {role}
              </Badge>
            </div>
          </div>

          <DropdownMenuSeparator className="bg-border" />

          <div className="px-sm py-xs flex flex-col min-w-0 overflow-hidden">
            <span className="text-xs font-bold text-foreground truncate">
              {username}
            </span>
            <span className="text-[11px] text-muted-foreground truncate">
              {email || "No email"}
            </span>
          </div>

          <form action={LOGOUT_PATH} method="post">
            <DropdownMenuItem
              asChild
              onSelect={(event) => event.preventDefault()}
              className="cursor-pointer text-xs font-medium gap-sm p-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <button type="submit" className="w-full">
                <LogOut className="w-3.5 h-3.5" />
                <span className="flex flex-col items-start text-left">
                  <span>Sign out</span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    Signs you out of all Bren Raphael&apos;s systems
                  </span>
                </span>
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
