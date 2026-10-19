"use client";

import React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LOGOUT_PATH } from "@/lib/portal/config";
import { useStaff } from "./staff-context";

export function SidebarProfileFooter() {
  const { name, username, email, role } = useStaff();
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

      <form id="logout-form" action={LOGOUT_PATH} method="post" />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" className="w-full">
            Log out
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-[24rem] sm:max-w-[24rem] md:max-w-[24rem] lg:max-w-[24rem] gap-4 p-6 sm:p-6 rounded-xl">
          <AlertDialogHeader className="gap-2 text-left">
            <AlertDialogTitle className="text-lg font-semibold">Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to log out of the Enterprise Suite?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 sm:mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              form="logout-form"
              className="bg-zinc-900 text-white hover:bg-zinc-800"
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
