import { spawn } from "child_process";
import os from "os";
import type { SandboxConfig, SandboxEntry } from "../../types/index.js";
import log from "./logger.js";
import { startTunnel } from "./tunnel.js";
import { getTunnelManager } from "./tunnelManager.js";
import { getNextPort, releasePort, routing } from "./portAllocation.js";
import { getVolumeService } from "./volume.js";
import { PersistentMap } from "../../dev/Map.js";

const CONTAINER_CLI = "container";
const FALLBACK_SANDBOX_IMAGE = "sandbox";

function resolveSandboxImageName(configImage?: string): string {
  const normalizedConfigImage = configImage?.trim();
  if (normalizedConfigImage) {
    return normalizedConfigImage;
  }

  const normalizedEnvImage = process.env.SANDBOX_IMAGE?.trim();
  if (normalizedEnvImage) {
    return normalizedEnvImage;
  }

  return FALLBACK_SANDBOX_IMAGE;
}

const getHostNetworkAddress = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address; // e.g. "192.168.1.102"
      }
    }
  }
  return "0.0.0.0";
};

export interface ContainerManagerConfig {
  sandboxImage?: string;
}

export class ContainerManager {
  private sandboxImage: string;
  private sandboxes: PersistentMap<string, SandboxEntry>;

  constructor(config: ContainerManagerConfig = {}) {
    this.sandboxImage = resolveSandboxImageName(config.sandboxImage);
    this.sandboxes = new PersistentMap({ filename: "sandboxes" });
  }

