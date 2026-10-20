"use client";

import React from "react";
import { useMounted } from "@/hooks/use-mounted";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { sidebarItems, type NavItem } from "./sidebar-nav";
import { usePermittedPages } from "./staff-context";
import { SidebarProfileFooter } from "./sidebar-profile-footer";
import { SidebarNavSkeleton } from "./sidebar-nav-skeleton";
import { SidebarEnterpriseHeader } from "./sidebar-enterprise-header";

export function Sidebar() {
  const pathname = usePathname();
  const { open, openMobile, setOpenMobile, toggleSidebar, isMobile } =
    useSidebar();
  const mounted = useMounted();
  const permittedPages = usePermittedPages();
  const groups = sidebarItems
    .filter((item) => permittedPages.includes(item.href))
    .reduce<{ label: string; items: NavItem[] }[]>((acc, item) => {
      const group = acc.find((g) => g.label === item.group);

      if (group) group.items.push(item);
      else acc.push({ label: item.group, items: [item] });

      return acc;
    }, []);

  const isOpen = isMobile ? openMobile : open;

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  if (mounted && !isOpen) {
    return null;
  }

  return (
    <>
      {isMobile && (
        <div
          onClick={toggleSidebar}
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[55] animate-in fade-in duration-200"
        />
      )}
      <aside className="fixed left-0 top-0 h-full w-(--sidebar-width) flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground z-[60] transition-all duration-300 shadow-xl md:shadow-none animate-in slide-in-from-left duration-300">
        <SidebarEnterpriseHeader isMobile={isMobile} />

        <SidebarContent className="px-3 py-4 overflow-y-auto">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              {!mounted ? (
                <SidebarNavSkeleton rows={1} />
              ) : (
                <SidebarMenu className="gap-0.5">
                  {groups.map((group, index) => (
                    <React.Fragment key={group.label}>
                      <li
                        aria-hidden
                        className={`pb-1.5 pl-2.5 text-[11px] font-semibold tracking-wide text-zinc-400 list-none ${
                          index === 0 ? "pt-1" : "pt-[18px]"
                        }`}
                      >
                        {group.label}
                      </li>
                      {group.items.map((item) => {
                        const ItemIcon = item.icon;
                        const isActive =
                          pathname === item.href ||
                          pathname.startsWith(item.href + "/");

                        return (
                          <SidebarMenuItem key={item.name}>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive}
                              className="h-auto w-full flex items-center gap-3 px-2.5 py-[9px] rounded-lg text-[15px] font-medium text-sidebar-foreground transition-colors data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                            >
                              <Link href={item.href} onClick={handleNavClick}>
                                <ItemIcon className="size-[18px] shrink-0" />
                                <span>{item.name}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="py-3.5 pl-4 pr-3 border-t border-sidebar-border">
          <SidebarProfileFooter />
        </SidebarFooter>

        <SidebarRail />
      </aside>
    </>
  );
}
