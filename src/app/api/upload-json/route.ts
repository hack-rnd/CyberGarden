import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { parseMtsJson } from "@/lib/mts/adapter";
import { incidentStore } from "@/lib/mts/store";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- POST HANDLER ---

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = parseMtsJson(body);

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "JSON does not contain valid incidents" },
        { status: 400 }
      );
    }

    const configured = process.env.MTS_JSON_PATH || "./data/incidents.json";
    const filePath = path.resolve(process.cwd(), configured);
    fs.writeFileSync(filePath, JSON.stringify(body, null, 2), "utf-8");

    await incidentStore.reloadFromDisk(true);

    return NextResponse.json({
      ok: true,
      count: parsed.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to upload JSON";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}