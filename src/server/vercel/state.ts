import crypto from "crypto";
import type { ChildProcess } from "child_process";

// --- Types ---

export type SandboxStatus =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "aborted"
  | "snapshotting";

export interface NetworkPolicy {
  mode: "allow-all" | "deny-all" | "custom";
  allowedDomains?: string[];
  allowedCIDRs?: string[];
  deniedCIDRs?: string[];
  injectionRules?: Array<{
    domain: string;
    headers?: Record<string, string>;
    headerNames?: string[];
  }>;
}

export interface VercelSandbox {
  id: string;
  projectId: string;
  memory: number;
  vcpus: number;
  region: string;
  runtime: string;
  timeout: number;
  status: SandboxStatus;
  requestedAt: number;
  startedAt: number | null;
  requestedStopAt: number | null;
  stoppedAt: number | null;
  abortedAt: number | null;
  duration: number | null;
  sourceSnapshotId: string | null;
  snapshottedAt: number | null;
  createdAt: number;
  cwd: string;
  updatedAt: number;
  interactivePort: number | null;
  networkPolicy: NetworkPolicy | null;

  // Internal fields (prefixed with _ to indicate they're not serialized)
  _containerName: string;
  _ipAddress: string;
  _hostPort: number;
  _volume: string | null;
  _timeoutTimer: ReturnType<typeof setTimeout> | null;
}

export interface SandboxRoute {
  url: string;
  subdomain: string;
  port: number;
}

export interface TrackedCommand {
  id: string;
  name: string;
  args: string[];
  cwd: string;
  sandboxId: string;
  exitCode: number | null;
  startedAt: number;
  _process: ChildProcess | null;
  _stdout: Buffer[];
  _stderr: Buffer[];
}

export interface Snapshot {
  id: string;
  sourceSandboxId: string;
  region: string;
  status: "created" | "deleted" | "failed";
  sizeBytes: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// --- In-memory stores ---

const sandboxStore = new Map<string, VercelSandbox>();
const routeStore = new Map<string, SandboxRoute[]>();
const commandStore = new Map<string, TrackedCommand>();
const snapshotStore = new Map<string, Snapshot>();

// --- Sandbox operations ---

export const sandboxes = {
  set(id: string, s: VercelSandbox) {
    sandboxStore.set(id, s);
  },
  get(id: string) {
    return sandboxStore.get(id);
  },
  delete(id: string) {
    sandboxStore.delete(id);
  },
  list(opts?: { projectId?: string; since?: number; until?: number; limit?: number }) {
    let results = Array.from(sandboxStore.values());
    if (opts?.projectId) results = results.filter((s) => s.projectId === opts.projectId);
    if (opts?.since) results = results.filter((s) => s.createdAt > opts.since!);
    if (opts?.until) results = results.filter((s) => s.createdAt < opts.until!);
    results.sort((a, b) => b.createdAt - a.createdAt);
    const limit = opts?.limit || 20;
    return {
      items: results.slice(0, limit),
      total: results.length,
      nextTimestamp: results.length > limit ? results[limit].createdAt : null,
    };
  },
  serialize(s: VercelSandbox) {
    return {
      id: s.id,
      memory: s.memory,
      vcpus: s.vcpus,
      region: s.region,
      runtime: s.runtime,
      timeout: s.timeout,
      status: s.status,
      requestedAt: s.requestedAt,
      startedAt: s.startedAt,
      requestedStopAt: s.requestedStopAt,
      stoppedAt: s.stoppedAt,
      abortedAt: s.abortedAt,
      duration: s.duration,
      sourceSnapshotId: s.sourceSnapshotId,
      snapshottedAt: s.snapshottedAt,
      createdAt: s.createdAt,
      cwd: s.cwd,
      updatedAt: s.updatedAt,
      interactivePort: s.interactivePort,
      networkPolicy: s.networkPolicy,
    };
  },
};

// --- Route operations ---

export const sandboxRoutes = {
  set(id: string, r: SandboxRoute[]) {
    routeStore.set(id, r);
  },
  get(id: string): SandboxRoute[] {
    return routeStore.get(id) || [];
  },
  delete(id: string) {
    routeStore.delete(id);
  },
};

// --- Command operations ---

export const commands = {
  set(id: string, c: TrackedCommand) {
    commandStore.set(id, c);
  },
  get(id: string) {
    return commandStore.get(id);
  },
  delete(id: string) {
    commandStore.delete(id);
  },
  forSandbox(sandboxId: string) {
    return Array.from(commandStore.values()).filter((c) => c.sandboxId === sandboxId);
  },
  serialize(c: TrackedCommand) {
    return {
      id: c.id,
      name: c.name,
      args: c.args,
      cwd: c.cwd,
      sandboxId: c.sandboxId,
      exitCode: c.exitCode,
      startedAt: c.startedAt,
    };
  },
};

// --- Snapshot operations ---

export const snapshots = {
  set(id: string, s: Snapshot) {
    snapshotStore.set(id, s);
  },
  get(id: string) {
    return snapshotStore.get(id);
  },
  delete(id: string) {
    snapshotStore.delete(id);
  },
  list(opts?: { since?: number; until?: number; limit?: number }) {
    let results = Array.from(snapshotStore.values());
    if (opts?.since) results = results.filter((s) => s.createdAt > opts.since!);
    if (opts?.until) results = results.filter((s) => s.createdAt < opts.until!);
    results.sort((a, b) => b.createdAt - a.createdAt);
    const limit = opts?.limit || 20;
    return {
      items: results.slice(0, limit),
      total: results.length,
      nextTimestamp: results.length > limit ? results[limit].createdAt : null,
    };
  },
};

// --- Utilities ---

export function generateId(): string {
  return crypto.randomBytes(8).toString("hex");
}
