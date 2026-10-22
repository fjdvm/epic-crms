"use client";

import React, { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
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
        <AlertDialogContent
          onEscapeKeyDown={(event) => loggingOut && event.preventDefault()}
          className="w-[calc(100%-2rem)] max-w-[27.5rem] sm:max-w-[27.5rem] md:max-w-[27.5rem] lg:max-w-[27.5rem] gap-0 overflow-hidden rounded-2xl p-0 sm:p-0"
        >
          <AlertDialogHeader className="flex-row items-start gap-3 px-6 pt-5 pb-4 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#efeaf5] text-primary [&_svg]:size-5">
              <LogOut aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <AlertDialogTitle className="text-lg font-semibold">Log out?</AlertDialogTitle>
              <AlertDialogDescription className="text-[13px]">
                Are you sure you want to log out of the Enterprise Suite?
              </AlertDialogDescription>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row items-center justify-end gap-2 border-t bg-muted/40 px-6 py-3.5 sm:space-x-0">
            <AlertDialogCancel disabled={loggingOut} className="mt-0 sm:mt-0">
              Cancel
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: that would close the dialog and hide the loading state. */}
            <Button type="submit" form="logout-form" disabled={loggingOut}>
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
