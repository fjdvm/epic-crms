import { NextResponse, type NextRequest } from "next/server";

import { DEV_ROLE_COOKIE, DEV_ROLES, devBypassEnabled, isDevRole } from "@/lib/portal/dev-bypass";

export const dynamic = "force-dynamic";

/**
 * Local development only: `/api/dev/role?role=ceo` signs the dev bypass in as that Role
 * (staff, manager, admin or ceo) and returns to the page you were on. Not found unless the bypass is on.
 */
export function GET(request: NextRequest) {
  if (!devBypassEnabled()) return new NextResponse(null, { status: 404 });

  const role = request.nextUrl.searchParams.get("role") ?? undefined;
  if (!isDevRole(role)) {
    return NextResponse.json({ error: `role must be one of ${DEV_ROLES.join(", ")}` }, { status: 400 });
  }

  const back = new URL("/", request.url);
  const from = request.headers.get("referer");
  if (from && new URL(from).origin === back.origin) back.href = from;

  const response = NextResponse.redirect(back, 303);
  response.cookies.set(DEV_ROLE_COOKIE, role, { path: "/", sameSite: "lax" });

  return response;
}
