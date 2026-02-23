import type { Context, Next } from "hono";
import type { AuthToken } from "../../types/index.js";
import log from "../utils/logger.js";
import { getTokenManager } from "../utils/tokens.js";

// Extend Hono's context to include auth info
declare module "hono" {
  interface ContextVariableMap {
    auth: AuthToken;
  }
}

/**
 * Check if we're running in development mode
 * Checks multiple indicators to be robust against different ways of starting the server
 */
function isDevelopmentMode(): boolean {
  // Check NODE_ENV environment variable (most common and reliable)
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "development") {
    return true;
  }

  // Check if running via tsx watch (common dev command: "tsx watch src/cli/index.ts start")
  if (process.argv.some((arg) => arg.includes("tsx") || arg.includes("watch"))) {
    return true;
  }

  return false;
}

/**
 * Authentication middleware that validates Bearer tokens
 * If you have a valid token, you have full access
 * In development mode, auth is bypassed automatically
 */

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");

    // Bypass auth in development mode
    if (isDevelopmentMode()) {
      return next();
    }

    if (!authHeader) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const [type, token] = authHeader.split(" ");

    if (type !== "Bearer" || !token) {
      return c.json({ error: "Invalid Authorization header format. Use: Bearer <token>" }, 401);
    }

    const tokenManager = getTokenManager();
    const authToken = tokenManager.validateToken(token);

    if (!authToken) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    // Set auth info in context for use in routes
    c.set("auth", authToken);

    return next();
  };
}

/**
 * Rate limiting middleware (simple in-memory implementation)
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const now = Date.now();

    let entry = rateLimitMap.get(ip);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      rateLimitMap.set(ip, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json({ error: "Too many requests" }, 429);
    }

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(maxRequests - entry.count));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    return next();
  };
}

/**
 * Logging middleware
 */
export function logger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    log.request(method, path, status, duration);
  };
}
