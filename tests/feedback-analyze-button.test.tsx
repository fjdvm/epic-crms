// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzeButton, failureWarning } from "@/features/feedback/analyze-button";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const analyze = vi.fn();
vi.mock("@/features/feedback/actions", () => ({ analyze: () => analyze() }));

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const READY = { keysSet: true, running: false, availableAt: null, lastFailed: 0 };

const button = () => screen.getByRole("button", { name: /Analyz/ }) as HTMLButtonElement;

describe("AnalyzeButton", () => {
  it("asks for confirmation, and cancelling runs nothing", () => {
    render(<AnalyzeButton {...READY} />);

    fireEvent.click(button());
    expect(screen.getByText("Analyze Feedback?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(analyze).not.toHaveBeenCalled();
    expect(screen.queryByText("Analyze Feedback?")).toBeNull();
  });

  it("runs the analysis on confirm and refreshes the page", async () => {
    analyze.mockResolvedValue({ status: "done", analyzed: 4, failed: 0, model: "groq-4" });
    render(<AnalyzeButton {...READY} />);

    fireEvent.click(button());
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Analyze" }).at(-1)!);
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Analyzed 4 Feedbacks.");
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText("Analyze Feedback?")).toBeNull();
  });

  it("warns when the run it started had failures", async () => {
    analyze.mockResolvedValue({ status: "done", analyzed: 1, failed: 2, model: "groq-4" });
    render(<AnalyzeButton {...READY} />);

    fireEvent.click(button());
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Analyze" }).at(-1)!);
    });

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("2 Feedbacks couldn't be analyzed"));
  });

  it("is disabled with \"AI keys not set\" when the keys are missing", () => {
    render(<AnalyzeButton {...READY} keysSet={false} />);

    expect(button().disabled).toBe(true);
    expect(screen.getByText("AI keys not set")).toBeTruthy();
  });

  it("is disabled while a run is in progress", () => {
    render(<AnalyzeButton {...READY} running />);

    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain("Analyzing…");
  });

  it("is disabled for 5 minutes after a run ends, then enabled again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T06:00:00Z"));
    render(<AnalyzeButton {...READY} availableAt="2026-10-21T06:03:00.000Z" />);

    expect(button().disabled).toBe(true);
    expect(screen.getByText("Available again at 2:03 pm")).toBeTruthy();

    act(() => vi.advanceTimersByTime(3 * 60_000));

    expect(button().disabled).toBe(false);
    expect(screen.queryByTestId("analyze-note")).toBeNull();
  });

  it("shows the failure warning when the last run had failures", () => {
    render(<AnalyzeButton {...READY} lastFailed={3} />);

    expect(screen.getByText("3 Feedbacks couldn't be analyzed")).toBeTruthy();
  });

  it("shows no warning when the last run had none", () => {
    render(<AnalyzeButton {...READY} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(failureWarning(1)).toBe("1 Feedback couldn't be analyzed");
  });
});
