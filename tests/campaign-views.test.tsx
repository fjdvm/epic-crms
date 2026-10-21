// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnnouncementRow } from "@/features/marketing/announcements";
import { AnnouncementDetail } from "@/features/marketing/announcement-detail";
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

const imageName = (form: FormData) => (form.get("image") as File).name;

function fakeActions(): CampaignFormActions {
  return {
    save: vi.fn(async () => ({ ok: true as const, announcement: { id: "new" } })),
    edit: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    addImage: vi.fn(async (form: FormData) => ({ ok: true as const, url: `https://cdn.test/${imageName(form)}` })),
    send: vi.fn(async () => ({ ok: true as const, state: "sent" as const, subscribers: 412 })),
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

  it("opens every Announcement, a Draft to edit and the rest to read", () => {
    render(<CampaignList announcements={[row({ id: "s", title: "Halaya restock", state: "sent" }), row({ id: "d", title: "Christmas" })]} />);

    expect(screen.getByRole("link", { name: "Christmas" }).getAttribute("href")).toBe("/email-campaigns/d");
    expect(screen.getByRole("link", { name: "Halaya restock" }).getAttribute("href")).toBe("/email-campaigns/s");
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

    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ title: "Halaya", description: "Restocked.", images: [] }));
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

    await waitFor(() => expect(actions.edit).toHaveBeenCalledWith("d1", { title: "New", description: "Words.", images: [] }));
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

describe("images on the campaign form", () => {
  const pick = (files: File[]) =>
    fireEvent.change(screen.getByLabelText("Add images"), { target: { files } });
  const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

  it("adds several images and shows them in the preview", async () => {
    render(<CampaignForm actions={fakeActions()} />);

    pick([png("a.png"), png("b.png")]);

    await waitFor(() => expect(within(screen.getByTestId("inbox-preview")).getAllByRole("img")).toHaveLength(2));
    const srcs = within(screen.getByTestId("inbox-preview")).getAllByRole("img").map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
  });

  it("removes an image from the form and the preview", async () => {
    render(<CampaignForm actions={fakeActions()} />);
    pick([png("a.png"), png("b.png")]);
    await screen.findByRole("button", { name: "Remove image 2" });

    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));

    const srcs = within(screen.getByTestId("inbox-preview")).getAllByRole("img").map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["https://cdn.test/b.png"]);
  });

  it("saves the images with the Draft", async () => {
    const actions = fakeActions();
    render(<CampaignForm actions={actions} />);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Halaya" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Restocked." } });
    pick([png("a.png")]);
    await screen.findByRole("button", { name: "Remove image 1" });

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(actions.save).toHaveBeenCalledWith({ title: "Halaya", description: "Restocked.", images: ["https://cdn.test/a.png"] }),
    );
  });

  it("shows the images a Draft already has", () => {
    render(<CampaignForm draft={{ id: "d1", title: "Old", description: "Words.", images: ["https://cdn.test/kept.jpg"] }} actions={fakeActions()} />);

    expect(screen.getByRole("button", { name: "Remove image 1" })).toBeTruthy();
    expect(within(screen.getByTestId("inbox-preview")).getAllByRole("img").map((i) => i.getAttribute("src"))).toContain(
      "https://cdn.test/kept.jpg",
    );
  });

  it("says why a file is refused and keeps the images already added", async () => {
    const { toast } = await import("sonner");
    const actions = {
      ...fakeActions(),
      addImage: vi.fn(async (form: FormData) =>
        imageName(form) === "menu.pdf"
          ? { ok: false as const, reason: "not-an-image" as const }
          : { ok: true as const, url: `https://cdn.test/${imageName(form)}` },
      ),
    };
    render(<CampaignForm actions={actions} />);

    pick([png("a.png"), new File(["%PDF"], "menu.pdf", { type: "application/pdf" })]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("not an image")));
    expect(screen.getByRole("button", { name: "Remove image 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove image 2" })).toBeNull();
  });

  it("refuses an image over 25 MB before sending it anywhere", async () => {
    const { toast } = await import("sonner");
    const actions = fakeActions();
    render(<CampaignForm actions={actions} />);
    const huge = png("huge.png");
    Object.defineProperty(huge, "size", { value: 25 * 1024 * 1024 + 1 });

    pick([huge]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("over 25 MB")));
    expect(actions.addImage).not.toHaveBeenCalled();
  });

  it("shows no image area in the preview for a text-only Announcement", () => {
    render(<CampaignForm actions={fakeActions()} />);

    expect(within(screen.getByTestId("inbox-preview")).queryAllByRole("img")).toHaveLength(0);
  });
});

describe("sending now from the form", () => {
  function filled(actions: CampaignFormActions, subscribers: number | null, draft?: { id: string; title: string; description: string }) {
    render(<CampaignForm actions={actions} subscribers={subscribers} draft={draft} />);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Halaya" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Restocked." } });
  }

  it("asks first, showing how many Subscribers will receive it, and sends only on confirming", async () => {
    const actions = fakeActions();
    filled(actions, 412);

    fireEvent.click(screen.getByRole("button", { name: "Send now" }));

    expect(await screen.findByText("Send to 412 Subscribers?")).toBeTruthy();
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Send now" }));

    await waitFor(() => expect(actions.send).toHaveBeenCalledWith("new"));
    expect(actions.save).toHaveBeenCalledWith({ title: "Halaya", description: "Restocked.", images: [] });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/email-campaigns"));
  });

  it("sends an existing Draft after saving the changes made to it", async () => {
    const actions = fakeActions();
    filled(actions, 3, { id: "d1", title: "Old", description: "Old." });

    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send now" }));

    await waitFor(() => expect(actions.send).toHaveBeenCalledWith("d1"));
    expect(actions.edit).toHaveBeenCalledWith("d1", { title: "Halaya", description: "Restocked.", images: [] });
  });

  it("blocks sending when there are no Subscribers", async () => {
    const actions = fakeActions();
    filled(actions, 0);

    fireEvent.click(screen.getByRole("button", { name: "Send now" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/no Subscribers/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Send now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    const actions = fakeActions();
    filled(actions, 5);

    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel", hidden: false }));

    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("keeps the work as a Draft and says why when the send is refused", async () => {
    const actions = fakeActions();
    actions.send = vi.fn(async () => ({ ok: false as const, reason: "no-subscribers" as const }));
    filled(actions, 5);

    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send now" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/email-campaigns/new"));
  });
});

describe("an Announcement that is no longer a Draft", () => {
  it("is read-only and shows how many Subscribers a Sent one went to", () => {
    render(<AnnouncementDetail announcement={row({ state: "sent", sentTo: 140, sentAt: new Date("2026-10-05T02:00:00Z") })} />);

    expect(screen.getByTestId("delivery").textContent).toContain("Sent to 140 Subscribers on 5 Oct 2026");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers Retry on a Failed one, after asking, and retries only on confirming", async () => {
    const retry = vi.fn(async () => ({ ok: true as const, state: "sent" as const, subscribers: 3 }));
    render(<AnnouncementDetail announcement={row({ state: "failed", sentTo: 2 })} retry={retry} />);
    expect(screen.getByTestId("delivery").textContent).toContain("2 were emailed");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Retry this send?")).toBeTruthy();
    expect(retry).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(retry).toHaveBeenCalledWith("a1"));
  });
});
