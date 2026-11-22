"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { ProfileInput } from "@/components/shared/profile-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DEFAULT_COUNTRY, type PsgcOption } from "@/lib/psgc";

export interface AddressPick {
  country: string;
  regionCode: string;
  provinceCode: string;
  cityCode: string;
  barangayCode: string;
  street: string;
}

/** An address saved before the pickers existed: free text, shown as it is until Staff pick a fresh one. */
export interface LegacyAddress { street: string; barangay: string; city: string; province: string; country: string }

export type PsgcQuery = { level: "region" | "province" | "city" | "barangay"; region?: string; province?: string; city?: string };
export type LoadOptions = (query: PsgcQuery) => Promise<PsgcOption[]>;

const cache = new Map<string, PsgcOption[]>();

/** Loads one list from the app, remembering it so a list already seen shows at once. */
export const fetchPsgcOptions: LoadOptions = async (query) => {
  const key = new URLSearchParams(Object.entries(query) as [string, string][]).toString();
  const hit = cache.get(key);
  if (hit) return hit;
  const response = await fetch(`/api/psgc?${key}`);
  if (!response.ok) throw new Error("The address list could not be loaded.");
  const { options } = (await response.json()) as { options: PsgcOption[] };
  cache.set(key, options);
  return options;
};

const EMPTY: AddressPick = { country: DEFAULT_COUNTRY, regionCode: "", provinceCode: "", cityCode: "", barangayCode: "", street: "" };
const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-sm py-xs text-sm shadow-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

type Level = "region" | "province" | "city" | "barangay";
type Lists = Record<Level, PsgcOption[] | null>;
const NONE: Lists = { region: null, province: null, city: null, barangay: null };

function plain(a: LegacyAddress): string {
  return [a.street, a.barangay, a.city, a.province, a.country].filter(Boolean).join(", ");
}

/**
 * Country, Region, Province, City and Barangay dropdowns that narrow one another (Philippine PSGC list), plus a Street
 * text field with the profile masks. An old free-text address shows as plain text and asks for a fresh pick when edited.
 * Read-only (Admin) shows the address as text only.
 */
export function AddressPicker({
  legacy = null,
  initial,
  readOnly = false,
  loadOptions = fetchPsgcOptions,
  onChange,
  streetError,
}: {
  legacy?: LegacyAddress | null;
  /** A saved pick to start from (codes and street), so the lists open already narrowed to it. */
  initial?: Partial<AddressPick>;
  readOnly?: boolean;
  loadOptions?: LoadOptions;
  onChange?: (value: AddressPick) => void;
  streetError?: string;
}) {
  const [pick, setPick] = useState<AddressPick>({ ...EMPTY, ...initial });
  const [lists, setLists] = useState<Lists>(NONE);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(!legacy);
  const ids = { region: useId(), province: useId(), city: useId(), barangay: useId(), country: useId() };

  const load = useCallback(
    (query: PsgcQuery, then?: (options: PsgcOption[]) => void) => {
      setFailed(false);
      loadOptions(query).then(
        (options) => { setLists((l) => ({ ...l, [query.level]: options })); then?.(options); },
        () => setFailed(true),
      );
    },
    [loadOptions],
  );

  useEffect(() => {
    if (!editing || readOnly) return;
    load({ level: "region" });
    // A saved pick opens with every list it needs already loaded.
    if (initial?.regionCode) load({ level: "province", region: initial.regionCode });
    if (initial?.regionCode && initial.provinceCode) load({ level: "city", region: initial.regionCode, province: initial.provinceCode });
    if (initial?.regionCode && initial.cityCode) load({ level: "barangay", region: initial.regionCode, city: initial.cityCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, readOnly, load]);

  const update = (next: AddressPick) => { setPick(next); onChange?.(next); };

  const chooseRegion = (regionCode: string) => {
    update({ ...pick, regionCode, provinceCode: "", cityCode: "", barangayCode: "" });
    setLists((l) => ({ ...l, province: null, city: null, barangay: null }));
    if (regionCode) load({ level: "province", region: regionCode }, (options) => { if (options.length === 1) chooseProvince(options[0].code, regionCode); });
  };
  const chooseProvince = (provinceCode: string, regionCode = pick.regionCode) => {
    update({ ...pick, regionCode, provinceCode, cityCode: "", barangayCode: "" });
    setLists((l) => ({ ...l, city: null, barangay: null }));
    if (provinceCode) load({ level: "city", region: regionCode, province: provinceCode });
  };
  const chooseCity = (cityCode: string) => {
    update({ ...pick, cityCode, barangayCode: "" });
    setLists((l) => ({ ...l, barangay: null }));
    if (cityCode) load({ level: "barangay", region: pick.regionCode, city: cityCode });
  };

  if (readOnly || !editing) {
    return (
      <div className="space-y-1">
        <Label>Address</Label>
        <p className="text-sm text-foreground">{legacy ? plain(legacy) : "No address saved."}</p>
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Change address</Button>
        ) : null}
      </div>
    );
  }

  const dropdown = (level: Exclude<Level, never>, label: string, value: string, disabled: boolean, onPick: (code: string) => void) => {
    const options = lists[level];
    return (
      <div className="space-y-1">
        <Label htmlFor={ids[level]}>{label}</Label>
        {options === null && !disabled ? (
          <Skeleton className="h-9 w-full" data-testid={`${level}-loading`} />
        ) : (
          <select id={ids[level]} className={cn(SELECT_CLASS)} value={value} disabled={disabled} onChange={(e) => onPick(e.target.value)}>
            <option value="">{`Select ${label.toLowerCase()}`}</option>
            {(options ?? []).map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-md">
      {legacy ? (
        <p role="note" className="text-sm text-muted-foreground">
          This address was saved as plain text ({plain(legacy)}). Pick it again from the lists.
        </p>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={ids.country}>Country</Label>
        <select id={ids.country} className={SELECT_CLASS} value={pick.country} onChange={(e) => update({ ...pick, country: e.target.value })}>
          <option value={DEFAULT_COUNTRY}>{DEFAULT_COUNTRY}</option>
        </select>
      </div>
      <div className="grid gap-md sm:grid-cols-2">
        {dropdown("region", "Region", pick.regionCode, false, chooseRegion)}
        {dropdown("province", "Province", pick.provinceCode, !pick.regionCode, (c) => chooseProvince(c))}
        {dropdown("city", "City", pick.cityCode, !pick.provinceCode, chooseCity)}
        {dropdown("barangay", "Barangay", pick.barangayCode, !pick.cityCode, (barangayCode) => update({ ...pick, barangayCode }))}
      </div>
      <ProfileInput field="street" label="Street" initialValue={pick.street} serverError={streetError} onValueChange={(street) => update({ ...pick, street })} />
      {failed ? <p role="alert" className="text-label-md text-destructive">The address list could not be loaded. Try again.</p> : null}
    </div>
  );
}
