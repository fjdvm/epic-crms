import Link from "next/link";
import { notFound } from "next/navigation";
import { ComplaintThemesView } from "@/features/feedback/themes-view";
import { manilaToday, parseFilters, quickRange, type QuickRange } from "@/features/feedback/filters";
import { FEEDBACK_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { shopRole } from "@/lib/portal/roles";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const RANGES: { kind: QuickRange | null; label: string }[] = [
  { kind: "7d", label: "Last 7 days" }, { kind: "30d", label: "Last 30 days" }, { kind: "year", label: "This year" }, { kind: null, label: "All time" },
];

// Staff see nothing here; Managers make and refresh; Admin read the kept result.
export default async function ComplaintThemesPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireModule(FEEDBACK_MODULE);
  const role = shopRole(staff.role);
  if (role !== "manager" && role !== "admin") notFound();
  const { from, to } = parseFilters(await searchParams);
  const today = manilaToday();
  const href = (kind: QuickRange | null) => {
    if (!kind) return "/dashboard/ai-insights/complaint-themes";
    const r = quickRange(kind, today);
    return `/dashboard/ai-insights/complaint-themes?from=${r.from}&to=${r.to}`;
  };
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <p className="text-xs text-[#6e6680]"><Link href="/dashboard/ai-insights?category=feedback" className="hover:underline">AI insights</Link> / Complaint themes</p>
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Complaint themes <span className="ml-1 rounded-full bg-[#ede4f7] px-2 py-0.5 align-middle text-xs font-medium text-[#5b2a86]">AI</span></h1>
        <p className="text-sm text-[#6e6680]">AI reads the period&apos;s tickets, returns and feedback and groups the same problems. Made when you open this page, not on a timer.</p>
      </div>
      <nav aria-label="Period" className="flex shrink-0 flex-wrap gap-2">
        {RANGES.map(({ kind, label }) => {
          const target = kind ? quickRange(kind, today) : { from: undefined, to: undefined };
          const active = target.from === from && target.to === to;
          return <Link key={label} href={href(kind)} aria-current={active ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm ${active ? "border-[#5b2a86] bg-[#f7f3fb] text-[#5b2a86]" : "border-[#e6e1ee] bg-white text-[#1f1a2e]"}`}>{label}</Link>;
        })}
      </nav>
      <ComplaintThemesView from={from} to={to} canRefresh={role === "manager"} />
    </div>
  );
}
