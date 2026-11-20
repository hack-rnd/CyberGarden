import { loadLocalEnv } from "./config"
import { runDemo } from "./runDemo"

async function main() {
  loadLocalEnv()
  const action = process.argv[2]
  if (action !== "critical" && action !== "resolve" && action !== "assign" && action !== "reset") {
    throw new Error("Укажите действие: critical, resolve, assign или reset.")
  }
  console.log(await runDemo(action))
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ошибка демо-команды.")
  process.exitCode = 1
})
