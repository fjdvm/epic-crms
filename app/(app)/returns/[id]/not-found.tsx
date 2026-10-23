import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-md sm:p-lg space-y-sm">
      <h1 className="text-headline-md text-foreground">Return not found</h1>
      <p className="text-muted-foreground">There is no Return with this number.</p>
      <Link href="/returns" className="underline">
        Back to Returns
      </Link>
    </div>
  );
}
