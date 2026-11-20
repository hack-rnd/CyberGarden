import { incidentStore, StreamPayload } from "@/lib/mts/store";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- SSE HANDLER ---

export async function GET(request: Request) {
  await incidentStore.ensureInitialized();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (eventName: string, data: unknown) => {
        try {
          const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream already closed
        }
      };

      const initial: StreamPayload = {
        snapshot: incidentStore.getSnapshot(),
        events: [],
      };
      send("snapshot", initial);

      unsubscribe = incidentStore.subscribe((payload) => {
        send("update", payload);
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // Stream already closed
        }
      }, 15_000);

      request.signal.addEventListener("abort", () => {
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Ignore close errors
        }
      });
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}