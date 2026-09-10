import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type QueuedTask = {
  kind: "planner" | "chat";
  requestId: string;
  action?: string;
  weekStart: string;
  date?: string;
  targetMonth?: string;
  prompt?: string;
  message?: string;
  conversation?: { role: "user" | "assistant"; content: string }[];
};

export function openRouterConfigured() {
  return Boolean(
    process.env.OPENROUTER_API_KEY?.trim() &&
      process.env.OPENROUTER_MODEL?.trim(),
  );
}

export function queueOpenRouterTask(task: QueuedTask) {
  const root = process.cwd();
  const directory = path.join(root, "data", "agent-requests");
  fs.mkdirSync(directory, { recursive: true });
  const requestPath = path.join(directory, `${task.kind}-${task.requestId}-${randomUUID()}.json`);
  fs.writeFileSync(requestPath, JSON.stringify(task), { encoding: "utf8", mode: 0o600 });

  try {
    const worker = spawn(process.execPath, [path.join(root, "scripts", "openrouter-agent.mjs"), requestPath], {
      cwd: root,
      detached: true,
      // Keep worker diagnostics in `docker logs meal` so stalled requests are
      // observable without exposing prompts or API keys.
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, MEAL_PLAN_ROOT: process.env.MEAL_PLAN_ROOT || root },
    });
    worker.once("error", (error) =>
      console.error(`OpenRouter worker failed to start (${task.requestId}):`, error),
    );
    worker.once("exit", (code, signal) => {
      if (code && code !== 0)
        console.error(
          `OpenRouter worker exited (${task.requestId}): code=${code} signal=${signal ?? "none"}`,
        );
    });
    worker.unref();
  } catch (error) {
    fs.rmSync(requestPath, { force: true });
    throw error;
  }
}
