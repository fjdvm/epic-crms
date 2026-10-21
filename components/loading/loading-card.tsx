/* eslint-disable @next/next/no-img-element -- fixed-size Figma vector assets */

/** The Figma loading card: a centered card over a blurred, dimmed page. */
export function LoadingCard({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-[rgba(250,247,252,0.55)] backdrop-blur-[8px]"
    >
      <div className="flex flex-col items-center gap-[18px] rounded-[20px] border border-[#ece6f2] bg-white px-10 pb-7 pt-8 shadow-[0px_16px_40px_0px_rgba(51,26,77,0.12)]">
        <div className="relative size-[72px]">
          <img
            src="/loading/ring-track.svg"
            alt=""
            className="absolute inset-0 size-[72px]"
          />
          <div className="absolute inset-0 animate-spin motion-reduce:animate-none">
            <img
              src="/loading/ring-arc.svg"
              alt=""
              className="absolute left-1/2 top-0 block h-[78.23%] w-[49.96%] max-w-none"
            />
          </div>
          <div className="absolute left-[14px] top-[14px] size-[44px] overflow-hidden rounded-[10px] bg-black">
            <img src="/loading/logo.svg" alt="" className="size-[44px]" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 whitespace-nowrap">
          <p className="text-[17px] font-semibold text-[#18181b]">{title}</p>
          <p className="text-[13px] text-[#71717a]">{subtitle}</p>
        </div>
        <img src="/loading/dots.svg" alt="" className="h-[6px] w-[30px]" />
      </div>
    </div>
  );
}
