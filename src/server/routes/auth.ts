import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PairingConfirmRequestSchema, ErrorResponseSchema } from "../../types/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { getTokenManager } from "../utils/tokens.js";

const auth = new OpenAPIHono();

// Routes
const pairingConfirmPostRoute = createRoute({
  method: "post",
  path: "/pairing/confirm",
  tags: ["Auth"],
  request: {
    body: {
      content: { "application/json": { schema: PairingConfirmRequestSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            token: z.string(),
            message: z.string(),
            usage: z.string().optional(),
          }),
        },
      },
      description: "Pairing successful",
    },
    400: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Invalid or expired code" },
  },
});

const authMeRoute = createRoute({
  method: "get",
  path: "/auth/me",
  tags: ["Auth"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            deviceName: z.string(),
            createdAt: z.number(),
            lastUsed: z.number(),
            devMode: z.boolean().optional(),
          }),
        },
      },
      description: "Current auth info",
    },
  },
  security: [{ Bearer: [] }],
});

auth.openapi(pairingConfirmPostRoute, async (c) => {
  const { code, deviceName } = c.req.valid("json");
  const tokenManager = getTokenManager();
  const token = tokenManager.confirmPairing(code, deviceName);
  if (!token) {
    return c.json({ error: "Invalid or expired pairing code" }, 400);
  }
  return c.json({
    token,
    message: "Pairing successful. Use this token for API authentication.",
    usage: "Add header: Authorization: Bearer <token>",
  }, 200);
});

auth.use("/auth/*", authMiddleware());

auth.openapi(authMeRoute, async (c) => {
  const authInfo = c.get("auth");
  if (!authInfo) {
    return c.json({
      deviceName: "dev-mode",
      createdAt: Date.now(),
      lastUsed: Date.now(),
      devMode: true,
    }, 200);
  }
  return c.json({
    deviceName: authInfo.deviceName,
    createdAt: authInfo.createdAt,
    lastUsed: authInfo.lastUsed,
  }, 200);
});

export default auth;
