import { Hono } from "hono";
import { stream } from "hono/streaming";
import { spawn } from "child_process";
import { sandboxes, commands, generateId } from "../state.js";
import type { TrackedCommand } from "../state.js";

const CONTAINER_CLI = "container";

const app = new Hono();

// POST /:sandboxId/cmd — Run command
app.post("/:sandboxId/cmd", async (c) => {
  const { sandboxId } = c.req.param();
  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }
  if (entry.status !== "running") {
    return c.json({ error: { code: "bad_request", message: "Sandbox is not running" } }, 400);
  }

  const body = await c.req.json();
  const {
    command: cmdName,
    args = [],
    cwd = "/workspace",
    env = {},
    sudo = false,
    wait = false,
  } = body;

  const cmdId = generateId();
  const execArgs = ["exec", "-w", cwd];
  if (sudo) execArgs.push("-u", "root");
  execArgs.push(entry._containerName);

  // Wrap with `env` command if environment variables are provided
  const envEntries = Object.entries(env);
  if (envEntries.length > 0) {
    execArgs.push("env");
    for (const [key, value] of envEntries) {
      execArgs.push(`${key}=${value}`);
    }
  }

  execArgs.push(cmdName, ...args);

  const proc = spawn(CONTAINER_CLI, execArgs, { stdio: ["ignore", "pipe", "pipe"] });
  const now = Date.now();

  const tracked: TrackedCommand = {
    id: cmdId,
    name: cmdName,
    args,
    cwd,
    sandboxId,
    exitCode: null,
    startedAt: now,
    _process: proc,
    _stdout: [],
    _stderr: [],
  };

  proc.stdout.on("data", (chunk: Buffer) => tracked._stdout.push(Buffer.from(chunk)));
  proc.stderr.on("data", (chunk: Buffer) => tracked._stderr.push(Buffer.from(chunk)));

  proc.on("close", (code) => {
    tracked.exitCode = code ?? 0;
    tracked._process = null;
  });

  proc.on("error", () => {
    tracked.exitCode = -1;
    tracked._process = null;
  });

  commands.set(cmdId, tracked);

  if (wait) {
    c.header("Content-Type", "application/x-ndjson");

    return stream(c, async (s) => {
      // First line: command started (exitCode: null)
      await s.write(JSON.stringify({ command: commands.serialize(tracked) }) + "\n");

      // Wait for process to finish
      await new Promise<void>((resolve) => {
        if (tracked._process === null) {
          resolve();
          return;
        }
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
      });

      // Final line: command finished (exitCode populated)
      await s.write(JSON.stringify({ command: commands.serialize(tracked) }) + "\n");
    });
  }

  return c.json({ command: commands.serialize(tracked) });
});

// GET /:sandboxId/cmd/:cmdId — Get command
app.get("/:sandboxId/cmd/:cmdId", async (c) => {
  const { sandboxId, cmdId } = c.req.param();
  const wait = c.req.query("wait");

  const tracked = commands.get(cmdId);
  if (!tracked || tracked.sandboxId !== sandboxId) {
    return c.json({ error: { code: "not_found", message: "Command not found" } }, 404);
  }

  if (wait === "true" && tracked._process !== null) {
    await new Promise<void>((resolve) => {
      if (tracked._process === null) {
        resolve();
        return;
      }
      tracked._process.on("close", () => resolve());
      tracked._process.on("error", () => resolve());
    });
  }

  return c.json({ command: commands.serialize(tracked) });
});

// GET /:sandboxId/cmd/:cmdId/logs — Get command logs (NDJSON stream)
app.get("/:sandboxId/cmd/:cmdId/logs", async (c) => {
  const { sandboxId, cmdId } = c.req.param();

  const tracked = commands.get(cmdId);
  if (!tracked || tracked.sandboxId !== sandboxId) {
    return c.json({ error: { code: "not_found", message: "Command not found" } }, 404);
  }

  c.header("Content-Type", "application/x-ndjson");

  return stream(c, async (s) => {
    // Flush buffered output
    let stdoutIdx = 0;
    let stderrIdx = 0;

    const flushBuffered = async () => {
      while (stdoutIdx < tracked._stdout.length) {
        await s.write(
          JSON.stringify({ stream: "stdout", data: tracked._stdout[stdoutIdx].toString() }) + "\n",
        );
        stdoutIdx++;
      }
      while (stderrIdx < tracked._stderr.length) {
        await s.write(
          JSON.stringify({ stream: "stderr", data: tracked._stderr[stderrIdx].toString() }) + "\n",
        );
        stderrIdx++;
      }
    };

    await flushBuffered();

    // If still running, keep streaming until done
    if (tracked._process !== null) {
      await new Promise<void>((resolve) => {
        const interval = setInterval(async () => {
          try {
            await flushBuffered();
          } catch {
            clearInterval(interval);
            resolve();
          }
        }, 50);

        const onDone = async () => {
          clearInterval(interval);
          try {
            await flushBuffered();
          } catch {
            // stream may have been closed
          }
          resolve();
        };

        if (tracked._process === null) {
          onDone();
          return;
        }
        tracked._process.on("close", onDone);
        tracked._process.on("error", async (err) => {
          clearInterval(interval);
          try {
            await s.write(
              JSON.stringify({
                stream: "error",
                data: { code: "exec_error", message: err.message },
              }) + "\n",
            );
          } catch {
            // stream closed
          }
          resolve();
        });
      });
    }
  });
});

// POST /:sandboxId/:commandId/kill — Kill command
app.post("/:sandboxId/:commandId/kill", async (c) => {
  const { sandboxId, commandId } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const { signal = 9 } = body as { signal?: number };

  const tracked = commands.get(commandId);
  if (!tracked || tracked.sandboxId !== sandboxId) {
    return c.json({ error: { code: "not_found", message: "Command not found" } }, 404);
  }

  if (tracked._process) {
    tracked._process.kill(signal);
  }

  return c.json({ command: commands.serialize(tracked) });
});

export default app;
