import { safeReturnTo } from "@/lib/portal/return-to";

export default async function UnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center p-md">
      <div className="max-w-md space-y-sm text-center">
        <h1 className="text-headline-md text-foreground">CREOMS is temporarily unavailable</h1>
        <p className="text-body-sm text-muted-foreground">
          CREOMS could not reach the Portal to check your access, so nothing can be opened right
          now. Please try again in a moment.
        </p>
        <a href={safeReturnTo(returnTo)} className="text-sm font-medium underline">
          Try again
        </a>
      </div>
    </main>
  );
}
