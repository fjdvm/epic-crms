"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, Search, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { openNewTicket, type OpenTicketOutcome } from "./actions";
import { findCustomerOrders, findCustomers } from "./ticket-choices-client";
import { IMAGE_REFUSALS, MAX_IMAGE_BYTES } from "./attachments";
import type { CustomerChoice, OrderChoice } from "./new-ticket";
import { PRIORITY_LABELS } from "./pill";
import { TICKET_PRIORITIES, type TicketPriority } from "./tickets";

const REASONS: Record<Exclude<OpenTicketOutcome, { ok: true }>["reason"], string> = {
  "empty-subject": "Give the Ticket a subject.",
  "invalid-priority": "Choose a Priority.",
  "empty-message": "Write a description or attach an image, so the Customer has something to read.",
  "unknown-customer": "Choose a Customer from the search results.",
  "order-not-theirs": "That Order does not belong to this Customer.",
  ...IMAGE_REFUSALS,
  "storage-unavailable": "CREOMS could not store that image. Try again in a moment.",
  unavailable: "CREOMS could not open that Ticket. Try again in a moment.",
};

export interface NewTicketActions {
  findCustomers: (term: string, signal?: AbortSignal) => Promise<CustomerChoice[]>;
  findCustomerOrders: (customerId: string, signal?: AbortSignal) => Promise<OrderChoice[]>;
  openNewTicket: (form: FormData) => Promise<OpenTicketOutcome>;
}

const REAL_ACTIONS: NewTicketActions = { findCustomers, findCustomerOrders, openNewTicket };

const CACHE_TTL = 30_000;
type ChoiceCache<T> = Map<string, { at: number; value: T[] }>;
function cached<T>(cache: ChoiceCache<T>, key: string): T[] | undefined {
  const entry = cache.get(key);
  return entry && Date.now() - entry.at < CACHE_TTL ? entry.value : undefined;
}
function remember<T>(cache: ChoiceCache<T>, key: string, value: T[]) {
  if (cache.size >= 40) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
}

const CONTROL =
  "w-full rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-sm leading-[normal] text-[#18181b] placeholder:text-[#a1a1aa] focus-visible:border-[#5b2a86] focus-visible:outline-none";
const LABEL = "flex gap-[3px] text-[13px] font-medium leading-[normal] text-[#27272a]";

const orderDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Manila" });

const orderLabel = (o: OrderChoice) =>
  `#${o.id} · ${o.status.charAt(0).toUpperCase()}${o.status.slice(1)} ${orderDate.format(new Date(o.createdAt))}`;

