import { NextResponse } from "next/server";
import { incidentStore } from "@/lib/mts/store";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- GET HANDLER ---

export async function GET() {
  await incidentStore.ensureInitialized();
  const snapshot = incidentStore.getSnapshot();
  return NextResponse.json(snapshot);
}