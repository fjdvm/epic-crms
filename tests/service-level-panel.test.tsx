// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TARGETS, serviceLevel } from "@/features/tickets/service-level";
import { ServiceLevelPanel } from "@/features/tickets/service-level-panel";

afterEach(cleanup);
const NOW = new Date("2026-10-20T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe("the Service level panel", () => {
  it("shows both targets and the time left", () => {
    const level = serviceLevel({ status: "open", createdAt: hours(10), resolvedAt: null, heldSeconds: 0, holdStartedAt: null, messages: [] }, DEFAULT_TARGETS, NOW);
    render(<ServiceLevelPanel level={level} />);
    expect(screen.getByText("14h 0m left")).toBeTruthy();
    expect(screen.getByText("Target 24 hours")).toBeTruthy();
    expect(screen.getByText("Target 3 days")).toBeTruthy();
    expect(screen.queryByText("Clock paused")).toBeNull();
  });

  it("says Clock paused while On hold and Missed once late", () => {
    const held = serviceLevel({ status: "on_hold", createdAt: hours(10), resolvedAt: null, heldSeconds: 0, holdStartedAt: hours(2), messages: [] }, DEFAULT_TARGETS, NOW);
    render(<ServiceLevelPanel level={held} />);
    expect(screen.getByText("Clock paused")).toBeTruthy();
    cleanup();
    const late = serviceLevel({ status: "open", createdAt: hours(30), resolvedAt: null, heldSeconds: 0, holdStartedAt: null, messages: [] }, DEFAULT_TARGETS, NOW);
    render(<ServiceLevelPanel level={late} />);
    expect(screen.getAllByText("Missed").length).toBe(1);
  });
});
