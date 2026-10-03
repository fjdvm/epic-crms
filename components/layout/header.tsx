"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { HeaderNotifications } from "./header-notifications";
import { ThemeToggle } from "./theme-toggle";
import { HeaderProfile } from "./header-profile";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";


function getBreadcrumbItems(pathname: string) {
  const items: Array<{ label: string; href?: string; isCurrent?: boolean }> = [
    { label: "CRM", href: "/customer-profiles" },
  ];

  if (pathname === "/customer-profiles" || pathname.startsWith("/customer-profiles/")) {
    items.push({ label: "Customer Profiles", isCurrent: true });
  }

  return items;
}

export function Header() {
  const rawPathname = usePathname();
  const pathname = rawPathname || "/";
  const breadcrumbItems = getBreadcrumbItems(pathname);

  return (
    <header className="sticky top-0 z-50 flex justify-between items-center w-full px-md sm:px-lg h-16 bg-background border-b border-border">
      {/* Left: Sidebar Toggle & Breadcrumb */}
      <div className="flex items-center gap-sm sm:gap-md flex-1 overflow-hidden">
        <SidebarTrigger className="h-9 w-9 shrink-0  hover:bg-accent text-foreground transition-all cursor-pointer" />
        <Separator orientation="vertical" className="h-5" />
        <Breadcrumb className="overflow-hidden">
          <BreadcrumbList className="flex-nowrap whitespace-nowrap text-sm sm:text-base font-semibold">
            {breadcrumbItems.map((item, index) => (
              <React.Fragment key={index}>
                {index > 0 && <BreadcrumbSeparator className="text-muted-foreground [&>svg]:w-4 [&>svg]:h-4" />}
                <BreadcrumbItem>
                  {item.isCurrent ? (
                    <BreadcrumbPage className="font-bold text-foreground">
                      {item.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild className="text-muted-foreground hover:text-foreground font-semibold">
                      <Link href={item.href || "#"}>{item.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Right: Notifications & Theme */}
      <div className="flex items-center gap-xs shrink-0">
        <HeaderNotifications />
        <ThemeToggle />
        <HeaderProfile />
      </div>
    </header>
  );
}
