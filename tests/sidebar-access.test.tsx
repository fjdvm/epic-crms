// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";
import { StaffProvider } from "@/components/layout/staff-context";
import { SidebarProvider } from "@/components/ui/sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ada = { name: "Ada Okafor", username: "ada.okafor", email: "ada@brenraphaels.test", role: "Customer Support" };

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

  it("groups Customer Profiles under CUSTOMERS and shows the product tag", async () => {
    renderSidebar(["/customer-profiles"]);

    expect(await screen.findByText("CUSTOMERS")).toBeTruthy();
    expect(screen.getByText("Customer Relationship Mgmt.")).toBeTruthy();
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

  it("puts Tickets and Conversations under their own SERVICE label, after CUSTOMERS", async () => {
    renderSidebar(["/customer-profiles", "/tickets", "/conversations"]);

    const customers = await screen.findByText("CUSTOMERS");
    const service = screen.getByText("SERVICE");

    expect(customers.compareDocumentPosition(service) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Customer Profiles",
      "Tickets",
      "Conversations",
    ]);
  });

  it("shows only the SERVICE label with just the Tickets Module", async () => {
    renderSidebar(["/tickets", "/conversations"]);

    expect(await screen.findByText("SERVICE")).toBeTruthy();
    expect(screen.queryByText("CUSTOMERS")).toBeNull();
  });

  it("lists the rest of the design as dimmed entries that are not links", async () => {
    renderSidebar(["/customer-profiles"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    for (const name of ["Dashboard", "Returns"]) {
      expect(screen.getByText(name).closest("[aria-disabled]")?.getAttribute("aria-disabled")).toBe("true");
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
    for (const label of ["SALES"]) expect(screen.getByText(label)).toBeTruthy();
  });

  it("links Orders, Payments and Fulfilment only for the Modules the Staff member holds", async () => {
    renderSidebar(["/orders", "/fulfilment"]);

    expect((await screen.findByRole("link", { name: "Orders" })).getAttribute("href")).toBe("/orders");
    expect(screen.getByRole("link", { name: "Fulfilment" }).getAttribute("href")).toBe("/fulfilment");
    expect(screen.queryByText("Payments")).toBeNull();
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

  it("links Email Campaigns with the Marketing page permitted", async () => {
    renderSidebar(["/customer-profiles", "/email-campaigns"]);

    expect((await screen.findByRole("link", { name: "Email Campaigns" })).getAttribute("href")).toBe("/email-campaigns");
  });

  it("hides Email Campaigns entirely, not even dimmed, without the Marketing Module", async () => {
    renderSidebar(["/customer-profiles"]);
    await screen.findByRole("link", { name: "Customer Profiles" });

    expect(screen.queryByText("Email Campaigns")).toBeNull();
  });
});
