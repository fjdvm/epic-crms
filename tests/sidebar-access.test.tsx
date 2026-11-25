// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";
import { StaffProvider } from "@/components/layout/staff-context";
import { SidebarProvider } from "@/components/ui/sidebar";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  path.current = "/";
  cleanup();
  vi.unstubAllGlobals();
});

const ada = { name: "Ada Okafor", id: "ada", username: "ada.okafor", email: "ada@brenraphaels.test", role: "Customer Support" };

function renderSidebar(permittedPages: string[]) {
  return render(
    <StaffProvider staff={ada} permittedPages={permittedPages}>
      <SidebarProvider defaultOpen>
        <Sidebar />
      </SidebarProvider>
    </StaffProvider>,
  );
}

describe("the sidebar", () => {
  it("lists a page the Staff member holds a Module for", async () => {
    renderSidebar(["/customer-profiles"]);

    expect(await screen.findByRole("link", { name: "Customer Profiles" })).toBeTruthy();
  });

  it("omits pages the Staff member holds no Module for", async () => {
    renderSidebar([]);
    await screen.findByText("Ada Okafor");

    expect(screen.queryByRole("link", { name: "Customer Profiles" })).toBeNull();
  });

  it("no longer lists Senior/PWD checks in the sidebar, even with the Senior/PWD page", async () => {
    renderSidebar(["/customer-profiles", "/customer-profiles/senior-pwd"]);
    await screen.findByRole("link", { name: "Customer Profiles" });
    expect(screen.queryByRole("link", { name: "Senior/PWD checks" })).toBeNull();
  });

  it("groups Customer Profiles under CUSTOMERS and shows the system name", async () => {
    renderSidebar(["/customer-profiles"]);

    expect(await screen.findByText("CUSTOMERS")).toBeTruthy();
    expect(screen.getByText("Customer Relation & Ecommerce Ordering Management System")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("omits the CUSTOMERS group when no page is permitted", async () => {
    renderSidebar([]);
    await screen.findByText("Ada Okafor");

    expect(screen.queryByText("CUSTOMERS")).toBeNull();
  });

  it("shows the Tickets and Conversations tabs only with the Tickets pages permitted", async () => {
    renderSidebar(["/customer-profiles", "/tickets", "/conversations"]);

    expect(await screen.findByRole("link", { name: "Tickets" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conversations" })).toBeTruthy();
  });

  it("hides the Tickets and Conversations tabs without the Tickets Module", async () => {
    renderSidebar(["/customer-profiles"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    expect(screen.queryByRole("link", { name: "Tickets" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Conversations" })).toBeNull();
  });

  it("puts Tickets and Conversations under their own CUSTOMER SUPPORT label, after CUSTOMERS", async () => {
    renderSidebar(["/customer-profiles", "/tickets", "/conversations"]);

    const customers = await screen.findByText("CUSTOMERS");
    const service = screen.getByText("CUSTOMER SUPPORT");

    expect(customers.compareDocumentPosition(service) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Customer Profiles",
      "Tickets",
      "Conversations",
    ]);
  });

  it("shows only the CUSTOMER SUPPORT label with just the Tickets Module", async () => {
    renderSidebar(["/tickets", "/conversations"]);

    expect(await screen.findByText("CUSTOMER SUPPORT")).toBeTruthy();
    expect(screen.queryByText("CUSTOMERS")).toBeNull();
  });

  it("lists the groups in order, with Products & Stocks beside Orders and Approvals under Management", async () => {
    renderSidebar(["/dashboard", "/customer-profiles", "/orders", "/orders/stock", "/payments", "/tickets", "/approvals"]);

    await screen.findByText("OVERVIEW");
    const text = document.body.textContent ?? "";
    const order = ["OVERVIEW", "Summary", "CUSTOMERS", "Customer Profiles", "COMMERCE", "Orders", "Products & Stocks", "Payments", "CUSTOMER SUPPORT", "Tickets", "MANAGEMENT", "Approvals"];
    const at = order.map((t) => text.indexOf(t));

    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(screen.getByRole("link", { name: "Products & Stocks" }).getAttribute("href")).toBe("/orders/stock");
  });

  it("highlights only Products & Stocks on its own page, not Orders", async () => {
    path.current = "/orders/stock";
    renderSidebar(["/orders", "/orders/stock"]);

    const stock = await screen.findByRole("link", { name: "Products & Stocks" });
    expect(stock.closest("[data-active=true]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Orders" }).closest("[data-active=true]")).toBeNull();
  });

  it("hides Products & Stocks when no Commerce page is permitted", async () => {
    renderSidebar(["/customer-profiles"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    expect(screen.queryByText("Products & Stocks")).toBeNull();
    expect(screen.queryByText("COMMERCE")).toBeNull();
  });

  it("links the Summary only for Staff who hold the Dashboard Module", async () => {
    const { unmount } = renderSidebar(["/dashboard", "/customer-profiles"]);

    expect((await screen.findByRole("link", { name: "Summary" })).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText("AI insights")).toBeNull();
    unmount();

    renderSidebar(["/customer-profiles"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    expect(screen.queryByText("Summary")).toBeNull();
  });

  it("lists AI Insights under Summary when permitted, and highlights only it on its own page", async () => {
    path.current = "/dashboard/ai-insights";
    renderSidebar(["/dashboard", "/dashboard/ai-insights", "/customer-profiles"]);

    const insights = await screen.findByRole("link", { name: "AI insights" });
    expect(insights.getAttribute("href")).toBe("/dashboard/ai-insights");
    expect(screen.getAllByRole("link").map((link) => link.textContent).slice(0, 2)).toEqual(["Summary", "AI insights"]);
    expect(insights.closest("[data-active=true]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Summary" }).closest("[data-active=true]")).toBeNull();
  });

  it("links Orders, Payments and Fulfilment only for the Modules the Staff member holds", async () => {
    renderSidebar(["/orders", "/fulfilment"]);

    expect((await screen.findByRole("link", { name: "Orders" })).getAttribute("href")).toBe("/orders");
    expect(screen.getByRole("link", { name: "Fulfilment" }).getAttribute("href")).toBe("/fulfilment");
    expect(screen.queryByText("Payments")).toBeNull();
  });

  it("links Returns only for Staff holding the Returns Module", async () => {
    renderSidebar(["/returns"]);

    expect((await screen.findByRole("link", { name: "Returns" })).getAttribute("href")).toBe("/returns");
    cleanup();
    renderSidebar(["/customer-profiles"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    expect(screen.queryByText("Returns")).toBeNull();
  });

  it("hides Orders, Payments and Fulfilment entirely, not even dimmed, without their Modules", async () => {
    renderSidebar(["/customer-profiles"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    for (const name of ["Orders", "Payments", "Fulfilment"]) expect(screen.queryByText(name)).toBeNull();
  });

  it("shows the Feedback item only with the Feedback page permitted", async () => {
    renderSidebar(["/customer-profiles", "/feedback"]);

    expect(await screen.findByRole("link", { name: "Feedback" })).toBeTruthy();
  });

  it("hides Feedback entirely, not even dimmed, without the Feedback Module", async () => {
    renderSidebar(["/customer-profiles", "/tickets", "/conversations"]);
    await screen.findByRole("link", { name: "Tickets" });

    expect(screen.queryByText("Feedback")).toBeNull();
  });

  it("never shows Email Campaigns, even when a stale Marketing page is permitted", async () => {
    renderSidebar(["/customer-profiles", "/email-campaigns"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    expect(screen.queryByText("Email Campaigns")).toBeNull();
  });
});

describe("the Management label", () => {
  it("shows Commerce Settings under Management when the Staff member may open it", async () => {
    renderSidebar(["/management/commerce-settings"]);

    expect(await screen.findByText("MANAGEMENT")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Commerce Settings" })).toBeTruthy();
  });

  it("hides the label and page from everyone else", async () => {
    renderSidebar(["/orders"]);
    await screen.findByText("Ada Okafor");

    expect(screen.queryByText("MANAGEMENT")).toBeNull();
    expect(screen.queryByRole("link", { name: "Commerce Settings" })).toBeNull();
  });
});
