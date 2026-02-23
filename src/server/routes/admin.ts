import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authMiddleware } from "../middleware/auth.js";
import { getContainerManager } from "../utils/container.js";
import { getHostInfo } from "../utils/hostInfo.js";
import { getTunnelManager } from "../utils/tunnelManager.js";
import { ErrorResponseSchema } from "../../types/index.js";

const admin = new OpenAPIHono();
admin.use("*", authMiddleware());

const sandboxesRoute = createRoute({
  method: "get",
  path: "/sandboxes",
  tags: ["Admin"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ sandboxes: z.record(z.string(), z.any()) }),
        },
      },
      description: "All sandboxes",
    },
  },
  security: [{ Bearer: [] }],
});

const containersRoute = createRoute({
  method: "get",
  path: "/containers",
  tags: ["Admin"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.any(),
        },
      },
      description: "All containers",
    },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const killAllRoute = createRoute({
  method: "post",
  path: "/kill-all",
  tags: ["Admin"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
      description: "All sandboxes killed",
    },
  },
  security: [{ Bearer: [] }],
});

const statsRoute = createRoute({
  method: "get",
  path: "/stats",
  tags: ["Admin"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            totalSandboxes: z.number(),
            activeTunnels: z.number(),
            uptime: z.number(),
            memoryUsage: z.any(),
          }),
        },
      },
      description: "Server stats",
    },
  },
  security: [{ Bearer: [] }],
});

const disconnectRoute = createRoute({
  method: "post",
  path: "/disconnect",
  tags: ["Admin"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
      description: "Server shutting down",
    },
  },
  security: [{ Bearer: [] }],
});

admin.openapi(sandboxesRoute, async (c) => {
  const containerManager = getContainerManager();
  return c.json({ sandboxes: containerManager.getAllSandboxes() }, 200);
});

admin.openapi(containersRoute, async (c) => {
  const containerManager = getContainerManager();
  const result = await containerManager.listContainers();
  if (!result.success) {
    return c.json({ error: result.error || "Unknown error" }, 500);
  }
  return c.json(result.data, 200);
});

admin.openapi(killAllRoute, async (c) => {
  const containerManager = getContainerManager();
  const tunnelManager = getTunnelManager();
  await containerManager.killAll();
  tunnelManager.stopAll();
  return c.json({ ok: true }, 200);
});

admin.openapi(statsRoute, async (c) => {
  const containerManager = getContainerManager();
  const tunnelManager = getTunnelManager();
  const sandboxes = containerManager.getAllSandboxes();
  return c.json({
    totalSandboxes: Object.keys(sandboxes).length,
    activeTunnels: tunnelManager.count(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  }, 200);
});

admin.openapi(disconnectRoute, async (c) => {
  const containerManager = getContainerManager();
  const tunnelManager = getTunnelManager();
  const hostInfo = getHostInfo();
  console.log("\n👋 Disconnect endpoint called - shutting down gracefully...");
  const response = c.json({ ok: true }, 200);
  setImmediate(async () => {
    try {
      console.log("🛑 Stopping all sandbox containers...");
      await containerManager.killAll();
      console.log("🛑 Stopping all sandbox tunnels...");
      tunnelManager.stopAll();
      console.log("🛑 Stopping host tunnel...");
      hostInfo.stopHostTunnel();
      console.log("✅ Cleanup complete. Exiting...");
      setTimeout(() => process.exit(0), 500);
    } catch (error: any) {
      console.error("❌ Error during cleanup:", error.message);
      process.exit(1);
    }
  });
  return response;
});

export default admin;
