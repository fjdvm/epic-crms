export default function Loading() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-7 sm:px-8" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded bg-[#ececf0]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-[#ececf0]" />)}</div>
      {[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-[#ececf0]" />)}
    </div>
  );
}
