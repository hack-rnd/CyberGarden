import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "data/incidents.json");
const demo = resolve(root, "data/incidents.demo.json");
const demoId = "DEMO-CRITICAL";
const coordinators = "КЦ ИТ Координаторы Массовых Инцидентов";

async function readJson(path) {
  const text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : data?.incidents;

  if (!Array.isArray(items)) {
    throw new Error("Ожидается массив инцидентов или объект с полем incidents.");
  }

  return { data, items };
}

async function writeDemo(data) {
  const temporary = `${demo}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, demo);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function run(command) {
  if (command === "reset") {
    await writeDemo((await readJson(source)).data);
    console.log("Демо-копия восстановлена.");
    return;
  }

  if (command === "serve") {
    await readJson(demo);
    const server = spawn(
      process.execPath,
      [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1"],
      {
        cwd: root,
        env: { ...process.env, MTS_JSON_PATH: demo },
        stdio: "inherit",
      },
    );

    process.exitCode = await new Promise((done, reject) => {
      server.once("error", reject);
      server.once("exit", (code) => done(code ?? 0));
    });
    return;
  }

  const { data, items } = await readJson(demo);
  const incident = items.find((item) => item?.id === demoId);

  switch (command) {
    case "critical": {
      if (incident) {
        throw new Error("DEMO-CRITICAL уже существует. Выполни npm run demo:reset.");
      }

      const now = Date.now();
      items.push({
        id: demoId,
        product: "Демо · Платежи",
        title: "Ошибки подтверждения платежей",
        description: "Учебный инцидент для демонстрации дашборда.",
        priority: "Критический",
        status: "В работе",
        assignee_team: "Команда Core",
        created_at: new Date(now).toISOString(),
        sla_deadline: new Date(now + 30 * 60_000).toISOString(),
      });
      break;
    }

    case "assign":
      if (!incident || incident.status !== "В работе") {
        throw new Error("Сначала создай активный DEMO-CRITICAL.");
      }
      incident.assignee_team = coordinators;
      break;

    case "resolve":
      if (!incident || incident.status !== "В работе") {
        throw new Error("Сначала создай активный DEMO-CRITICAL.");
      }
      incident.status = "Решён";
      break;

    default:
      throw new Error("Доступны команды: critical, assign, resolve, reset и serve.");
  }

  await writeDemo(data);
  console.log(`Демо-данные обновлены: ${demoId} · ${command}`);
}

run(process.argv[2]).catch((error) => {
  const message = error.code === "ENOENT"
    ? "Файл не найден. Проверь data/incidents.json и выполни npm run demo:reset."
    : error.message;

  console.error(message);
  process.exitCode = 1;
});