import crypto from "crypto";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import {
  SandboxConfigSchema,
  SandboxResponseSchema,
  SandboxEntrySchema,
  ExecRequestSchema,
  ExecResponseSchema,
  ErrorResponseSchema,
} from "../../types/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { getContainerManager } from "../utils/container.js";
import log from "../utils/logger.js";
import { getTunnelManager } from "../utils/tunnelManager.js";
import type { ExecResponse } from "../../types/index.js";

const sandbox = new OpenAPIHono();
sandbox.use("*", authMiddleware());

const SandboxIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "abc123" }),
});

const TunnelRequestSchema = z.object({
  tunnelToken: z.string().openapi({ example: "token..." }),
  tunnelId: z.string().optional(),
  url: z.string().optional(),
  checkhealth: z.boolean().optional().default(true),
});

// Routes
const createSandboxRoute = createRoute({
  method: "post",
  path: "/create",
  tags: ["Sandbox"],
  request: {
    body: {
      content: { "application/json": { schema: SandboxConfigSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SandboxEntrySchema,
        },
      },
      description: "Sandbox created",
    },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const listSandboxesRoute = createRoute({
  method: "get",
  path: "/list",
  tags: ["Sandbox"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ sandboxes: z.record(z.string(), z.any()) }),
        },
      },
      description: "List of sandboxes",
    },
  },
  security: [{ Bearer: [] }],
});

const getSandboxRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Sandbox"],
  request: { params: SandboxIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SandboxEntrySchema,
        },
      },
      description: "Sandbox details",
    },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
  security: [{ Bearer: [] }],
});

const deleteSandboxRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Sandbox"],
  request: {
    params: SandboxIdParamSchema,
    query: z.object({
      preserveStorage: z
        .string()
        .optional()
        .openapi({ param: { name: "preserveStorage", in: "query" }, example: "true", description: "When true, the attached volume is not deleted" }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
      description: "Sandbox stopped",
    },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const sandboxHealthRoute = createRoute({
  method: "get",
  path: "/{id}/health",
  tags: ["Sandbox"],
  request: { params: SandboxIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            healthy: z.boolean(),
            status: z.number().optional(),
            error: z.string().optional(),
          }),
        },
      },
      description: "Sandbox health",
    },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
  security: [{ Bearer: [] }],
});

const inspectSandboxRoute = createRoute({
  method: "get",
  path: "/{id}/inspect",
  tags: ["Sandbox"],
  request: { params: SandboxIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            sandbox: SandboxEntrySchema,
            container: z.any().optional(),
            volume: z.any().optional(),
          }),
        },
      },
      description: "Full sandbox inspection data",
    },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
  security: [{ Bearer: [] }],
});

