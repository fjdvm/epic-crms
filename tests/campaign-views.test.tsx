// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnnouncementRow } from "@/features/marketing/announcements";
import { CampaignForm, type CampaignFormActions } from "@/features/marketing/campaign-form";
import { CampaignList, SubscribersCard } from "@/features/marketing/campaign-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (overrides: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: "a1",
  title: "Undas ube treats",
  description: "Back for Undas.",
  images: [],
  state: "draft",
  scheduledFor: null,
  sentAt: null,
  sentTo: null,
  createdByName: "Ada",
  updatedByName: "Ada",
  updatedAt: new Date("2026-10-20T00:00:00Z"),
  ...overrides,
});

function fakeActions(): CampaignFormActions {
  return {
    save: vi.fn(async () => ({ ok: true as const, announcement: { id: "new" } })),
    edit: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("the Announcements list", () => {
  it("shows Announcement, Sent to, Sent date and Status", () => {
    render(
      <CampaignList
        announcements={[
          row({ id: "s", title: "Halaya restock", state: "sent", sentTo: 140, sentAt: new Date("2026-10-05T02:00:00Z") }),
          row({ id: "d", title: "Christmas pre-orders" }),
        ]}
      />,
    );

    for (const heading of ["Announcement", "Sent to", "Sent date", "Status"]) expect(screen.getByText(heading)).toBeTruthy();
    expect(screen.getByText("140")).toBeTruthy();
    expect(screen.getByText("5 Oct 2026")).toBeTruthy();
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("opens a Draft to edit it but not an Announcement already Sent", () => {
    render(<CampaignList announcements={[row({ id: "s", title: "Halaya restock", state: "sent" }), row({ id: "d", title: "Christmas" })]} />);

    expect(screen.getByRole("link", { name: "Christmas" }).getAttribute("href")).toBe("/email-campaigns/d");
    expect(screen.queryByRole("link", { name: "Halaya restock" })).toBeNull();
  });

  it("says when there are none", () => {
    render(<CampaignList announcements={[]} />);

    expect(screen.getByText(/No Announcements yet/)).toBeTruthy();
  });

  it("shows the Subscriber count, or a dash when it could not be counted", () => {
    const { unmount } = render(<SubscribersCard counts={{ subscribers: 412, customers: 518 }} />);
    expect(screen.getByTestId("subscribers").textContent).toContain("412");
    expect(screen.getByTestId("subscribers").textContent).toContain("Of 518 customers");
    unmount();

    render(<SubscribersCard counts={null} />);
    expect(screen.getByTestId("subscribers").textContent).toContain("–");
  });
});

describe("the campaign form", () => {
  it("counts the title against the limit", () => {
    render(<CampaignForm actions={fakeActions()} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Halaya" } });

    expect(screen.getByTestId("title-counter").textContent).toBe("6 / 60");
  });

  it("previews the title and description live", () => {
    render(<CampaignForm actions={fakeActions()} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Pre-order halaya" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Reserve by 15 December." } });

    const preview = screen.getByTestId("inbox-preview");
    expect(preview.textContent).toContain("Pre-order halaya");
    expect(preview.textContent).toContain("Reserve by 15 December.");
    expect(preview.textContent).toContain("Unsubscribe");
  });

  it("asks before saving, and saves only on confirming", async () => {
    const actions = fakeActions();
    render(<CampaignForm actions={actions} />);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Halaya" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Restocked." } });

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("Save this Draft?")).toBeTruthy();
    expect(actions.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ title: "Halaya", description: "Restocked." }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/email-campaigns"));
  });

  it("saves nothing when the confirmation is cancelled", async () => {
    const actions = fakeActions();
    render(<CampaignForm actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel", hidden: false }));

    expect(actions.save).not.toHaveBeenCalled();
  });

  it("edits an existing Draft instead of creating one", async () => {
    const actions = fakeActions();
    render(<CampaignForm draft={{ id: "d1", title: "Old", description: "Words." }} actions={actions} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.edit).toHaveBeenCalledWith("d1", { title: "New", description: "Words." }));
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("asks before deleting a Draft, and deletes on confirming", async () => {
    const actions = fakeActions();
    render(<CampaignForm draft={{ id: "d1", title: "Old", description: "Words." }} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(await screen.findByText("Delete this Draft?")).toBeTruthy();
    expect(actions.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("d1"));
  });

  it("offers no delete for a Draft that is not saved yet", () => {
    render(<CampaignForm actions={fakeActions()} />);

    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
  });

  it("stays on the form and says why when the save is refused", async () => {
    const { toast } = await import("sonner");
    const actions = { ...fakeActions(), save: vi.fn(async () => ({ ok: false as const, reason: "empty-title" as const })) };
    render(<CampaignForm actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Give the Announcement a title."));
    expect(push).not.toHaveBeenCalled();
  });
});
