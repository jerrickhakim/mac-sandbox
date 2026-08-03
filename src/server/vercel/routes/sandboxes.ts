import { Hono } from "hono";
import { getContainerManager } from "../../utils/container.js";
import { sandboxes, sandboxRoutes, commands, generateId } from "../state.js";
import type { VercelSandbox, SandboxRoute } from "../state.js";

const app = new Hono();

// GET / — List sandboxes
app.get("/", async (c) => {
  const project = c.req.query("project");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const since = c.req.query("since") ? Number(c.req.query("since")) : undefined;
  const until = c.req.query("until") ? Number(c.req.query("until")) : undefined;

  const result = sandboxes.list({ projectId: project || undefined, limit, since, until });

  return c.json({
    sandboxes: result.items.map(sandboxes.serialize),
    pagination: {
      count: result.items.length,
      next: result.nextTimestamp,
      prev: null,
    },
  });
});

// POST / — Create sandbox
app.post("/", async (c) => {
  const body = await c.req.json();
  const {
    projectId = "",
    ports = [],
    source,
    timeout = 600000,
    resources = {},
    runtime = "node22",
    networkPolicy = null,
  } = body;

  const id = generateId();
  const containerManager = getContainerManager();
  const now = Date.now();
  const vcpus = resources.vcpus || 2;

  let volumeId: string | undefined;
  if (source?.type === "snapshot" && source.snapshotId) {
    volumeId = source.snapshotId;
  }

  const entry: VercelSandbox = {
    id,
    projectId,
    memory: 4096,
    vcpus,
    region: "local",
    runtime,
    timeout,
    status: "pending",
    requestedAt: now,
    startedAt: null,
    requestedStopAt: null,
    stoppedAt: null,
    abortedAt: null,
    duration: null,
    sourceSnapshotId: source?.type === "snapshot" ? source.snapshotId : null,
    snapshottedAt: null,
    createdAt: now,
    cwd: "/workspace",
    updatedAt: now,
    interactivePort: null,
    networkPolicy,
    _containerName: id,
    _ipAddress: "",
    _hostPort: 0,
    _volume: null,
    _timeoutTimer: null,
  };

  sandboxes.set(id, entry);

  const result = await containerManager.startSandbox(id, {
    cpus: vcpus,
    memory: "4G",
    volumeId,
    storage: volumeId ? undefined : "10G",
    flags: { lan: true },
  });

  if (!result.success || !result.data) {
    entry.status = "failed";
    entry.updatedAt = Date.now();
    sandboxes.set(id, entry);
    return c.json({ error: { code: "internal_error", message: result.error } }, 500);
  }

  entry.status = "running";
  entry.startedAt = Date.now();
  entry._ipAddress = result.data.ipAddress;
  entry._hostPort = result.data.hostPort;
  entry._volume = result.data.volume;
  entry.updatedAt = Date.now();

  // Clone git repo or extract tarball after container starts
  if (source?.type === "git" && source.url) {
    const gitArgs = ["clone"];
    if (source.depth) gitArgs.push("--depth", String(source.depth));
    if (source.revision) gitArgs.push("--branch", source.revision);
    if (source.username && source.password) {
      const authUrl = source.url.replace("://", `://${source.username}:${source.password}@`);
      gitArgs.push(authUrl, ".");
    } else {
      gitArgs.push(source.url, ".");
    }
    await containerManager.execInSandbox(id, "git", gitArgs, 120000);
  } else if (source?.type === "tarball" && source.url) {
    await containerManager.execInSandbox(
      id,
      "sh",
      ["-c", `curl -sL '${source.url}' | tar xz -C /workspace`],
      120000,
    );
  }

  // Auto-stop timer
  if (timeout > 0) {
    entry._timeoutTimer = setTimeout(async () => {
      const current = sandboxes.get(id);
      if (current && current.status === "running") {
        current.status = "stopping";
        current.requestedStopAt = Date.now();
        current.updatedAt = Date.now();
        await containerManager.stopSandbox(id);
        current.status = "stopped";
        current.stoppedAt = Date.now();
        current.duration = current.stoppedAt - (current.startedAt || current.createdAt);
        current.updatedAt = Date.now();
      }
    }, timeout);
  }

  sandboxes.set(id, entry);

  const routes: SandboxRoute[] = [];
  if (entry._hostPort) {
    const activePorts = ports.length > 0 ? ports : [80];
    for (const port of activePorts) {
      routes.push({
        url: `http://127.0.0.1:${entry._hostPort}`,
        subdomain: id,
        port,
      });
    }
  }
  sandboxRoutes.set(id, routes);

  return c.json(
    {
      sandbox: sandboxes.serialize(entry),
      routes,
    },
    201,
  );
});

