// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { NumericInput } from "@/components/ui/numeric-input";
import { maskNumeric } from "@/lib/numeric-mask";

afterEach(cleanup);

describe("maskNumeric", () => {
  it.each([
    ["peso", "₱1,250.505abc", "1,250.50"],
    ["peso", "12.3.4", "12.34"],
    ["peso", "abc", ""],
    ["peso", "500", "500"],
    ["whole", "09-17 123 4567x", "09171234567"],
    ["whole", "12.5", "125"],
    ["whole", "eight", ""],
  ] as const)("%s %j becomes %j", (kind, raw, expected) => expect(maskNumeric(kind, raw)).toBe(expected));
});

function Field({ kind }: { kind: "peso" | "whole" }) {
  const [value, setValue] = useState("");

  return <NumericInput aria-label="Amount" kind={kind} value={value} onChange={(e) => setValue(e.target.value)} />;
}

describe("NumericInput", () => {
  it("drops letters whether typed or pasted", () => {
    render(<Field kind="whole" />);
    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12ab" } });
    expect(input.value).toBe("12");
    fireEvent.change(input, { target: { value: "12abc 345" } });
    expect(input.value).toBe("12345");
  });

  it("keeps a peso amount to two decimals and asks phones for the number keypad", () => {
    render(<Field kind="peso" />);
    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1,000.999" } });
    expect(input.value).toBe("1,000.99");
    expect(input.getAttribute("inputmode")).toBe("decimal");
  });
});

import { vi } from "vitest";
import { ApprovalLimitForm } from "@/features/management/approval-limit-form";
import { ServiceLevelsForm } from "@/features/management/service-levels-form";

vi.mock("@/features/management/settings-actions", () => ({ changeApprovalLimit: vi.fn(), changeServiceLevels: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("Commerce Settings number fields", () => {
  it("do not let letters into the Approval limit", () => {
    render(<ApprovalLimitForm currentInCentavos={500_000} />);
    const input = screen.getByLabelText("Limit (₱)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5,000abc" } });
    expect(input.value).toBe("5,000");
  });

  it("do not let letters or decimals into the Service level hours", () => {
    render(<ServiceLevelsForm current={{ firstReplyHours: 4, resolveHours: 24 }} />);
    const input = screen.getByLabelText("First reply (hours)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "8h.5" } });
    expect(input.value).toBe("85");
  });
});