export function NewTicketDialog({ actions = REAL_ACTIONS }: { actions?: NewTicketActions }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ids = useId();

  const [subject, setSubject] = useState("");
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<CustomerChoice[]>([]);
  const [customer, setCustomer] = useState<CustomerChoice | null>(null);
  const [orders, setOrders] = useState<OrderChoice[]>([]);
  const [orderId, setOrderId] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const customerCache = useRef<ChoiceCache<CustomerChoice>>(new Map());
  const orderCache = useRef<ChoiceCache<OrderChoice>>(new Map());

  const reset = () => {
    setSubject("");
    setTerm("");
    setFound([]);
    setCustomer(null);
    setOrders([]);
    setOrderId("");
    setPriority("normal");
    setDescription("");
    setImage(null);
  };

  // Lookups use independent GET requests, so an obsolete search cannot queue ahead of saving.
  useEffect(() => {
    const key = term.trim().toLowerCase();
    if (!open || customer || !key || cached(customerCache.current, key)) return;
    const controller = new AbortController();
    void actions.findCustomers(term.trim(), controller.signal).then((results) => {
      if (controller.signal.aborted) return;
      remember(customerCache.current, key, results);
      setFound(results);
    }).catch(() => {
      if (!controller.signal.aborted) toast.error("Customers could not be searched. Try again.");
    });
    return () => controller.abort();
  }, [open, term, customer, actions]);

  useEffect(() => {
    if (!open || !customer || cached(orderCache.current, customer.id)) return;
    const controller = new AbortController();
    void actions.findCustomerOrders(customer.id, controller.signal).then((results) => {
      if (controller.signal.aborted) return;
      remember(orderCache.current, customer.id, results);
      setOrders(results);
    }).catch(() => {
      if (!controller.signal.aborted) toast.error("Orders could not be read. Choose the Customer again to retry.");
    });
    return () => controller.abort();
  }, [open, customer, actions]);

  const choose = (picked: CustomerChoice) => {
    setCustomer(picked);
    setTerm(picked.name);
    setFound([]);
    setOrderId("");
    setOrders(cached(orderCache.current, picked.id) ?? []);
  };

  const clearCustomer = (text: string) => {
    setCustomer(null);
    setOrders([]);
    setOrderId("");
    setTerm(text);
    setFound(cached(customerCache.current, text.trim().toLowerCase()) ?? []);
  };

  const pickImage = (file: File | undefined) => {
    if (!file) return;

    // Said here as well as on the server, so a big file never travels just to be refused.
    if (!/^image\/(jpeg|png)$/.test(file.type)) toast.error(IMAGE_REFUSALS["invalid-image-type"]);
    else if (file.size === 0) toast.error(IMAGE_REFUSALS["empty-image"]);
    else if (file.size > MAX_IMAGE_BYTES) toast.error(IMAGE_REFUSALS["image-too-large"]);
    else setImage(file);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current || pending) return;

    if (!subject.trim()) return void toast.error(REASONS["empty-subject"]);
    if (!customer) return void toast.error(REASONS["unknown-customer"]);

    const form = new FormData();
    form.set("subject", subject);
    form.set("customerId", customer.id);
    form.set("orderId", orderId);
    form.set("priority", priority);
    form.set("description", description);
    if (image) form.set("image", image);

    sending.current = true;
    startTransition(async () => {
      try {
        const result = await actions.openNewTicket(form);

        if (!result.ok) return void toast.error(REASONS[result.reason]);

        if (result.emailed === null) toast.success(`TKT-${result.id} opened.`);
        else if (result.emailed) toast.success(`TKT-${result.id} opened and ${customer.name} emailed.`);
        else toast.warning(`TKT-${result.id} opened, but ${customer.name} could not be emailed.`);
        setOpen(false);
        reset();
        router.push(`/tickets/${result.id}`);
      } catch {
        toast.error(REASONS.unavailable);
      } finally {
        sending.current = false;
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!sending.current) setOpen(next); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white"
        >
          New ticket
        </button>
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay className="bg-[#120d1a]/45" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-[99999] flex max-h-[90vh] w-[calc(100vw-32px)] max-w-[600px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_48px_rgba(0,0,0,0.2)] focus:outline-none"
        >
          <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
            <div className="flex items-start gap-3 border-b border-[#f0f0f2] pt-5 pr-[18px] pb-4 pl-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <DialogPrimitive.Title className="text-lg leading-[normal] font-semibold text-[#18181b]">
                  New ticket
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-[13px] leading-[normal] text-[#71717a]">
                  For problems that need follow-up. Link the order so everyone sees the full story.
                </DialogPrimitive.Description>
              </div>
              <DialogClose type="button" aria-label="Close" className="rounded-md p-1 text-[#71717a]">
                <X className="size-[18px]" />
              </DialogClose>
            </div>

            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-subject`} className={LABEL}>
                  Subject <span className="text-[#dc2626]">*</span>
                </label>
                <input
                  id={`${ids}-subject`}
                  className={CONTROL}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Halaya tub lid cracked on arrival"
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor={`${ids}-customer`} className={LABEL}>
                    Customer <span className="text-[#dc2626]">*</span>
                  </label>
                  <div className={cn(CONTROL, "flex items-center gap-2 focus-within:border-[#5b2a86]")}>
                    <Search className="size-4 shrink-0 text-[#71717a]" aria-hidden />
                    <input
                      id={`${ids}-customer`}
                      role="combobox"
                      aria-expanded={found.length > 0}
                      aria-controls={`${ids}-results`}
                      autoComplete="off"
                      className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#a1a1aa]"
                      placeholder="Search by name or email"
                      value={term}
                      onChange={(e) => clearCustomer(e.target.value)}
                    />
                  </div>
                  {found.length > 0 && (
                    <ul
                      id={`${ids}-results`}
                      role="listbox"
                      className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-lg border border-[#e4e4e7] bg-white py-1 shadow-md"
                    >
                      {found.map((c) => (
                        <li key={c.id} role="option" aria-selected={false}>
                          <button
                            type="button"
                            onClick={() => choose(c)}
                            className="flex w-full flex-col px-3 py-2 text-left text-sm leading-[normal] hover:bg-[#f4f4f5]"
                          >
                            <span className="text-[#18181b]">{c.name}</span>
                            <span className="text-xs text-[#71717a]">{c.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor={`${ids}-order`} className={LABEL}>
                    Linked order
                  </label>
                  <div className={cn(CONTROL, "relative flex items-center gap-2 p-0 focus-within:border-[#5b2a86]")}>
                    <select
                      id={`${ids}-order`}
                      disabled={!customer}
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      className="w-full appearance-none rounded-lg bg-transparent px-3 py-2.5 pr-9 outline-none disabled:text-[#a1a1aa]"
                    >
                      <option value="">{customer && orders.length === 0 ? "None yet" : "No linked order"}</option>
                      {orders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {orderLabel(o)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 size-4 text-[#71717a]" aria-hidden />
                  </div>
                  <p className="text-xs leading-[normal] text-[#71717a]">Only this customer&apos;s orders are listed.</p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span id={`${ids}-priority`} className={LABEL}>
                  Priority
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby={`${ids}-priority`}
                  className="flex gap-0.5 rounded-lg bg-[#f4f4f5] p-[3px]"
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={priority === p}
                      onClick={() => setPriority(p)}
                      className={cn(
                        "flex-1 rounded-md py-[7px] text-[13px] leading-[normal]",
                        priority === p
                          ? "bg-white font-semibold text-[#18181b] shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                          : "font-medium text-[#71717a]",
                      )}
                    >
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-description`} className={LABEL}>
                  Description
                </label>
                <textarea
                  id={`${ids}-description`}
                  className={cn(CONTROL, "h-16 resize-none")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>
                  Attachments <span className="font-normal text-[#a1a1aa]">(optional)</span>
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  aria-label="Attach an image"
                  onChange={(e) => {
                    pickImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInput.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    pickImage(e.dataTransfer.files[0]);
                  }}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-[#d4d4d8] bg-[#fafafa] py-[14px]"
                >
                  <Upload className="size-[18px] text-[#71717a]" aria-hidden />
                  <p className="text-[13px] leading-[normal] font-medium text-[#3f3f46]">
                    {image ? image.name : "Drag files here or click to upload"}
                  </p>
                  <p className="text-xs leading-[normal] text-[#a1a1aa]">JPG or PNG, up to 5 MB each</p>
                </div>
                {image && (
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    className="self-start text-xs text-[#5b2a86]"
                  >
                    Remove {image.name}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#f0f0f2] bg-[#fafafa] px-6 py-[14px]">
              <DialogClose
                type="button"
                className="rounded-lg border border-[#e4e4e7] bg-white px-4 py-[9px] text-sm leading-[normal] font-medium text-[#18181b]"
              >
                Cancel
              </DialogClose>
              <button
                type="submit"
                disabled={pending}
                aria-busy={pending}
                className="rounded-lg bg-[#5b2a86] px-4 py-[9px] text-sm leading-[normal] font-medium text-white disabled:opacity-50"
              >
                {pending ? "Creating ticket…" : "Create ticket"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