const tunnelRoute = createRoute({
  method: "post",
  path: "/{id}/tunnel",
  tags: ["Sandbox"],
  request: {
    params: SandboxIdParamSchema,
    body: {
      content: { "application/json": { schema: TunnelRequestSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), alreadyRunning: z.boolean().optional() }),
        },
      },
      description: "Tunnel started",
    },
    400: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Invalid request" },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const execRoute = createRoute({
  method: "post",
  path: "/{id}/exec",
  tags: ["Sandbox"],
  request: {
    params: SandboxIdParamSchema,
    body: {
      content: { "application/json": { schema: ExecRequestSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ExecResponseSchema,
        },
      },
      description: "Command executed",
    },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const execStreamRoute = createRoute({
  method: "post",
  path: "/{id}/exec/stream",
  tags: ["Sandbox"],
  request: {
    params: SandboxIdParamSchema,
    body: {
      content: { "application/json": { schema: ExecRequestSchema } },
    },
  },
  responses: {
    200: { description: "SSE stream of command output" },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
  security: [{ Bearer: [] }],
  hide: true,
});

// Handlers
// @ts-expect-error - OpenAPI schema inference for sandbox response
sandbox.openapi(createSandboxRoute, async (c) => {
  const { cpus, memory, storage, volumeId, env, flags, healthCheck } = c.req.valid("json");
  const sandboxId = crypto.randomUUID().split("-")[0].toLowerCase();
  const containerManager = getContainerManager();
  const existing = containerManager.getSandbox(sandboxId);
  if (existing) {
    return c.json(existing, 200);
  }
  log.sandbox.creating(sandboxId);
  const startTime = Date.now();
  const result = await containerManager.startSandbox(sandboxId, { cpus, memory, storage, volumeId, env, flags, healthCheck });
  if (!result.success) {
    log.sandbox.error(sandboxId, result.error || "unknown error");
    return c.json({ error: result.error }, 500);
  }
  log.sandbox.created(sandboxId, result.data?.ipAddress || "unknown", Date.now() - startTime);
  return c.json(result.data!, 200);
});

sandbox.openapi(listSandboxesRoute, async (c) => {
  const containerManager = getContainerManager();
  return c.json({ sandboxes: containerManager.getAllSandboxes() }, 200);
});

sandbox.openapi(getSandboxRoute, async (c) => {
  const { id } = c.req.valid("param");
  const containerManager = getContainerManager();
  const entry = containerManager.getSandbox(id);
  if (!entry) {
    return c.json({ error: "Sandbox not found" }, 404);
  }
  return c.json(entry, 200);
});

sandbox.openapi(deleteSandboxRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { preserveStorage } = c.req.valid("query");
  const containerManager = getContainerManager();
  const result = await containerManager.stopSandbox(id, { preserveStorage: preserveStorage === "true" });
  if (!result.success) {
    return c.json({ error: result.error || "Unknown error" }, result.error === "Sandbox not found" ? 404 : 500);
  }
  return c.json({ ok: true }, 200);
});

sandbox.openapi(sandboxHealthRoute, async (c) => {
  const { id } = c.req.valid("param");
  const containerManager = getContainerManager();
  const entry = containerManager.getSandbox(id);
  if (!entry) {
    return c.json({ error: "Sandbox not found", healthy: false }, 404);
  }
  try {
    const routePrefix = entry.routePrefix || "/__platform";
    const response = await fetch(`http://${entry.ipAddress}:80${routePrefix}/health`);
    return c.json({ healthy: response.ok, status: response.status }, 200);
  } catch {
    return c.json({ healthy: false, error: "Health check failed" }, 200);
  }
});

sandbox.openapi(inspectSandboxRoute, async (c) => {
  const { id } = c.req.valid("param");
  const containerManager = getContainerManager();
  const entry = containerManager.getSandbox(id);
  if (!entry) {
    return c.json({ error: "Sandbox not found" }, 404);
  }

  // Get container inspect data
  const containerInspectData = await containerManager.inspectContainer(entry.id);

  // Get volume info if volume exists
  let volumeInfo = null;
  if (entry.volume) {
    const { getVolumeService } = await import("../utils/volume.js");
    const volumeService = getVolumeService();
    const volumesResult = await volumeService.list();
    if (volumesResult.success) {
      volumeInfo = volumesResult.data?.find((v) => v.id === entry.volume) || null;
    }
  }

  return c.json(
    {
      sandbox: entry,
      container: containerInspectData || null,
      volume: volumeInfo,
    },
    200,
  );
});

sandbox.openapi(tunnelRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { tunnelToken, tunnelId, url, checkhealth } = c.req.valid("json");
  const containerManager = getContainerManager();
  const tunnelManager = getTunnelManager();
  const containerName = id.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!containerManager.getSandbox(id)) {
    return c.json({ error: "Sandbox not found" }, 404);
  }
  if (tunnelManager.hasTunnel(containerName)) {
    return c.json({ ok: true, alreadyRunning: true }, 200);
  }
  try {
    await tunnelManager.startNamedTunnel(containerName, tunnelToken, tunnelId);
    if (checkhealth && url) {
      await containerManager.waitFor200(url);
    }
    return c.json({ ok: true }, 200);
  } catch (error: any) {
    return c.json({ error: `Failed to start tunnel: ${error.message}` }, 500);
  }
});

sandbox.openapi(execRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { command, args = [], timeout = 30000, user } = c.req.valid("json");
  const containerManager = getContainerManager();
  const entry = containerManager.getSandbox(id);
  if (!entry) {
    return c.json({ error: "Sandbox not found" }, 404);
  }
  const startTime = Date.now();
  const result = await containerManager.execInSandbox(entry.id, command, args, timeout, "/workspace", user);
  const durationMs = Date.now() - startTime;
  const response: ExecResponse = {
    success: result.success,
    command,
    args,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs,
  };
  if (result.error) {
    return c.json({ ...response, error: result.error }, 500);
  }
  return c.json(response, 200);
});

sandbox.openapi(execStreamRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { command, args = [], timeout = 30000, user } = c.req.valid("json");
  const containerManager = getContainerManager();
  const entry = containerManager.getSandbox(id);
  if (!entry) {
    return c.json({ error: "Sandbox not found" }, 404);
  }
  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({ event: "ping", data: JSON.stringify({ timestamp: Date.now() }) });
      const proc = containerManager.execInSandboxStreaming(entry.id, command, args, "/workspace", user);
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
      }, timeout);
      const keepaliveInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: "ping", data: JSON.stringify({ timestamp: Date.now() }) });
        } catch {}
      }, 15_000);
      proc.stdout.on("data", async (data: Buffer) => {
        try {
          await stream.writeSSE({ event: "stdout", data: data.toString("base64") });
        } catch {}
      });
      proc.stderr.on("data", async (data: Buffer) => {
        try {
          await stream.writeSSE({ event: "stderr", data: data.toString("base64") });
        } catch {}
      });
      await new Promise<void>((resolve) => {
        proc.on("close", async (code, signal) => {
          clearTimeout(timer);
          clearInterval(keepaliveInterval);
          try {
            await stream.writeSSE({
              event: "exit",
              data: JSON.stringify({ exitCode: code ?? 0, signal: signal ?? null }),
            });
          } catch {}
          resolve();
        });
        proc.on("error", async (error) => {
          clearTimeout(timer);
          clearInterval(keepaliveInterval);
          try {
            await stream.writeSSE({ event: "error", data: JSON.stringify({ error: error.message }) });
          } catch {}
          resolve();
        });
      });
    } catch (error) {
      try {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: error instanceof Error ? error.message : "Stream execution failed" }),
        });
      } catch {}
    }
  });
});

export default sandbox;
