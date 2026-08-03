import { Hono } from "hono";
import { stream } from "hono/streaming";
import { spawn } from "child_process";
import { getContainerManager } from "../../utils/container.js";
import { sandboxes } from "../state.js";

const CONTAINER_CLI = "container";

const app = new Hono();

// POST /:sandboxId/fs/mkdir — Create directory
app.post("/:sandboxId/fs/mkdir", async (c) => {
  const { sandboxId } = c.req.param();
  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }
  if (entry.status !== "running") {
    return c.json({ error: { code: "bad_request", message: "Sandbox is not running" } }, 400);
  }

  const body = await c.req.json();
  const { path, cwd = "/workspace" } = body;
  const resolvedPath = path.startsWith("/") ? path : `${cwd}/${path}`;

  const containerManager = getContainerManager();
  const result = await containerManager.execInSandbox(
    entry._containerName,
    "mkdir",
    ["-p", resolvedPath],
    10000,
    cwd,
  );

  if (!result.success) {
    return c.json({ error: { code: "internal_error", message: result.stderr } }, 500);
  }

  return c.json({});
});

// POST /:sandboxId/fs/write — Write files (gzip tarball)
app.post("/:sandboxId/fs/write", async (c) => {
  const { sandboxId } = c.req.param();
  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }
  if (entry.status !== "running") {
    return c.json({ error: { code: "bad_request", message: "Sandbox is not running" } }, 400);
  }

  const extractDir = c.req.header("x-cwd") || "/workspace";
  const bodyBuffer = await c.req.arrayBuffer();

  const proc = spawn(
    CONTAINER_CLI,
    ["exec", "-w", extractDir, entry._containerName, "tar", "xzf", "-", "-C", extractDir],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  return new Promise<Response>((resolve) => {
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(c.json({ error: { code: "internal_error", message: stderr || "Failed to extract tarball" } }, 500));
      } else {
        resolve(c.json({}));
      }
    });

    proc.on("error", (err) => {
      resolve(c.json({ error: { code: "internal_error", message: err.message } }, 500));
    });

    proc.stdin.write(Buffer.from(bodyBuffer));
    proc.stdin.end();
  });
});

// POST /:sandboxId/fs/read — Read file
app.post("/:sandboxId/fs/read", async (c) => {
  const { sandboxId } = c.req.param();
  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }
  if (entry.status !== "running") {
    return c.json({ error: { code: "bad_request", message: "Sandbox is not running" } }, 400);
  }

  const body = await c.req.json();
  const { path, cwd = "/workspace" } = body;
  const resolvedPath = path.startsWith("/") ? path : `${cwd}/${path}`;

  // Check file existence first so we can return a proper 404
  const containerManager = getContainerManager();
  const testResult = await containerManager.execInSandbox(
    entry._containerName,
    "test",
    ["-f", resolvedPath],
    5000,
    cwd,
  );

  if (!testResult.success) {
    return c.body(null, 404);
  }

  // Stream the file contents
  const proc = spawn(
    CONTAINER_CLI,
    ["exec", "-w", cwd, entry._containerName, "cat", resolvedPath],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  return stream(c, async (s) => {
    await new Promise<void>((resolve) => {
      proc.stdout.on("data", async (chunk: Buffer) => {
        try {
          await s.write(chunk);
        } catch {
          proc.kill();
          resolve();
        }
      });
      proc.on("close", () => resolve());
      proc.on("error", () => resolve());
    });
  });
});

export default app;
