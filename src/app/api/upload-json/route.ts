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
        { error: "Файл не содержит валидных инцидентов в формате МТС." },
        { status: 400 },
      );
    }

    const configured = process.env.MTS_JSON_PATH || "./data/incidents.json";
    const filePath = path.resolve(process.cwd(), configured);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const serialized = JSON.stringify(body, null, 2);
    const tmpPath = `${filePath}.tmp`;
    try {
      fs.writeFileSync(tmpPath, serialized, "utf-8");
      fs.renameSync(tmpPath, filePath);
    } catch {
      fs.writeFileSync(filePath, serialized, "utf-8");
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // Ignore temp cleanup failure
        }
      }
    }

    await incidentStore.reloadFromDisk(true);

    return NextResponse.json({
      ok: true,
      count: parsed.length,
    });
  } catch (err) {
    const message =
      err instanceof SyntaxError
        ? "Некорректный синтаксис JSON-файла."
        : err instanceof Error
          ? err.message
          : "Не удалось загрузить JSON-файл.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}