// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzeButton, failureWarning } from "@/features/feedback/analyze-button";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const analyze = vi.fn();
const generate = vi.fn();
const load = vi.fn();
vi.mock("@/features/feedback/actions", () => ({ analyze: () => analyze(), generateProductAdvice: () => generate(), loadProductAdvice: () => load() }));

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  generate.mockResolvedValue({ result: null, unavailable: false });
});

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

  const ADVICE = { result: { adviceUnavailable: false, model: "m", createdAt: "2026-11-20T03:00:00.000Z", products: [
    { rank: 1, product: "Halaya 500 g", feedbackCount: 6, averageRating: 1.5, negativeShare: 0.8, trend: "down", advice: { action: "check-batch", label: "Check the batch or packaging", why: "Leaking pouches repeat." } },
    { rank: 2, product: "Ube jam", feedbackCount: 5, averageRating: 4.8, negativeShare: 0, trend: null, advice: null },
  ] }, unavailable: false };

  it("slides in the drawer with a skeleton, then the ranked products and suggestions, once the run is done", async () => {
    analyze.mockResolvedValue({ status: "done", analyzed: 4, failed: 0, model: "groq-4" });
    let finish!: (value: unknown) => void;
    generate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AnalyzeButton {...READY} />);

    fireEvent.click(button());
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Analyze" }).at(-1)!); });

    expect(screen.getByRole("status", { name: "Loading suggestions" })).toBeTruthy();
    await act(async () => finish(ADVICE));

    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["Halaya 500 g", "Ube jam"]);
    expect(screen.getByText("Check the batch or packaging")).toBeTruthy();
    expect(screen.getByText(/AI-written/)).toBeTruthy();
  });

  it("opens no drawer when the run is refused", async () => {
    analyze.mockResolvedValue({ status: "cooling-down", until: new Date() });
    render(<AnalyzeButton {...READY} />);

    fireEvent.click(button());
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Analyze" }).at(-1)!); });

    expect(generate).not.toHaveBeenCalled();
    expect(screen.queryByText("Product suggestions")).toBeNull();
  });

  it("reopens the saved suggestions from the Suggestions button without running anything", async () => {
    load.mockResolvedValue(ADVICE);
    render(<AnalyzeButton {...READY} />);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Suggestions" })); });

    expect(screen.getByText("Halaya 500 g")).toBeTruthy();
    expect(analyze).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("says so when the suggestions are unavailable", async () => {
    load.mockResolvedValue({ result: null, unavailable: true });
    render(<AnalyzeButton {...READY} />);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Suggestions" })); });

    expect(screen.getByRole("alert").textContent).toMatch(/unavailable/);
  });
});
