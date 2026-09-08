#!/usr/bin/env node
import { spawn } from "node:child_process";

const children = [];
let stopping = false;
const launch = (args) => {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  children.push(child);
  return child;
};

if (process.env.OPENROUTER_SCHEDULER_ENABLED !== "false")
  launch(["scripts/openrouter-scheduler.mjs"]);

const server = launch([".next/standalone/server.js"]);
server.on("exit", (code, signal) => {
  stopping = true;
  for (const child of children)
    if (child !== server && !child.killed) child.kill("SIGTERM");
  process.exit(code ?? (signal ? 1 : 0));
});

for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    for (const child of children)
      if (!child.killed) child.kill(signal);
    setTimeout(() => process.exit(0), 5_000).unref();
  });
