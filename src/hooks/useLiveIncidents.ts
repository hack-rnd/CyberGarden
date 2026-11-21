"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DiffEvent, IncidentsApiResponse } from "@/types/incident";

// --- TYPES ---

interface StreamMessage {
  snapshot: IncidentsApiResponse;
  events: DiffEvent[];
}

export type StreamConnectionState = "connecting" | "connected" | "reconnecting";

interface UseLiveIncidentsOptions {
  onEvents?: (events: DiffEvent[]) => void;
}

// --- FETCHER ---

async function fetchIncidents(): Promise<IncidentsApiResponse> {
  const res = await fetch("/api/incidents", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to fetch incidents");
  }
  return res.json();
}

// --- HOOK ---

export function useLiveIncidents(options?: UseLiveIncidentsOptions) {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] =
    useState<StreamConnectionState>("connecting");
  const [recentEvents, setRecentEvents] = useState<DiffEvent[]>([]);
  const onEventsRef = useRef(options?.onEvents);

  useEffect(() => {
    onEventsRef.current = options?.onEvents;
  }, [options?.onEvents]);

  const query = useQuery<IncidentsApiResponse>({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
    refetchInterval: connectionState === "connected" ? 4_000 : 2_000,
  });

  useEffect(() => {
    const source = new EventSource("/api/stream");

    const handlePayload = (raw: string) => {
      try {
        const payload = JSON.parse(raw) as StreamMessage;
        queryClient.setQueryData(["incidents"], payload.snapshot);

        if (payload.events && payload.events.length > 0) {
          setRecentEvents((prev) => [...payload.events, ...prev].slice(0, 50));
          onEventsRef.current?.(payload.events);
        }
      } catch {
        // Ignore malformed SSE payload
      }
    };

    source.onopen = () => {
      setConnectionState("connected");
    };

    source.addEventListener("snapshot", (e) => {
      setConnectionState("connected");
      handlePayload((e as MessageEvent).data);
    });

    source.addEventListener("update", (e) => {
      setConnectionState("connected");
      handlePayload((e as MessageEvent).data);
    });

    source.onerror = () => {
      setConnectionState("reconnecting");
    };

    return () => {
      source.close();
    };
  }, [queryClient]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    connectionState,
    recentEvents,
  };
}