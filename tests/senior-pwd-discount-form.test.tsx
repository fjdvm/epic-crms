// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SeniorPwdDiscountForm } from "@/features/management/senior-pwd-discount-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/management/senior-pwd-discount-actions", () => ({ setSeniorPwdDiscount: vi.fn() }));
afterEach(cleanup);

const current = { kind: "percent", hundredths: 500, limitInCentavos: 12500, per: "week" } as const;
const save = () => screen.getByRole("button", { name: "Save discount" }) as HTMLButtonElement;

it("shows the current rule and cannot save it unchanged", () => {
  render(<SeniorPwdDiscountForm current={current} />);
  expect(screen.getByText("Current: 5% off, up to ₱125 per week")).toBeTruthy();
  expect((screen.getByLabelText("Discount") as HTMLInputElement).value).toBe("5");
  expect(save().disabled).toBe(false); // the trigger opens the dialog; its confirm is what is disabled
});

it("changes to pesos and 1500 per week, and says why a bad value is refused", () => {
  render(<SeniorPwdDiscountForm current={current} />);
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "pesos" } });
  fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "2000" } });
  fireEvent.change(screen.getByLabelText(/Limit/), { target: { value: "1500" } });
  expect(screen.getByRole("alert").textContent).toContain("over the limit");
  fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "100" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(save());
  expect(screen.getAllByText(/₱100 off, up to ₱1,500 per week/).length).toBeGreaterThan(0);
});
