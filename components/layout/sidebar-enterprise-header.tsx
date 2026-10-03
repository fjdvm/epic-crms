"use client";

import React from "react";
import { X } from "lucide-react";
import { SidebarHeader, SidebarTrigger } from "@/components/ui/sidebar";

export function SidebarEnterpriseHeader({ isMobile }: { isMobile: boolean }) {
  return (
    <SidebarHeader className="p-3 border-b border-border/50">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col min-w-0 gap-1 p-2">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-sidebar-foreground truncate leading-none">
            Bren Raphael&apos;s
          </h1>
          <span className="text-xs font-semibold bg-violet-500 text-white px-2.5 py-1 rounded-md truncate mt-0.5 w-fit shadow-xs inline-block">
            Customer Relationship Mgmt.
          </span>
        </div>
        {isMobile && (
          <SidebarTrigger
            className="text-muted-foreground hover:text-sidebar-foreground h-8 w-8 rounded-lg shrink-0 cursor-pointer"
            title="Close Sidebar"
          >
            <X className="w-5 h-5" />
          </SidebarTrigger>
        )}
      </div>
    </SidebarHeader>
  );
}
