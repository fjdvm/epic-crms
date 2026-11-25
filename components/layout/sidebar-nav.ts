import {
  Users,
  Building2,
  ShoppingCart,
  CreditCard,
  Truck,
  LayoutGrid,
  LayoutDashboard,
  Mail,
  MessageCircle,
  RotateCcw,
  Star,
  Ticket,
  Users2,
  Package,
  ClipboardCheck,
  Landmark,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  /** The label above its section of the sidebar, as in the Figma. */
  group: string;
  name: string;
  /** Null for an entry whose page does not exist yet: shown dimmed, not clickable. */
  href: string | null;
  icon: LucideIcon;
}

export interface SystemItem {
  fullName: string;
  desc: string;
  icon: LucideIcon;
  active: boolean;
  url?: string;
  /** The Enterprise Portal, which shows the returning card while it opens. */
  portal?: boolean;
  /** The name the Portal knows this System by; the Enterprise Portal entry has none. */
  portalName?: string;
}

export type SystemChild = SystemItem;

export const dashboardItem: NavItem = {
  group: "OVERVIEW",
  name: "Summary",
  href: "/dashboard",
  icon: LayoutDashboard,
};

/** The AI's Unusual activity cards. Manager and Admin only; the shell adds the page for them. */
export const aiInsightsItem: NavItem = {
  group: "OVERVIEW",
  name: "AI insights",
  href: "/dashboard/ai-insights",
  icon: Sparkles,
};

export const customerProfilesItem: NavItem = {
  group: "CUSTOMERS",
  name: "Customer Profiles",
  href: "/customer-profiles",
  icon: Users,
};

export const ordersItem: NavItem = {
  group: "COMMERCE",
  name: "Orders",
  href: "/orders",
  icon: ShoppingCart,
};

/** Read-only stock screen; the quantities come from the IMS. */
export const productsStocksItem: NavItem = {
  group: "COMMERCE",
  name: "Products & Stocks",
  href: "/orders/stock",
  icon: Package,
};

export const paymentsItem: NavItem = {
  group: "COMMERCE",
  name: "Payments",
  href: "/payments",
  icon: CreditCard,
};

export const fulfilmentItem: NavItem = {
  group: "COMMERCE",
  name: "Fulfilment",
  href: "/fulfilment",
  icon: Truck,
};

export const returnsItem: NavItem = {
  group: "COMMERCE",
  name: "Returns",
  href: "/returns",
  icon: RotateCcw,
};

export const approvalsItem: NavItem = {
  group: "MANAGEMENT",
  name: "Approvals",
  href: "/approvals",
  icon: ClipboardCheck,
};

export const ticketsItem: NavItem = {
  group: "CUSTOMER SUPPORT",
  name: "Tickets",
  href: "/tickets",
  icon: Ticket,
};

export const conversationsItem: NavItem = {
  group: "CUSTOMER SUPPORT",
  name: "Conversations",
  href: "/conversations",
  icon: MessageCircle,
};

export const feedbackItem: NavItem = {
  group: "CUSTOMER SUPPORT",
  name: "Feedback",
  href: "/feedback",
  icon: Star,
};

export const commerceSettingsItem: NavItem = {
  group: "MANAGEMENT",
  name: "Commerce Settings",
  href: "/management/commerce-settings",
  icon: Landmark,
};

/** The Figma sidebar, top to bottom. */
export const sidebarItems: NavItem[] = [
  dashboardItem,
  aiInsightsItem,
  customerProfilesItem,
  ordersItem,
  productsStocksItem,
  paymentsItem,
  fulfilmentItem,
  returnsItem,
  ticketsItem,
  conversationsItem,
  feedbackItem,
  approvalsItem,
  commerceSettingsItem,
];

export const systems: SystemItem[] = [
  {
    fullName: "Enterprise Portal",
    desc: "All systems hub & app launcher",
    icon: LayoutGrid,
    active: false,
    portal: true,
    url: process.env.NEXT_PUBLIC_HOST_URL ?? "https://portal.buildwrite.me/",
  },
  {
    fullName: "Customer Relation and Ecommerce Ordering Management System",
    portalName: "CRMS",
    desc: "Contact profiles, tickets & feedback",
    icon: Building2,
    active: true,
    url: process.env.NEXT_PUBLIC_CRMS_URL ?? "https://creoms.buildwrite.me/",
  },
  {
    fullName: "Human Resource Management",
    portalName: "HRMS",
    desc: "Staff directory & payroll",
    icon: Users2,
    active: false,
    url: process.env.NEXT_PUBLIC_HRMS_URL ?? "https://hrms.buildwrite.me/",
  },
  {
    fullName: "Point of Sale",
    portalName: "POS",
    desc: "Retail & register checkout",
    icon: CreditCard,
    active: false,
    url: process.env.NEXT_PUBLIC_POS_URL ?? "https://web-pos-alpha-vert.vercel.app/",
  },
  {
    fullName: "Inventory Management System",
    portalName: "IMS",
    desc: "Inventory & stock management",
    icon: Package,
    active: false,
    url: process.env.NEXT_PUBLIC_IMS_URL ?? "https://br-sims.vercel.app/",
  },
];

/**
 * The switcher entries this person may open: the Enterprise Portal, the System already open,
 * and every System the Portal says an Admin granted them. When the Portal's answer is not known
 * (null) only those first two show, so nothing is offered that may be refused.
 */
export function visibleSystems<T extends { portalName?: string; active: boolean }>(
  all: readonly T[],
  allowed: readonly string[] | null,
): T[] {
  return all.filter(
    (sys) => !sys.portalName || sys.active || (allowed?.includes(sys.portalName) ?? false),
  );
}
