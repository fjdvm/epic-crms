// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CommerceSettingsLoading from "@/app/(app)/management/commerce-settings/loading";

afterEach(cleanup);

describe("the Commerce Settings loading state", () => {
  it("shows the skeleton at once, with the title and no tabs", () => {
    render(<CommerceSettingsLoading />);

    expect(screen.getByRole("status", { name: "Loading Commerce Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Commerce Settings" })).toBeTruthy();
    expect(screen.queryByText("Payment Management")).toBeNull();
  });
});
