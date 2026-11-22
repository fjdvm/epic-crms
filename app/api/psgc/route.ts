import { NextResponse, type NextRequest } from "next/server";

import { listBarangays, listCities, listProvinces, listRegions, type PsgcOption } from "@/lib/psgc";

/**
 * Options for the cascading address picker, from the bundled PSGC list (no outside call). `level` is the list wanted;
 * `region`, `province` and `city` are the codes picked above it. Signed-in Staff only (the proxy guards /api).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const level = q.get("level");
  const region = q.get("region") ?? "";
  let options: PsgcOption[];
  if (level === "region") options = listRegions();
  else if (level === "province") options = listProvinces(region);
  else if (level === "city") options = listCities(region, q.get("province") ?? "");
  else if (level === "barangay") options = await listBarangays(region, q.get("city") ?? "");
  else return NextResponse.json({ message: "Choose a list to load." }, { status: 400 });
  return NextResponse.json({ options }, { headers: { "Cache-Control": "private, max-age=86400" } });
}
