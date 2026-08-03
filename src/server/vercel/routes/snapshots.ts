import { Hono } from "hono";
import { getContainerManager } from "../../utils/container.js";
import { getVolumeService } from "../../utils/volume.js";
import { sandboxes, snapshots, generateId } from "../state.js";
import type { Snapshot } from "../state.js";

const app = new Hono();

// ---------------------------------------------------------------------------
// Snapshot CRUD — mounted at /v1/sandboxes/snapshots
// ---------------------------------------------------------------------------

// GET / — List snapshots
app.get("/", async (c) => {
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const since = c.req.query("since") ? Number(c.req.query("since")) : undefined;
  const until = c.req.query("until") ? Number(c.req.query("until")) : undefined;

  const result = snapshots.list({ limit, since, until });

  return c.json({
    snapshots: result.items,
    pagination: {
      count: result.items.length,
      next: result.nextTimestamp,
      prev: null,
    },
  });
});

// GET /:snapshotId — Get snapshot
app.get("/:snapshotId", async (c) => {
  const { snapshotId } = c.req.param();
  const snap = snapshots.get(snapshotId);
  if (!snap) {
    return c.json({ error: { code: "not_found", message: "Snapshot not found" } }, 404);
  }
  return c.json({ snapshot: snap });
});

// DELETE /:snapshotId — Delete snapshot
app.delete("/:snapshotId", async (c) => {
  const { snapshotId } = c.req.param();
  const snap = snapshots.get(snapshotId);
  if (!snap) {
    return c.json({ error: { code: "not_found", message: "Snapshot not found" } }, 404);
  }

  // Delete the backing volume
  const volumeService = getVolumeService();
  try {
    await volumeService.delete(snapshotId);
  } catch {
    // Volume may already be gone
  }

  snap.status = "deleted";
  snap.updatedAt = Date.now();
  snapshots.set(snapshotId, snap);

  return c.json({ snapshot: snap });
});

export default app;

// ---------------------------------------------------------------------------
// Create snapshot — exported separately, mounted at /:sandboxId/snapshot
// ---------------------------------------------------------------------------

export async function createSnapshotHandler(c: any) {
  const { sandboxId } = c.req.param();
  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const { expiration } = body as { expiration?: number };

  const snapshotId = generateId();
  const now = Date.now();

  // Transition sandbox to snapshotting status
  entry.status = "snapshotting";
  entry.updatedAt = now;
  sandboxes.set(sandboxId, entry);

  // Create a volume as the snapshot backing store
  const volumeService = getVolumeService();
  const volumeResult = await volumeService.create({
    id: snapshotId,
    label: `snapshot:${sandboxId}`,
  });

  if (!volumeResult.success) {
    entry.status = "running";
    entry.updatedAt = Date.now();
    sandboxes.set(sandboxId, entry);
    return c.json({ error: { code: "internal_error", message: volumeResult.error } }, 500);
  }

  // Copy workspace contents into the snapshot volume
  const containerManager = getContainerManager();
  const copyResult = await containerManager.execInSandbox(
    entry._containerName,
    "sh",
    ["-c", `cp -a /workspace/. /mnt/snapshot/ 2>/dev/null || true`],
    60000,
  );

  const snap: Snapshot = {
    id: snapshotId,
    sourceSandboxId: sandboxId,
    region: "local",
    status: copyResult.success ? "created" : "failed",
    sizeBytes: 0,
    expiresAt: expiration || null,
    createdAt: now,
    updatedAt: Date.now(),
  };

  snapshots.set(snapshotId, snap);

  entry.status = "running";
  entry.snapshottedAt = now;
  entry.updatedAt = Date.now();
  sandboxes.set(sandboxId, entry);

  return c.json({
    snapshot: snap,
    sandbox: sandboxes.serialize(entry),
  });
}
