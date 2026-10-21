import { SigningIn } from "@/components/loading/signing-in";
import { LOGIN_PATH } from "@/lib/portal/config";
import { safeReturnTo } from "@/lib/portal/return-to";

export default async function SigningInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  return (
    <SigningIn
      loginUrl={`${LOGIN_PATH}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`}
    />
  );
}
