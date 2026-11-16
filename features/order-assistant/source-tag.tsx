import { Sparkles } from "lucide-react";

/** The purple "From order assistant" tag used on handed-off Tickets. */
export function SourceTag() {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-full bg-[#f3e8ff] py-[3px] pl-[7px] pr-[10px] text-xs font-medium whitespace-nowrap text-[#7c3aed]">
      <Sparkles className="size-3" aria-hidden />
      From order assistant
    </span>
  );
}
