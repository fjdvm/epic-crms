import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-md sm:p-lg space-y-sm">
      <h1 className="text-headline-md text-foreground">Order not found</h1>
      <p className="text-muted-foreground">There is no Order with this number.</p>
      <Link href="/orders" className="underline">
        Back to Orders
      </Link>
    </div>
  );
}
