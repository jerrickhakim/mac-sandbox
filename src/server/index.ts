import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { Scalar } from "@scalar/hono-api-reference";

import type { ServerConfig } from "../types/index.js";
import { logger, rateLimit } from "./middleware/auth.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import sandboxRoutes from "./routes/sandbox.js";
import volumeRoutes from "./routes/volume.js";
import { createVercelSandboxApi } from "./vercel/app.js";
import { getContainerManager } from "./utils/container.js";
import { getHostInfo } from "./utils/hostInfo.js";
import log from "./utils/logger.js";
import { getTokenManager } from "./utils/tokens.js";
import { getTunnelManager } from "./utils/tunnelManager.js";

// These are additional ports opened on the host machine and forwarded to the sandbox container when LAN mode is enabled.
// <port> : <localip>
export const PORT_MAP = new Map<string, string>();

export function createServer(config: ServerConfig = {}) {
  const app = new OpenAPIHono();
  const sandboxImage = config.sandboxImage?.trim() || undefined;

  // Initialize managers with config
  getTokenManager(config.tokenSecret, config.dataDir);
  getContainerManager({
    sandboxImage,
  });

  // Global middleware
  app.use("*", cors());
  app.use("*", logger());
  app.use("*", rateLimit(100, 60000)); // 100 requests per minute

  // Health check (public)
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
    });
  });

  // Register Bearer auth for OpenAPI
  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Bearer token. Get via /pairing/confirm",
  });

  // Mount original routes
  app.route("/", authRoutes);
  app.route("/sandbox", sandboxRoutes);
  app.route("/volume", volumeRoutes);
  app.route("/admin", adminRoutes);

  // Mount Vercel-compatible API (v1)
  const vercelApi = createVercelSandboxApi();
  app.route("/", vercelApi);

  // OpenAPI documentation
  app.doc("/doc", {
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "Mac Sandbox API",
      description: "API for creating and managing sandboxes on Mac using Apple Containers and Cloudflare Tunnels",
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Local development server",
      },
    ],
    tags: [
      { name: "Auth", description: "Authentication and pairing endpoints" },
      { name: "Sandbox", description: "Sandbox container management" },
      { name: "Volume", description: "Volume management" },
      { name: "Admin", description: "Administrative operations" },
    ],
  });

  // Scalar API Reference
  app.get(
    "/",
    Scalar({
      url: "/doc",
      pageTitle: "Mac Sandbox API Reference",
    }),
  );

  /**
   * Reverse proxy HTTP by subdomain (catch-all route)
   * This must be last to catch all unmatched routes
   * Only proxies requests with a valid subdomain mapping
   * if you wish modify this code here is how you can proxy subdomains to sandboxes and store the look up on a map
   */
  // app.all("*", async (c) => {
  //   const host = c.req.header("host") || "";

  //   // Extract subdomain from host header
  //   // Handles formats like: "subdomain.example.com", "subdomain:4000", "subdomain"
  //   const hostParts = host.split(":");
  //   const hostname = hostParts[0];
  //   const parts = hostname.split(".");

  //   // Get subdomain (first part before the first dot)
  //   // Skip if it's localhost, 127.0.0.1, or an IP address
  //   const subdomain = parts[0];
  //   if (!subdomain || subdomain === "localhost" || subdomain === "127" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || subdomain === hostname) {
  //     // Not a subdomain request, return 404
  //     return c.text("Not found", 404);
  //   }

  //   const entry = routing.get(subdomain);
  //   if (!entry) {
  //     return c.text("Subdomain not found", 404);
  //   }

  //   const targetUrl = `http://127.0.0.1:${entry.hostPort}`;
  //   const url = new URL(c.req.url);
  //   const proxyUrl = `${targetUrl}${url.pathname}${url.search}`;

  //   try {
  //     // Forward the request to the container
  //     const headers: Record<string, string> = {};
  //     c.req.raw.headers.forEach((value, key) => {
  //       if (key.toLowerCase() !== "host") {
  //         headers[key] = value;
  //       }
  //     });

  //     const response = await fetch(proxyUrl, {
  //       method: c.req.method,
  //       headers: headers,
  //       body: c.req.method !== "GET" && c.req.method !== "HEAD" ? await c.req.raw.clone().arrayBuffer() : undefined,
  //     });

  //     // Forward the response back to the client
  //     const responseHeaders: Record<string, string> = {};
  //     response.headers.forEach((value, key) => {
  //       responseHeaders[key] = value;
  //     });

  //     return new Response(response.body, {
  //       status: response.status,
  //       statusText: response.statusText,
  //       headers: responseHeaders,
  //     });
  //   } catch (error: any) {
  //     return c.json({ error: "Proxy error", details: error.message }, 502);
  //   }
  // });

  return app;
}

