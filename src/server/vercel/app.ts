import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger, rateLimit, authMiddleware } from "../middleware/auth.js";
import sandboxRoutes from "./routes/sandboxes.js";
import commandRoutes from "./routes/commands.js";
import filesystemRoutes from "./routes/filesystem.js";
import snapshotCrudRoutes, { createSnapshotHandler } from "./routes/snapshots.js";

/**
 * Creates a Hono app that implements the Vercel Sandbox API surface
 * backed by Apple Containers.
 *
 * Mount this on an existing server or run it standalone.
 */
export function createVercelSandboxApi() {
  const app = new Hono();

  // Middleware
  app.use("*", cors());
  app.use("*", logger());
  app.use("*", rateLimit(100, 60000));
  app.use("*", authMiddleware());

  // Health
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      api: "vercel-compatible",
    }),
  );

  // --- Snapshot CRUD (must be registered before :sandboxId params) ---
  app.route("/v1/sandboxes/snapshots", snapshotCrudRoutes);

  // --- Sandbox CRUD ---
  app.route("/v1/sandboxes", sandboxRoutes);

  // --- Create snapshot (on a specific sandbox) ---
  app.post("/v1/sandboxes/:sandboxId/snapshot", createSnapshotHandler);

  // --- Command routes ---
  app.route("/v1/sandboxes", commandRoutes);

  // --- Filesystem routes ---
  app.route("/v1/sandboxes", filesystemRoutes);

  return app;
}

export default createVercelSandboxApi;
