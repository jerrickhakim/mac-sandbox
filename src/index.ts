/**
 * Mac Sandbox - Create sandboxes on your Mac
 *
 * @packageDocumentation
 */

import { spawnSync } from "child_process";

// Export server
export { createServer, getContainerManager, getTokenManager, startServer } from "./server/index.js";

// Export types
export type {
  AuthToken,
  ClientConfig,
  ExecRequest,
  ExecResponse,
  PairingConfirmRequest,
  PairingConfirmResponse,
  PairingRequest,
  SandboxConfig,
  SandboxEntry,
  SandboxResponse,
  ServerConfig,
} from "./types/index.js";

// Export middleware for custom server setups
export { authMiddleware } from "./server/middleware/auth.js";