  /**
   * Start a new sandbox container
   */
  async startSandbox(id: string, config: SandboxConfig): Promise<{ success: boolean; data?: SandboxEntry; error?: string }> {
    const containerName = id.toLowerCase().replace(/[^a-z0-9-]/g, "");

    const existing = this.sandboxes.get(containerName);
    if (existing) {
      return { success: true, data: existing };
    }

    const hostNetworkAddress = getHostNetworkAddress();
    // console.log("hostNetworkAddress", hostNetworkAddress);

    // Resolve which volume to mount at /workspace
    let volumeIdToMount: string | null = null;
    if (config.volumeId) {
      // Use the caller-supplied volume directly
      volumeIdToMount = config.volumeId;
    } else if (config.storage) {
      // Create a new volume sized to config.storage
      const volumeService = getVolumeService();
      const result = await volumeService.create({ id: containerName, size: config.storage });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      volumeIdToMount = containerName;
    }

    const hostPort = await getNextPort();

    // const hostAddress = `0.0.0.0`;
    const hostAddress = `127.0.0.1`;

    const args = [
      //
      "run",
      "-d",
      "--name",
      containerName,
      "--cpus",
      String(config.cpus || 2),
      "--memory",
      config.memory || "4G",
    ];

    if (config.flags?.lan) {
      args.push("-p", `${hostAddress}:${hostPort}:80`);
    }

    if (volumeIdToMount) {
      args.push("--volume", `${volumeIdToMount}:/workspace`);
    }

    // sudo container system dns create sandbox
    // container system property set dns.domain sandbox

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        if (value !== undefined && value !== null) {
          args.push("-e", `${key}=${value}`);
        }
      }
    }

    args.push(this.sandboxImage);

    log.step(`Starting container ${containerName}...`);
    const { ok, err, timedOut } = await this.runCommand(args, 120000); // 2 minute timeout
    if (timedOut) {
      releasePort(hostPort);
      return { success: false, error: "Container startup timed out" };
    }
    if (!ok) {
      releasePort(hostPort);
      return { success: false, error: `Failed to start container: ${err}` };
    }

    // Get container info with retries (network may not be ready immediately)
    log.step(`Getting container info for ${containerName}...`);
    let ipAddress: string | undefined;
    let inspectData: Record<string, any> | undefined;

    // Retry up to 5 times with increasing delays
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt)); // 500ms, 1s, 1.5s, 2s delays
      }

      inspectData = await this.inspectContainer(containerName);
      if (!inspectData) {
        continue;
      }

      ipAddress = this.extractIpFromInspect(inspectData);
      if (ipAddress) {
        break;
      }

      // Log the inspect data structure for debugging if we're on the last attempt
      if (attempt === 4) {
        log.verbose(`Inspect data structure: ${JSON.stringify(inspectData, null, 2)}`);
      }
    }

    if (!ipAddress) {
      await this.forceDeleteContainer(containerName);
      releasePort(hostPort);
      return { success: false, error: "Failed to get container IP address" };
    }

    // Option to create a cloudflare tunnel

    let tunnelUrl: string | null = null;
    let healthCheckUrl: string | null = null;

    if (config.flags?.tunnel) {
      const tunnel = await startTunnel(80, ipAddress);

      tunnelUrl = tunnel.url;
      healthCheckUrl = tunnelUrl;

      // Register tunnel process with TunnelManager for cleanup
      const tunnelManager = getTunnelManager();
      tunnelManager.registerTunnel(containerName, tunnel.process);
    }

    if (config.healthCheck) {
      // sleep for 2s dont make a request, making a request right away might crash the container
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const hc = config.healthCheck;
      let checkUrl: string;
      switch (hc.url) {
        case "tunnel":
          checkUrl = tunnelUrl || `http://${ipAddress}`;
          break;
        case "lan":
          checkUrl = `http://${hostNetworkAddress}:${hostPort}`;
          break;
        case "container":
        default:
          checkUrl = `http://${ipAddress}`;
          break;
      }

      try {
        await this.waitFor200(checkUrl, hc.maxAttempts ?? 60, hc.interval ?? 1000);
      } catch (error: any) {
        if (hc.destroy) {
          await this.forceDeleteContainer(containerName);
          releasePort(hostPort);
          return { success: false, error: `Health check failed: ${error.message}` };
        }
      }
    }

    const entry: SandboxEntry = {
      id,
      ipAddress,
      hostPort,
      createdAt: Date.now(),
      routePrefix: config.env?.ROUTE_PREFIX || "/__platform",
      volume: volumeIdToMount,
      urls: {
        tunnel: tunnelUrl,
        lan: config.flags?.lan ? `http://${hostAddress}:${hostPort}` : null,
        container: `http://${ipAddress}`,
      },
    };

    this.sandboxes.set(containerName, entry);

    return { success: true, data: entry };
  }

  /**
   * Run a container command and return the result
   */
  runCommand(args: string[], timeoutMs?: number): Promise<{ ok: boolean; out: string; err: string; timedOut?: boolean }> {
    return new Promise((resolve) => {
      const proc = spawn(CONTAINER_CLI, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let killed = false;

      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs) {
        timer = setTimeout(() => {
          killed = true;
          proc.kill("SIGKILL");
        }, timeoutMs);
      }

      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (err += d.toString()));
      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ ok: code === 0, out: out.trim(), err: err.trim(), timedOut: killed });
      });
    });
  }

  /**
   * Restart the container API server to recover from stuck VMs.
   * This is a workaround for macOS Virtualization.framework bugs where
   * crashed VMs can get stuck in zombie state.
   */
  private async restartContainerApiServer(): Promise<void> {
    log.warn("Restarting container-apiserver to recover from stuck VM...");
    const proc = spawn("pkill", ["-f", "container-apiserver"], { stdio: "ignore" });
    await new Promise<void>((resolve) => proc.on("close", () => resolve()));
    // Give it a moment to restart
    await new Promise((r) => setTimeout(r, 2000));
  }

  /**
   * Force delete a container with timeout and API server restart fallback.
   * Handles crashed/zombie VMs that can't be stopped normally.
   */
  async forceDeleteContainer(containerId: string, timeoutMs = 10000): Promise<{ ok: boolean; restarted: boolean }> {
    const result = await this.runCommand(["delete", "--force", containerId], timeoutMs);

    if (result.timedOut) {
      // Container is stuck - restart the API server to recover
      await this.restartContainerApiServer();
      // Try delete again after restart
      const retryResult = await this.runCommand(["delete", containerId], 5000);
      return { ok: retryResult.ok || retryResult.timedOut === false, restarted: true };
    }

    return { ok: result.ok, restarted: false };
  }

  /**
   * Wait for a URL to return 200
   */
  async waitFor200(url: string, maxAttempts = 60, delayMs = 1000): Promise<boolean> {
    const target = url.replace(/https?:\/\//, "").split("/")[0];
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (response.ok) {
            log.health.passed(target, i + 1);
            return true;
          }
          log.health.progress(target, i + 1, response.status);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        log.health.progress(target, i + 1);
      }

      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    log.health.failed(target, maxAttempts);
    throw new Error(`Health check failed: ${url} did not return 200 after ${maxAttempts} attempts`);
  }

  /**
   * Get the IP address for a container by name from inspect data
   */
  async getContainerIpAddress(containerName: string): Promise<string | undefined> {
    const inspectData = await this.inspectContainer(containerName);
    if (!inspectData) return undefined;

    return this.extractIpFromInspect(inspectData);
  }

  /**
   * Extract IP address from inspect data
   * Handles formats like "192.168.64.9/24" by stripping the CIDR notation
   */
  private extractIpFromInspect(inspectData: any): string | undefined {
    try {
      if (!inspectData) return undefined;

      // inspectData can be an array (from container inspect command)
      const data = Array.isArray(inspectData) ? inspectData[0] : inspectData;
      if (!data) return undefined;

      // Try to get IP from networks array (format: "192.168.64.9/24")
      const networks = data?.networks;
      if (Array.isArray(networks) && networks.length > 0) {
        const network = networks[0];
        // Try ipv4Address field (macOS container format)
        if (network?.ipv4Address) {
          const address = network.ipv4Address;
          // Strip CIDR notation (e.g., "192.168.64.15/24" -> "192.168.64.15")
          return address.split("/")[0];
        }
        // Try address field
        if (network?.address) {
          const address = network.address;
          // Strip CIDR notation (e.g., "192.168.64.9/24" -> "192.168.64.9")
          return address.split("/")[0];
        }
        // Try ipAddress field in network object
        if (network?.ipAddress) {
          return network.ipAddress.split("/")[0];
        }
        // Try ip field in network object
        if (network?.ip) {
          return network.ip.split("/")[0];
        }
      }

      // Try networks as an object (keyed by network name)
      if (data?.networks && typeof data.networks === "object" && !Array.isArray(data.networks)) {
        const networkNames = Object.keys(data.networks);
        if (networkNames.length > 0) {
          const firstNetwork = data.networks[networkNames[0]];
          if (firstNetwork?.IPAddress) {
            return firstNetwork.IPAddress.split("/")[0];
          }
          if (firstNetwork?.ipAddress) {
            return firstNetwork.ipAddress.split("/")[0];
          }
          if (firstNetwork?.address) {
            return firstNetwork.address.split("/")[0];
          }
        }
      }

      // Try NetworkSettings.Networks (Docker-style)
      if (data?.NetworkSettings?.Networks) {
        const networkNames = Object.keys(data.NetworkSettings.Networks);
        if (networkNames.length > 0) {
          const firstNetwork = data.NetworkSettings.Networks[networkNames[0]];
          if (firstNetwork?.IPAddress) {
            return firstNetwork.IPAddress.split("/")[0];
          }
        }
      }

      // Fallback: try top-level fields
      const topLevelIp = data?.addr || data?.ipAddress || data?.ip || data?.IPAddress;
      if (topLevelIp) {
        return topLevelIp.split("/")[0];
      }

      return undefined;
    } catch (error) {
      log.verbose(`Error extracting IP: ${error}`);
      return undefined;
    }
  }

  /**
   * Inspect a container and return the JSON data
   */
  async inspectContainer(containerName: string): Promise<Record<string, any> | undefined> {
    const { ok, out } = await this.runCommand(["inspect", containerName]);
    if (!ok) return undefined;

    try {
      return JSON.parse(out);
    } catch {
      return undefined;
    }
  }

  /**
   * Stop and remove a sandbox container.
   * Uses forceDeleteContainer with timeout fallback to handle crashed VMs.
   */
  async stopSandbox(id: string, options?: { preserveStorage?: boolean }): Promise<{ success: boolean; error?: string }> {
    // Sanitize ID to match how it's stored (same as in startSandbox)
    const containerName = id.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const entry = this.sandboxes.get(containerName);
    if (!entry) {
      return { success: false, error: "Sandbox not found" };
    }

    // Stop associated tunnel if it exists (use containerName to match registration)
    const tunnelManager = getTunnelManager();
    tunnelManager.stopTunnel(containerName);

    const { ok, restarted } = await this.forceDeleteContainer(containerName);
    if (restarted) {
      log.warn(`Container ${containerName} was stuck, API server was restarted`);
    }
    if (!ok) {
      return { success: false, error: `Failed to remove container: ${containerName}` };
    }

    // Release the port and remove from tracking
    releasePort(entry.hostPort);

    // Delete associated volume unless caller asked to preserve it
    if (!options?.preserveStorage && entry.volume) {
      const volumeService = getVolumeService();
      try {
        await volumeService.delete(entry.volume);
        log.verbose(`Deleted volume ${entry.volume} for container: ${containerName}`);
      } catch (error: any) {
        log.verbose(`Note: Could not delete volume ${entry.volume} for ${containerName}: ${error.message}`);
      }
    }

    this.sandboxes.delete(containerName);
    return { success: true };
  }

  /**
   * Get a sandbox by ID
   */
  getSandbox(id: string): SandboxEntry | undefined {
    // Sanitize ID to match how it's stored (same as in startSandbox)
    const containerName = id.toLowerCase().replace(/[^a-z0-9-]/g, "");
    return this.sandboxes.get(containerName);
  }

  /**
   * Get all sandboxes
   */
  getAllSandboxes(): Record<string, SandboxEntry> {
    return Object.fromEntries(this.sandboxes);
  }

  /**
   * List all containers
   */
  async listContainers(): Promise<{ success: boolean; data?: any; error?: string }> {
    const { ok, out, err } = await this.runCommand(["list", "--format", "json"]);
    if (!ok) {
      return { success: false, error: `Failed to list containers: ${err}` };
    }
    try {
      return { success: true, data: JSON.parse(out) };
    } catch {
      return { success: true, data: [] };
    }
  }

  /**
   * Kill all running containers.
   * Falls back to restarting the API server if containers are stuck.
   */
  async killAll(): Promise<void> {
    // Stop all tunnels associated with tracked containers
    const tunnelManager = getTunnelManager();
    for (const id of this.sandboxes.keys()) {
      tunnelManager.stopTunnel(id);
    }

    // Release all allocated ports before clearing
    for (const entry of this.sandboxes.values()) {
      const hostPort = entry.hostPort;
      if (hostPort !== undefined) {
        releasePort(hostPort);
      }
    }

    // Delete all volumes associated with sandboxes
    const volumeService = getVolumeService();
    const volumeNames = Array.from(this.sandboxes.keys());
    if (volumeNames.length > 0) {
      try {
        await volumeService.deleteMultiple(volumeNames);
        log.verbose(`Deleted ${volumeNames.length} volume(s)`);
      } catch (error: any) {
        log.verbose(`Note: Could not delete all volumes: ${error.message}`);
      }
    }

    const result = await this.runCommand(["delete", "--all", "--force"], 15000);
    if (result.timedOut) {
      log.warn("Container delete --all timed out, restarting API server...");
      await this.restartContainerApiServer();
    }
    this.sandboxes.clear();
  }

  /**
   * Execute a command in a running sandbox container
   */
  async execInSandbox(
    containerId: string,
    command: string,
    args: string[] = [],
    timeout: number = 30000,
    workdir: string = "/workspace",
    user?: string,
  ): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string; error?: string }> {
    return new Promise((resolve) => {
      const execArgs = ["exec", "-w", workdir];
      if (user) {
        execArgs.push("-u", user);
      }
      execArgs.push(containerId, command, ...args);
      const proc = spawn(CONTAINER_CLI, execArgs, { stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // Set timeout
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
      }, timeout);

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);

        if (timedOut) {
          resolve({
            success: false,
            exitCode: -1,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: "Command timed out",
          });
        } else {
          resolve({
            success: code === 0,
            exitCode: code || 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        }
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: error.message,
        });
      });
    });
  }

  /**
   * Execute a command in a running sandbox container with streaming support
   * Returns a spawn process that can be used to stream stdout/stderr
   */
  execInSandboxStreaming(containerId: string, command: string, args: string[] = [], workdir: string = "/workspace", user?: string) {
    const execArgs = ["exec", "-w", workdir];
    if (user) {
      execArgs.push("-u", user);
    }
    execArgs.push(containerId, command, ...args);
    return spawn(CONTAINER_CLI, execArgs, { stdio: ["ignore", "pipe", "pipe"] });
  }
}

// Singleton instance
let containerManagerInstance: ContainerManager | null = null;

export function getContainerManager(config?: ContainerManagerConfig): ContainerManager {
  if (!containerManagerInstance) {
    containerManagerInstance = new ContainerManager(config);
  }
  return containerManagerInstance;
}

export function resetContainerManager(): void {
  containerManagerInstance = null;
}
