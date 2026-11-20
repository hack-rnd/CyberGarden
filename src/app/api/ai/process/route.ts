import { NextResponse } from "next/server";
import { processAiQueue } from "@/lib/ai/processor";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- POST HANDLER ---

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { batchSize?: number };
    const batchSize =
      typeof body.batchSize === "number" && body.batchSize > 0
        ? Math.min(body.batchSize, 20)
        : 5;

    const processed = await processAiQueue(batchSize);
    return NextResponse.json({ processed });
  } catch {
    return NextResponse.json({ processed: 0 }, { status: 500 });
  }
}