// GET /:sandboxId — Get sandbox
app.get("/:sandboxId", async (c) => {
  const { sandboxId } = c.req.param();
  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }

  return c.json({
    sandbox: sandboxes.serialize(entry),
    routes: sandboxRoutes.get(sandboxId),
  });
});

// POST /:sandboxId/stop — Stop sandbox
app.post("/:sandboxId/stop", async (c) => {
  const { sandboxId } = c.req.param();
  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }

  if (entry._timeoutTimer) {
    clearTimeout(entry._timeoutTimer);
    entry._timeoutTimer = null;
  }

  // Kill all running commands for this sandbox
  for (const cmd of commands.forSandbox(sandboxId)) {
    if (cmd._process) {
      cmd._process.kill("SIGKILL");
    }
  }

  entry.status = "stopping";
  entry.requestedStopAt = Date.now();
  entry.updatedAt = Date.now();
  sandboxes.set(sandboxId, entry);

  const containerManager = getContainerManager();
  await containerManager.stopSandbox(sandboxId);

  entry.status = "stopped";
  entry.stoppedAt = Date.now();
  entry.duration = entry.stoppedAt - (entry.startedAt || entry.createdAt);
  entry.updatedAt = Date.now();
  sandboxes.set(sandboxId, entry);

  return c.json({ sandbox: sandboxes.serialize(entry) });
});

// POST /:sandboxId/extend-timeout — Extend timeout
app.post("/:sandboxId/extend-timeout", async (c) => {
  const { sandboxId } = c.req.param();
  const body = await c.req.json();
  const { duration = 60000 } = body;

  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }

  if (entry.status !== "running") {
    return c.json({ error: { code: "bad_request", message: "Sandbox is not running" } }, 400);
  }

  if (entry._timeoutTimer) {
    clearTimeout(entry._timeoutTimer);
  }

  entry.timeout += duration;
  entry.updatedAt = Date.now();

  const containerManager = getContainerManager();
  entry._timeoutTimer = setTimeout(async () => {
    const current = sandboxes.get(sandboxId);
    if (current && current.status === "running") {
      current.status = "stopping";
      current.requestedStopAt = Date.now();
      current.updatedAt = Date.now();
      await containerManager.stopSandbox(sandboxId);
      current.status = "stopped";
      current.stoppedAt = Date.now();
      current.duration = current.stoppedAt - (current.startedAt || current.createdAt);
      current.updatedAt = Date.now();
    }
  }, duration);

  sandboxes.set(sandboxId, entry);

  return c.json({ sandbox: sandboxes.serialize(entry) });
});

// POST /:sandboxId/network-policy — Update network policy
app.post("/:sandboxId/network-policy", async (c) => {
  const { sandboxId } = c.req.param();
  const policy = await c.req.json();

  const entry = sandboxes.get(sandboxId);
  if (!entry) {
    return c.json({ error: { code: "not_found", message: "Sandbox not found" } }, 404);
  }

  entry.networkPolicy = policy;
  entry.updatedAt = Date.now();
  sandboxes.set(sandboxId, entry);

  return c.json({ sandbox: sandboxes.serialize(entry) });
});

export default app;
