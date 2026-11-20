import { incidentStore } from "@/lib/mts/store";
import { processAiQueue } from "./processor";

// --- CONFIG ---

const DEBOUNCE_MS = 2000;
const BATCH_SIZE = 3;
const MAX_PARALLEL = 2;

// --- SCHEDULER ---

interface SchedulerState {
  started: boolean;
  timer: NodeJS.Timeout | null;
}

const globalForScheduler = globalThis as unknown as {
  aiScheduler: SchedulerState | undefined;
};

function state(): SchedulerState {
  if (!globalForScheduler.aiScheduler) {
    globalForScheduler.aiScheduler = { started: false, timer: null };
  }
  return globalForScheduler.aiScheduler;
}

export function ensureAiScheduler(): void {
  const scheduler = state();
  if (scheduler.started) return;
  scheduler.started = true;

  void incidentStore
    .ensureInitialized()
    .then(() => {
      void runQueue();
      incidentStore.subscribe(() => schedule());
    })
    .catch(() => undefined);
}

export function stopAiScheduler(): void {
  const scheduler = state();
  scheduler.started = false;
  if (scheduler.timer) {
    clearTimeout(scheduler.timer);
    scheduler.timer = null;
  }
}

function schedule(): void {
  const scheduler = state();
  if (scheduler.timer) clearTimeout(scheduler.timer);
  scheduler.timer = setTimeout(() => {
    scheduler.timer = null;
    void runQueue();
  }, DEBOUNCE_MS);
}

async function runQueue(): Promise<void> {
  await processAiQueue(BATCH_SIZE, MAX_PARALLEL).catch(() => undefined);
}
