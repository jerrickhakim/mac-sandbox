import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  VolumeCreateOptionsSchema,
  VolumeDeleteBatchSchema,
  VolumeInfoSchema,
  ErrorResponseSchema,
} from "../../types/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { getVolumeService } from "../utils/volume.js";
import log from "../utils/logger.js";

const volume = new OpenAPIHono();
volume.use("*", authMiddleware());

// Param schemas
const VolumeIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "vol_abc123" }),
});

// Routes
const createVolumeRoute = createRoute({
  method: "post",
  path: "/create",
  tags: ["Volume"],
  request: {
    body: {
      content: { "application/json": { schema: VolumeCreateOptionsSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: VolumeInfoSchema,
        },
      },
      description: "Volume created. Note: Volume ID is auto-generated if not provided (similar to containers)",
    },
    400: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const listVolumesRoute = createRoute({
  method: "get",
  path: "/list",
  tags: ["Volume"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(VolumeInfoSchema),
        },
      },
      description: "List of volumes",
    },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const getVolumeRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Volume"],
  request: { params: VolumeIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: VolumeInfoSchema,
        },
      },
      description: "Volume details",
    },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const deleteVolumeRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Volume"],
  request: { params: VolumeIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
      description: "Volume deleted",
    },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

const batchDeleteVolumeRoute = createRoute({
  method: "post",
  path: "/batch-delete",
  tags: ["Volume"],
  request: {
    body: {
      content: { "application/json": { schema: VolumeDeleteBatchSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            deleted: z.array(z.string()),
          }),
        },
      },
      description: "Volumes deleted",
    },
    400: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Server error" },
  },
  security: [{ Bearer: [] }],
});

// Route handlers
// NOTE: Volume IDs are auto-generated when created (similar to containers)
volume.openapi(createVolumeRoute, async (c) => {
  const { id, size, label } = c.req.valid("json");
  const volumeService = getVolumeService();
  log.step(`Creating volume: ${id} ${size ? `(${size})` : ""}`);
  const result = await volumeService.create({ id, size, label });
  if (!result.success) {
    return c.json({ error: result.error || "Unknown error" }, 500);
  }
  return c.json(result.data, 200);
});

volume.openapi(listVolumesRoute, async (c) => {
  const volumeService = getVolumeService();
  const result = await volumeService.list();
  if (!result.success) {
    return c.json({ error: result.error || "Unknown error" }, 500);
  }
  return c.json(result.data || [], 200);
});

volume.openapi(getVolumeRoute, async (c) => {
  const { id } = c.req.valid("param");
  const volumeService = getVolumeService();
  const result = await volumeService.list();
  if (!result.success) {
    return c.json({ error: result.error || "Unknown error" }, 500);
  }
  const volumeData = result.data?.find((v) => v.id === id);
  if (!volumeData) {
    return c.json({ error: "Volume not found" }, 404);
  }
  return c.json(volumeData, 200);
});

volume.openapi(deleteVolumeRoute, async (c) => {
  const { id } = c.req.valid("param");
  const volumeService = getVolumeService();
  log.step(`Deleting volume: ${id}`);
  const result = await volumeService.delete(id);
  if (!result.success) {
    return c.json({ error: result.error || "Unknown error" }, 500);
  }
  return c.json({ ok: true }, 200);
});

volume.openapi(batchDeleteVolumeRoute, async (c) => {
  const { ids } = c.req.valid("json");
  const volumeService = getVolumeService();
  log.step(`Deleting ${ids.length} volume(s)...`);
  const result = await volumeService.deleteMultiple(ids);
  if (!result.success) {
    return c.json({ error: result.error || "Unknown error" }, 500);
  }
  return c.json({ ok: true, deleted: ids }, 200);
});

export default volume;
