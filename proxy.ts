import { NextResponse, type NextRequest } from "next/server";
import { devBypassEnabled } from "@/lib/portal/dev-bypass";
import { SESSION_COOKIE, SIGNING_IN_PATH } from "@/lib/portal/config";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const returnTo = `${pathname}${search}`;

  if (!devBypassEnabled() && !request.cookies.get(SESSION_COOKIE)?.value) {
    const signingIn = new URL(SIGNING_IN_PATH, request.url);
    signingIn.searchParams.set("returnTo", returnTo);

    return NextResponse.redirect(signingIn);
  }

  const headers = new Headers(request.headers);
  headers.set("x-return-to", returnTo);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/((?!_next/|api/portal/|api/notifications/sync|api/cron/|sign-in-error|signing-in|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