export function startServer(config: ServerConfig = {}): {
  server: ReturnType<typeof serve>;
  pairingCode: string;
} {
  const PORT = config.port || Number(process.env.PORT) || 4000;
  const app = createServer(config);

  // Create initial pairing code
  const tokenManager = getTokenManager();
  const pairingRequest = tokenManager.createPairingRequest();

  const server = serve(
    {
      fetch: app.fetch,
      port: PORT,
    },
    (info) => {
      log.server.ready(`http://127.0.0.1:${info.port}`);
      log.pairing.waiting(pairingRequest.code);
      log.step(`Expires in ${Math.floor((pairingRequest.expiresAt - Date.now()) / 1000)}s`);
    },
  );

  // Graceful shutdown
  let isShuttingDown = false;
  const cleanup = () => {
    if (isShuttingDown) {
      return; // Prevent multiple cleanup calls
    }
    isShuttingDown = true;

    console.log(); // New line after ^C
    log.server.shutdown();

    // Close the server first to stop accepting new connections
    server.close(() => {
      // Server closed, now run async cleanup
      const tunnelManager = getTunnelManager();
      const containerManager = getContainerManager();
      const hostInfo = getHostInfo();

      // Set a hard timeout to ensure we exit
      const exitTimeout = setTimeout(() => {
        log.warn("Cleanup timeout, forcing exit...");
        process.exit(0);
      }, 25000); // 25s hard timeout

      // Run async cleanup
      (async () => {
        try {
          // Destroy containers if set in env
          if (process.env?.FLAGS_DESTROY_CONTAINERS === "true") {
            // Stop all containers created via API (this also stops their tunnels)
            const sandboxes = containerManager.getAllSandboxes();
            if (Object.keys(sandboxes).length > 0) {
              log.step(`Stopping ${Object.keys(sandboxes).length} container(s)...`);
              // Wait for container cleanup with timeout
              await Promise.race([
                containerManager.killAll(),
                new Promise((resolve) => setTimeout(resolve, 20000)), // 20s timeout
              ]);
            }
          }

          // Stop all sandbox tunnels by default unless set in env
          if (process.env?.FLAGS_PRESERVE_SANDBOX_TUNNELS === "true") {
            log.step(`Stopping all sandbox tunnels...`);
            tunnelManager.stopAll();
          }

          // Stop host tunnel
          hostInfo.stopHostTunnel();

          // Give tunnels a moment to clean up
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error: any) {
          log.warn(`Cleanup error: ${error.message}`);
        } finally {
          clearTimeout(exitTimeout);
          process.exit(0);
        }
      })();
    });
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  return { server, pairingCode: pairingRequest.code };
}

// Export utilities for external use
export { authMiddleware } from "./middleware/auth.js";
export { getContainerManager } from "./utils/container.js";
export { getHostInfo } from "./utils/hostInfo.js";
export { getTokenManager } from "./utils/tokens.js";
export { isCloudflaredInstalled, startTunnel } from "./utils/tunnel.js";
export { getTunnelManager } from "./utils/tunnelManager.js";
export { getNextPort, releasePort, routing } from "./utils/portAllocation.js";
