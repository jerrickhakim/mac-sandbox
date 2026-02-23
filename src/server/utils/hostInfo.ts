import { ChildProcess } from "child_process";
import log from "./logger.js";

/**
 * Store information about the host server
 * Used to distinguish host tunnel from sandbox tunnels in the proxy
 */
export class HostInfo {
  private hostTunnelUrl?: string;
  private hostTunnelHost?: string;
  private hostTunnelProcess?: ChildProcess;

  /**
   * Set the host tunnel information
   */
  setHostTunnel(tunnelUrl: string, process: ChildProcess): void {
    this.hostTunnelUrl = tunnelUrl;
    this.hostTunnelHost = tunnelUrl.replace(/https?:\/\//, "");
    this.hostTunnelProcess = process;
  }

  /**
   * Get the host tunnel URL
   */
  getHostTunnelUrl(): string | undefined {
    return this.hostTunnelUrl;
  }

  /**
   * Get the host tunnel hostname
   */
  getHostTunnelHost(): string | undefined {
    return this.hostTunnelHost;
  }

  /**
   * Check if a hostname is the host tunnel
   */
  isHostTunnel(hostname: string): boolean {
    if (!this.hostTunnelHost) {
      return false;
    }
    return hostname === this.hostTunnelHost;
  }

  /**
   * Stop the host tunnel
   */
  stopHostTunnel(): void {
    if (this.hostTunnelProcess) {
      try {
        this.hostTunnelProcess.kill("SIGTERM");
        setTimeout(() => {
          if (this.hostTunnelProcess && !this.hostTunnelProcess.killed) {
            this.hostTunnelProcess.kill("SIGKILL");
          }
        }, 2000);
        log.tunnel.stopped("host");
      } catch (error: any) {
        log.tunnel.error("host", error.message);
      }
    }
  }

  /**
   * Clear host tunnel info
   */
  clear(): void {
    this.stopHostTunnel();
    this.hostTunnelUrl = undefined;
    this.hostTunnelHost = undefined;
    this.hostTunnelProcess = undefined;
  }
}

// Singleton instance
let hostInfoInstance: HostInfo | null = null;

export function getHostInfo(): HostInfo {
  if (!hostInfoInstance) {
    hostInfoInstance = new HostInfo();
  }
  return hostInfoInstance;
}

export function resetHostInfo(): void {
  if (hostInfoInstance) {
    hostInfoInstance.clear();
  }
  hostInfoInstance = null;
}
