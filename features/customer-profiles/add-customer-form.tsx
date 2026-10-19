"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { addWalkInCustomer, type AddWalkInActionResult } from "./actions";
import { TabCard } from "./tab-card";
import { PREFERRED_CONTACTS, SOURCES, validateWalkIn, type WalkInField } from "./walk-in-rules";

type Errors = Partial<Record<WalkInField, string>>;
type Save = (input: Parameters<typeof addWalkInCustomer>[0]) => Promise<AddWalkInActionResult>;

const SELECT =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-sm py-xs text-base shadow-sm focus-visible:outline-none md:text-sm";

function FieldBox({ label, required, error, children, htmlFor }: {
  label: string;
  required?: boolean;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Consent({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-2.5">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={label} />
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
    <form onSubmit={submit} noValidate className="space-y-5">
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

      <TabCard title="Customer details">
        <div className="grid gap-md sm:grid-cols-2">
          <FieldBox label="First name" required htmlFor="firstName" error={errors.firstName}>
            <Input id="firstName" value={values.firstName} onChange={set("firstName")} autoComplete="off" />
          </FieldBox>
          <FieldBox label="Last name" required htmlFor="lastName" error={errors.lastName}>
            <Input id="lastName" value={values.lastName} onChange={set("lastName")} autoComplete="off" />
          </FieldBox>
          <FieldBox label="Mobile number" required htmlFor="mobile" error={errors.mobile}>
            <Input id="mobile" inputMode="tel" placeholder="0917 123 4567" value={values.mobile} onChange={set("mobile")} />
          </FieldBox>
          <FieldBox label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" type="email" placeholder="name@example.com" value={values.email} onChange={set("email")} />
          </FieldBox>
          <FieldBox label="Birthday" htmlFor="birthday" error={errors.birthday}>
            <Input id="birthday" type="date" value={values.birthday} onChange={set("birthday")} />
          </FieldBox>
          <FieldBox label="Preferred contact" htmlFor="preferredContact" error={errors.preferredContact}>
            <select id="preferredContact" className={SELECT} value={values.preferredContact} onChange={set("preferredContact")}>
              <option value="">Not specified</option>
              {PREFERRED_CONTACTS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Source" htmlFor="source" error={errors.source}>
            <select id="source" className={SELECT} value={values.source} onChange={set("source")}>
              <option value="">Not specified</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </FieldBox>
        </div>

        <FieldBox label="Tags" htmlFor="tag">
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-badge-purple px-2.5 py-[3px] text-xs font-medium text-badge-purple-foreground">
                {tag}
                <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => setTags(tags.filter((t) => t !== tag))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Input
              id="tag"
              className="w-48"
              placeholder="Add a tag, press Enter"
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
        </FieldBox>
      </TabCard>

      <TabCard title="Marketing consent">
        <div className="grid gap-md sm:grid-cols-2">
          <Consent id="emailConsent" label="Email newsletter" checked={emailConsent} onChange={setEmailConsent} />
          <Consent id="smsConsent" label="SMS promos" checked={smsConsent} onChange={setSmsConsent} />
        </div>
      </TabCard>

      <TabCard title="Default delivery address">
        <div className="grid gap-md sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FieldBox label="Street" htmlFor="street"><Input id="street" value={values.street} onChange={set("street")} /></FieldBox>
          </div>
          <FieldBox label="Province" htmlFor="province"><Input id="province" value={values.province} onChange={set("province")} /></FieldBox>
          <FieldBox label="City" htmlFor="city"><Input id="city" value={values.city} onChange={set("city")} /></FieldBox>
          <FieldBox label="Barangay" htmlFor="barangay"><Input id="barangay" value={values.barangay} onChange={set("barangay")} /></FieldBox>
          <FieldBox label="ZIP" htmlFor="zip"><Input id="zip" inputMode="numeric" value={values.zip} onChange={set("zip")} /></FieldBox>
          <div className="sm:col-span-2">
            <FieldBox label="Landmark" htmlFor="landmark"><Input id="landmark" value={values.landmark} onChange={set("landmark")} /></FieldBox>
          </div>
        </div>
      </TabCard>

      <TabCard title="Internal notes" note="Visible to Staff only">
        <Textarea aria-label="Internal notes" rows={4} value={values.notes} onChange={set("notes")} />
      </TabCard>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Fields marked * are required</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href="/customer-profiles">Cancel</Link>
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save customer"}
          </Button>
        </div>
      </div>
    </form>
  );
}
