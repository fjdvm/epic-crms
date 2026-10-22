"use client";

import React, { useState } from "react";
import { Loader2, LogOut, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ReturningToPortal } from "@/components/loading/returning-to-portal";
import { LOGOUT_PATH } from "@/lib/portal/config";
import { useStaff } from "./staff-context";

export function SidebarProfileFooter() {
  const { name, username, email, role } = useStaff();
  const [loggingOut, setLoggingOut] = useState(false);
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-background p-3 shadow-xs">
        <Avatar className="size-12 shrink-0">
          <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-bold leading-tight text-zinc-900">{name}</p>
          <p className="truncate text-xs leading-tight text-zinc-500">{username}</p>
          <p className="truncate text-xs leading-tight text-zinc-500">{email || "No email"}</p>
          <Badge variant="secondary" className="mt-1 w-fit px-2 py-0 text-[11px] font-semibold">
            {role}
          </Badge>
        </div>
      </div>

      {/* Loading starts on submit: disabling the button in its onClick cancels the submission. */}
      <form id="logout-form" action={LOGOUT_PATH} method="post" onSubmit={() => setLoggingOut(true)} />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" className="w-full">
            <LogOut aria-hidden />
            Log out
          </Button>
        </AlertDialogTrigger>
        {/* Same card as the portal's log out dialog (Figma "Portal UI/UX"): max-w-110, 20/18/16/24 header padding, 14px footer. */}
        <AlertDialogContent
          onEscapeKeyDown={(event) => loggingOut && event.preventDefault()}
          className="flex w-[calc(100%-2rem)] max-w-110 sm:max-w-110 md:max-w-110 lg:max-w-110 flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0 leading-[normal] shadow-[0_20px_48px_rgb(0_0_0/0.2)] sm:rounded-2xl sm:p-0"
        >
          <AlertDialogHeader className="flex shrink-0 flex-row items-start gap-3 space-y-0 pt-5 pr-4.5 pb-4 pl-6 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f3e8ff] text-primary [&_svg]:size-5">
              <LogOut aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <AlertDialogTitle className="text-lg font-semibold leading-[normal] text-foreground">Log out?</AlertDialogTitle>
              <AlertDialogDescription className="text-[13px] leading-[normal] text-[#71717a]">
                You will be signed out of the portal and every system you opened.
              </AlertDialogDescription>
            </div>
            <AlertDialogCancel
              disabled={loggingOut}
              aria-label="Close"
              className="mt-0 size-auto rounded-md border-0 bg-transparent p-1 text-[#71717a] shadow-none outline-none hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:mt-0"
            >
              <X aria-hidden className="size-4.5" />
            </AlertDialogCancel>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex shrink-0 flex-row items-center justify-end gap-2 space-x-0 border-t border-[#f0f0f2] bg-[#fafafa] px-6 py-3.5 sm:space-x-0">
            <AlertDialogCancel
              disabled={loggingOut}
              className="mt-0 h-auto rounded-lg border border-input bg-background px-4 py-[9px] leading-[normal] text-foreground shadow-none hover:bg-accent sm:mt-0"
            >
              Cancel
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: that would close the dialog and hide the loading state. */}
            <Button type="submit" form="logout-form" disabled={loggingOut} className="h-auto rounded-lg px-4 py-[9px] leading-[normal] shadow-none">
              {loggingOut && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {loggingOut ? "Logging out…" : "Log out"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {loggingOut && <ReturningToPortal subtitle="Signing you out securely" />}
    </div>
  );
}
