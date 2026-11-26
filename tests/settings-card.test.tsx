// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsCard, SettingsGroup } from "@/features/management/settings-card";

afterEach(cleanup);

describe("a Commerce setting card", () => {
  it("shows the title, description, action, fields and footer in one labelled region", () => {
    render(
      <SettingsGroup title="Orders and tickets">
        <SettingsCard title="Payment window" description="How long a Customer has to pay." action={<button>Add</button>} footer={<button>Save payment window</button>}>
          <input aria-label="Window (hours)" />
        </SettingsCard>
      </SettingsGroup>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Orders and tickets" })).toBeTruthy();
    const card = screen.getByRole("region", { name: "Payment window" });
    expect(within(card).getByRole("heading", { level: 3, name: "Payment window" })).toBeTruthy();
    expect(within(card).getByText("How long a Customer has to pay.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Add" })).toBeTruthy();
    expect(within(card).getByRole("textbox", { name: "Window (hours)" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Save payment window" })).toBeTruthy();
  });

  it("leaves out the footer bar when there is nothing to save", () => {
    const { container } = render(<SettingsCard title="Automatic checks"><p>Could not load.</p></SettingsCard>);

    expect(container.querySelector(".border-t")).toBeNull();
  });
});
