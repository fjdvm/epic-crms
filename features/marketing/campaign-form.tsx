"use client";

import { ChevronLeft, ImagePlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { addImageAction, deleteDraftAction, editDraftAction, saveDraftAction } from "./actions";
import { INPUT_REFUSALS, TITLE_LIMIT, type AnnouncementInput } from "./announcements";
import { IMAGE_REFUSALS, MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "./image-limits";
import { prepareImage } from "./prepare-image";
import { InboxPreview } from "./inbox-preview";

const MESSAGES: Record<string, string> = {
  ...INPUT_REFUSALS,
  ...IMAGE_REFUSALS,
  "not-found": "That Announcement no longer exists.",
  "not-a-draft": "That Announcement is no longer a Draft, so it cannot be changed.",
  unavailable: "CREOMS could not reach its database. Try again in a moment.",
};

const CONTROL =
  "w-full rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-sm leading-[normal] text-[#18181b] placeholder:text-[#a1a1aa] focus-visible:border-[#5b2a86] focus-visible:outline-none";
const LABEL = "flex gap-[3px] text-[13px] font-medium leading-[normal] text-[#27272a]";
const OUTLINE = "rounded-lg border border-[#e4e4e7] bg-white px-4 py-[9px] text-sm font-medium leading-[normal] text-[#18181b]";

export interface CampaignFormActions {
  save: typeof saveDraftAction;
  edit: typeof editDraftAction;
  remove: typeof deleteDraftAction;
  addImage: typeof addImageAction;
}

const REAL_ACTIONS: CampaignFormActions = { save: saveDraftAction, edit: editDraftAction, remove: deleteDraftAction, addImage: addImageAction };

/** The compose form and its live inbox preview. With `draft`, it edits that Draft instead of starting a new one. */
export function CampaignForm({
  draft,
  actions = REAL_ACTIONS,
}: {
  draft?: { id: string; title: string; description: string; images?: string[] };
  actions?: CampaignFormActions;
}) {
  const router = useRouter();
  const ids = useId();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [images, setImages] = useState<string[]>(draft?.images ?? []);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<"save" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  const input: AnnouncementInput = { title, description, images };

  /** Each file is shrunk and stored on its own, so one refusal does not lose the others. */
  const addImages = async (files: File[]) => {
    setAdding(true);
    try {
      for (const file of files) {
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`${file.name}: ${IMAGE_REFUSALS["image-too-large"]}`);
          continue;
        }

        const result = await actions.addImage(await toFormData(file));
        if (result.ok) setImages((current) => [...current, result.url]);
        else toast.error(`${file.name}: ${MESSAGES[result.reason]}`);
      }
    } finally {
      setAdding(false);
    }
  };

  /** Each submit asks first; the dialog's confirm button is what actually sends it. */
  const ask = (kind: "save" | "delete") => (event?: React.FormEvent) => {
    event?.preventDefault();
    setConfirming(kind);
  };

  const confirm = () => {
    if (busy.current || !confirming) return;

    const kind = confirming;
    busy.current = true;
    startTransition(async () => {
      try {
        const result =
          kind === "delete"
            ? await actions.remove(draft!.id)
            : draft
              ? await actions.edit(draft.id, input)
              : await actions.save(input);

        setConfirming(null);
        if (!result.ok) return void toast.error(MESSAGES[result.reason]);

        toast.success(kind === "delete" ? "Draft deleted." : "Draft saved.");
        router.push("/email-campaigns");
      } finally {
        busy.current = false;
      }
    });
  };

  return (
    <form onSubmit={ask("save")} noValidate className="flex h-[calc(100vh-4rem)] flex-col bg-[#fafafa]">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-8 pt-5 pb-4">
        <div className="flex shrink-0 flex-col gap-1">
          <Link href="/email-campaigns" className="inline-flex items-center gap-1 text-[13px] font-medium leading-[normal] text-[#71717a]">
            <ChevronLeft className="size-4" aria-hidden /> Email campaigns
          </Link>
          <h1 className="text-2xl font-semibold leading-[normal] text-[#18181b]">{draft ? "Edit draft" : "New campaign"}</h1>
          <p className="text-sm leading-[normal] text-[#71717a]">
            Write it once and it goes to every Subscriber. Save it as a Draft to come back to it.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <section className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto rounded-xl border border-[#e6e1ee] bg-white px-5 py-[18px]">
            <h2 className="text-[15px] font-semibold leading-[normal] text-[#18181b]">Content</h2>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-[3px]">
                <label htmlFor={`${ids}-title`} className={LABEL}>
                  Title <span className="text-[#dc2626]">*</span>
                </label>
                <span className="flex-1" />
                <span
                  data-testid="title-counter"
                  className={cn("text-xs leading-[normal]", title.length > TITLE_LIMIT ? "text-[#dc2626]" : "text-[#a1a1aa]")}
                >
                  {title.length} / {TITLE_LIMIT}
                </span>
              </div>
              <input
                id={`${ids}-title`}
                className={CONTROL}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Pre-order your Noche Buena halaya now"
              />
              <p className="text-xs leading-[normal] text-[#71717a]">Also the subject line of the email.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-description`} className={LABEL}>
                Description <span className="text-[#dc2626]">*</span>
              </label>
              <textarea
                id={`${ids}-description`}
                className={cn(CONTROL, "min-h-32 resize-y")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Our Noche Buena batch is now open for pre-orders."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>
                Images <span className="font-normal text-[#a1a1aa]">(optional)</span>
              </span>
              {images.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {images.map((src, index) => (
                    <li key={`${src}-${index}`} className="relative size-24 shrink-0 overflow-hidden rounded-lg border border-[#e4e4e7] bg-[#efe6f8]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="size-full object-cover" />
                      <button
                        type="button"
                        aria-label={`Remove image ${index + 1}`}
                        onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-[#18181b]/80 text-white"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label
                htmlFor={`${ids}-images`}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#8b5cf6] bg-[#f5f0ff] px-3 py-4 text-sm font-medium leading-[normal] text-[#6d28d9]",
                  adding && "pointer-events-none opacity-60",
                )}
              >
                <ImagePlus className="size-4" aria-hidden />
                {adding ? "Adding…" : "Add images"}
              </label>
              <input
                id={`${ids}-images`}
                aria-label="Add images"
                type="file"
                accept="image/*"
                multiple
                disabled={adding}
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) void addImages(files);
                }}
              />
              <p className="text-xs leading-[normal] text-[#71717a]">
                Up to {MAX_IMAGE_MB} MB each. They are shrunk for email, and stay available to Subscribers permanently.
              </p>
            </div>
          </section>

          <aside className="flex min-h-0 w-full shrink-0 flex-col gap-4 overflow-y-auto lg:w-[420px]">
            <section className="flex flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white px-5 py-[18px]">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[15px] font-semibold leading-[normal] text-[#18181b]">Preview</h2>
                <p className="text-xs leading-[normal] text-[#71717a]">How it looks in the inbox.</p>
              </div>
              <InboxPreview title={title} description={description} images={images} />
            </section>
          </aside>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[#ebebeb] bg-white px-8 py-[14px]">
        <p className="min-w-0 flex-1 text-[13px] leading-[normal] text-[#71717a]">
          {draft ? "Anyone with the Marketing Module can edit or delete this Draft." : "Not saved yet."}
        </p>
        {draft && (
          <button type="button" onClick={ask("delete")} className={cn(OUTLINE, "text-[#dc2626]")}>
            Delete draft
          </button>
        )}
        <Link href="/email-campaigns" className={OUTLINE}>
          Cancel
        </Link>
        <button type="submit" className="rounded-lg bg-[#5b2a86] px-4 py-[9px] text-sm font-medium leading-[normal] text-white">
          Save draft
        </button>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && !pending && setConfirming(null)}>
        <AlertDialogContent
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          className="w-[calc(100%-2rem)] max-w-[24rem] sm:max-w-[24rem] md:max-w-[24rem] lg:max-w-[24rem] gap-4 p-6 sm:p-6 rounded-xl"
        >
          <AlertDialogHeader className="gap-2 text-left">
            <AlertDialogTitle className="text-lg font-semibold">
              {confirming === "delete" ? "Delete this Draft?" : draft ? "Save your changes?" : "Save this Draft?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "delete"
                ? "It is removed for everyone with the Marketing Module and cannot be brought back."
                : "It is saved as a Draft. Nothing is sent to Subscribers."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
            <AlertDialogCancel disabled={pending} className="mt-0 sm:mt-0">
              Cancel
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: that would close the dialog and hide the loading state. */}
            <Button
              type="button"
              onClick={confirm}
              disabled={pending}
              className={cn("text-white", confirming === "delete" ? "bg-[#dc2626] hover:bg-[#dc2626]/90" : "bg-[#5b2a86] hover:bg-[#5b2a86]/90")}
            >
              {pending ? "Working…" : confirming === "delete" ? "Delete" : "Save"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

async function toFormData(file: File): Promise<FormData> {
  const form = new FormData();
  form.set("image", await prepareImage(file));

  return form;
}
