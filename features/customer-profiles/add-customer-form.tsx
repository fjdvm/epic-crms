"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Info, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { addWalkInCustomer, type AddWalkInActionResult } from "./actions";
import { PREFERRED_CONTACTS, SOURCES, validateWalkIn, type WalkInField } from "./walk-in-rules";

type Errors = Partial<Record<WalkInField, string>>;
type Save = (input: Parameters<typeof addWalkInCustomer>[0]) => Promise<AddWalkInActionResult>;

const CONTROL =
  "h-auto w-full rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-sm text-foreground shadow-none placeholder:text-[#a1a1aa] focus-visible:border-primary";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex w-full flex-col gap-[14px] rounded-xl border border-border bg-white px-5 py-[18px]">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-semibold leading-[normal] text-foreground">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function FieldBox({ label, required, optional, hint, error, children, htmlFor }: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="flex gap-[3px] text-[13px] font-medium leading-[normal] text-[#27272a]">
        {label}
        {required && <span className="text-[#dc2626]">*</span>}
        {optional && <span className="font-normal text-[#a1a1aa]">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-[#dc2626]">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function Select({ id, value, onChange, options, placeholder }: {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: readonly string[];
  placeholder: string;
}) {
  return (
    <div className="relative">
      <select id={id} className={`${CONTROL} flex appearance-none pr-9`} value={value} onChange={onChange}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function Consent({ id, label, description, checked, onChange }: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Label htmlFor={id} className="flex flex-1 flex-col gap-0.5 font-normal leading-[normal]">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={label} className="h-5 w-9" />
    </div>
  );
}

/** The Add customer form. `save` is the server action; it is a prop so the form can be exercised without a server. */
export function AddCustomerForm({ save = addWalkInCustomer }: { save?: Save }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [values, setValues] = useState({
    firstName: "", lastName: "", mobile: "", email: "", birthday: "", preferredContact: "", source: "", notes: "",
    street: "", province: "", city: "", barangay: "", zip: "", landmark: "",
  });
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; field: "email" | "mobile" } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function addTag() {
    const tag = tagDraft.trim();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagDraft("");
  }

  function input() {
    return {
      firstName: values.firstName, lastName: values.lastName, mobile: values.mobile, email: values.email,
      birthday: values.birthday, preferredContact: values.preferredContact, source: values.source,
      tags: tagDraft.trim() && !tags.includes(tagDraft.trim()) ? [...tags, tagDraft.trim()] : tags,
      emailConsent, smsConsent, notes: values.notes,
      address: { street: values.street, province: values.province, city: values.city, barangay: values.barangay, zip: values.zip, landmark: values.landmark },
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setDuplicate(null);
    setUnavailable(false);

    const payload = input();
    const checked = validateWalkIn(payload);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});

    startTransition(async () => {
      const result = await save(payload);

      if (result.ok) return router.push(`/customer-profiles/${encodeURIComponent(result.id)}`);
      if ("errors" in result) return setErrors(result.errors);
      if ("duplicate" in result) return setDuplicate(result.duplicate);
      setUnavailable(true);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {duplicate && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-badge-destructive px-4 py-3 text-sm text-badge-destructive-foreground">
          This {duplicate.field === "email" ? "email" : "mobile number"} already belongs to{" "}
          <Link className="font-medium underline" href={`/customer-profiles/${encodeURIComponent(duplicate.id)}`}>
            {duplicate.name}
          </Link>
          . Open their profile instead of adding them again.
        </div>
      )}
      {unavailable && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-badge-destructive px-4 py-3 text-sm text-badge-destructive-foreground">
          The customer could not be saved. Try again; if it keeps happening, tell whoever maintains CREOMS.
        </div>
      )}

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
          <Section title="Basic information" description="Name and contact details. Email or mobile is used to match this person to future orders.">
            <div className="flex items-start gap-2 rounded-lg bg-[#eff6ff] px-3 py-2.5">
              <Info aria-hidden className="size-4 shrink-0 text-[#1d4ed8]" />
              <p className="text-[13px] leading-[normal] text-[#1d4ed8]">
                Checks for duplicates: if this email or mobile already belongs to a customer, you will be asked to open that profile instead.
              </p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <FieldBox label="First name" required htmlFor="firstName" error={errors.firstName}>
                <Input id="firstName" className={CONTROL} value={values.firstName} onChange={set("firstName")} autoComplete="off" />
              </FieldBox>
              <FieldBox label="Last name" required htmlFor="lastName" error={errors.lastName}>
                <Input id="lastName" className={CONTROL} value={values.lastName} onChange={set("lastName")} autoComplete="off" />
              </FieldBox>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <FieldBox label="Mobile number" required htmlFor="mobile" hint="11 digits. Used for courier contact and SMS." error={errors.mobile}>
                <Input id="mobile" className={CONTROL} inputMode="tel" placeholder="0917 123 4567" value={values.mobile} onChange={set("mobile")} />
              </FieldBox>
              <FieldBox label="Email" htmlFor="email" error={errors.email}>
                <Input id="email" className={`${CONTROL} ${errors.email ? "border-[#dc2626]" : ""}`} type="email" placeholder="name@example.com" value={values.email} onChange={set("email")} />
              </FieldBox>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <FieldBox label="Birthday" optional htmlFor="birthday" hint="For birthday promos." error={errors.birthday}>
                <Input id="birthday" className={CONTROL} type="date" value={values.birthday} onChange={set("birthday")} />
              </FieldBox>
              <FieldBox label="Preferred contact" htmlFor="preferredContact" error={errors.preferredContact}>
                <Select id="preferredContact" value={values.preferredContact} onChange={set("preferredContact")} options={PREFERRED_CONTACTS} placeholder="Not specified" />
              </FieldBox>
            </div>
          </Section>

          <Section title="Default delivery address" description="Pre-fills the address on new orders. Customers can have more than one address.">
            <FieldBox label="House / unit no. and street" htmlFor="street">
              <Input id="street" className={CONTROL} value={values.street} onChange={set("street")} />
            </FieldBox>
            <div className="flex flex-col gap-4 sm:flex-row">
              <FieldBox label="Province" htmlFor="province"><Input id="province" className={CONTROL} value={values.province} onChange={set("province")} /></FieldBox>
              <FieldBox label="City / municipality" htmlFor="city"><Input id="city" className={CONTROL} value={values.city} onChange={set("city")} /></FieldBox>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <FieldBox label="Barangay" htmlFor="barangay"><Input id="barangay" className={CONTROL} value={values.barangay} onChange={set("barangay")} /></FieldBox>
              <FieldBox label="ZIP code" htmlFor="zip"><Input id="zip" className={CONTROL} inputMode="numeric" value={values.zip} onChange={set("zip")} /></FieldBox>
              <FieldBox label="Landmark" optional htmlFor="landmark"><Input id="landmark" className={CONTROL} value={values.landmark} onChange={set("landmark")} /></FieldBox>
            </div>
          </Section>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[400px]">
          <Section title="Source and tags">
            <FieldBox label="How did they find us?" htmlFor="source" hint={`Options: ${SOURCES.join(", ")}`} error={errors.source}>
              <Select id="source" value={values.source} onChange={set("source")} options={SOURCES} placeholder="Not specified" />
            </FieldBox>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag" className="text-[13px] font-medium leading-[normal] text-[#27272a]">Tags</Label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5">
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-badge-purple py-[3px] pl-2 pr-1.5 text-xs font-medium text-badge-purple-foreground">
                    {tag}
                    <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => setTags(tags.filter((t) => t !== tag))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  id="tag"
                  className="min-w-24 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-[#a1a1aa]"
                  placeholder="Add tag…"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                />
              </div>
            </div>
          </Section>

          <Section title="Marketing consent" description="Required before sending promos. Order updates are always sent.">
            <Consent id="emailConsent" label="Email newsletters" description="Campaigns, restock and promo emails" checked={emailConsent} onChange={setEmailConsent} />
            <Consent id="smsConsent" label="SMS promos" description="Text messages about sales" checked={smsConsent} onChange={setSmsConsent} />
          </Section>

          <Section title="Internal notes">
            <div className="flex flex-col gap-1.5">
              <Textarea aria-label="Internal notes" className={`${CONTROL} h-[72px] min-h-0 resize-none`} value={values.notes} onChange={set("notes")} />
              <p className="text-xs text-muted-foreground">Only staff can see this.</p>
            </div>
          </Section>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Lifecycle stage starts as
            <span className="rounded-full bg-[#e3eefb] px-2.5 py-[3px] font-medium text-[#1d4f91]">New</span>
            and updates by itself
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-xl -mb-7 mt-2 flex items-center gap-2 border-t border-[#ebebeb] bg-white px-xl py-[14px]">
        <p className="flex-1 text-[13px] text-muted-foreground">Fields marked * are required.</p>
        <Button type="button" variant="outline" asChild>
          <Link href="/customer-profiles">Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save customer"}
        </Button>
      </div>
    </form>
  );
}
