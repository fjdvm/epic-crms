// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CommerceSettingsLoading from "@/app/(app)/management/commerce-settings/loading";

afterEach(cleanup);

describe("the Commerce settings loading state", () => {
  it("shows the skeleton at once, with the title and no tabs", () => {
    render(<CommerceSettingsLoading />);

    expect(screen.getByRole("status", { name: "Loading Commerce settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Commerce settings" })).toBeTruthy();
    expect(screen.queryByText("Payment Management")).toBeNull();
  });
});
