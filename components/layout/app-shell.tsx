"use client";

import React from "react";
import { useMounted } from "@/hooks/use-mounted";
import { usePathname } from "next/navigation";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { StaffProvider } from "./staff-context";
import type { Staff } from "@/lib/portal/client";

function MainContent({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar();
  const pathname = usePathname();
  const mounted = useMounted();

  // Use a stable class during SSR/hydration (ml-64, matching defaultOpen=true).
  // After mount, switch to the dynamic value based on sidebar state.
  const marginClass = !mounted || open ? "md:ml-64" : "md:ml-0";

  return (
    <div
      className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ${marginClass}`}
    >
      <Header />

      <main
        key={pathname}
        className="flex-1 w-full bg-background relative overflow-y-auto overflow-x-hidden"
      >
        {children}
      </main>
    </div>
  );
}

export function AppShell({
  staff,
  children,
}: {
  staff: Staff;
  children: React.ReactNode;
}) {
  return (
    <StaffProvider staff={staff}>
      <SidebarProvider defaultOpen={true}>
        <div className="flex min-h-screen w-full bg-background text-foreground relative">
          <Sidebar />
          <MainContent>{children}</MainContent>
        </div>
      </SidebarProvider>
    </StaffProvider>
  );
}
