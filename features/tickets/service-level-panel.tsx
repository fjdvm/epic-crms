import { cn } from "@/lib/utils";

import { PILL, Pill } from "./pill";
import { describeClock, describeTarget, type Clock, type ServiceLevel } from "./service-level";

const TONE: Record<Clock["state"], string> = {
  running: "text-[#5b2a86]",
  breaching: "text-[#b45309]",
  paused: "text-[#6e6680]",
  met: "text-[#15803d]",
  missed: "text-[#b91c1c]",
  done: "text-[#6e6680]",
};

const BAR: Record<Clock["state"], string> = {
  running: "bg-[#7c4dff]",
  breaching: "bg-[#d97706]",
  paused: "bg-[#a89fbb]",
  met: "bg-[#16a34a]",
  missed: "bg-[#dc2626]",
  done: "bg-[#e6e1ee]",
};

/** Share of the target already used, 0 to 100. */
function used(clock: Clock): number {
  if (clock.remainingSeconds === null) return 0;
  const target = clock.targetHours * 3600;

  return Math.min(100, Math.max(0, ((target - clock.remainingSeconds) / target) * 100));
}

function Meter({ label, clock }: { label: string; clock: Clock }) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm leading-[normal]">
        <span className="font-medium text-[#1f1a2e]">{label}</span>
        <span className={cn("font-medium", TONE[clock.state])}>{describeClock(clock)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#efebf4]" aria-hidden="true">
        <div className={cn("h-full rounded-full", BAR[clock.state])} style={{ width: `${clock.state === "missed" ? 100 : used(clock)}%` }} />
      </div>
      <p className="text-xs leading-[normal] text-[#6e6680]">
        Target {describeTarget(clock.targetHours)}
        {clock.state === "paused" ? ` · paused while ${clock.pausedFor === "hold" ? "On hold" : "waiting on the Customer"}` : ""}
      </p>
    </div>
  );
}

/** The Ticket detail's Service level panel: both targets, from the pair in force when the Ticket was opened. */
export function ServiceLevelPanel({ level }: { level: ServiceLevel }) {
  const paused = level.current.state === "paused";

  return (
    <section aria-label="Service level" className="shrink-0 rounded-xl border border-[#e6e1ee] bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold leading-[normal] text-[#1f1a2e]">Service level</h2>
        {paused ? <Pill className={PILL.amber}>Clock paused</Pill> : null}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
        <Meter label="First reply" clock={level.firstReply} />
        <Meter label="Resolve" clock={level.resolve} />
      </div>
    </section>
  );
}
