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
});
