// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PaymentLoading from "@/app/(app)/management/payment-management/loading";
import DeliveryLoading from "@/app/(app)/management/delivery-management/loading";

afterEach(cleanup);

describe("the Management pages' loading state", () => {
  it.each([
    ["Payment Management", PaymentLoading],
    ["Delivery Management", DeliveryLoading],
  ])("shows the %s skeleton at once, with both tabs", (label, Loading) => {
    render(<Loading />);

    expect(screen.getByRole("status", { name: `Loading ${label}` })).toBeTruthy();
    expect(screen.getByText("Payment Management")).toBeTruthy();
    expect(screen.getByText("Delivery Management")).toBeTruthy();
  });
});
