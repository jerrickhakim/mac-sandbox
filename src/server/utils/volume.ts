import { spawn } from "child_process";
import type { VolumeCreateOptions, VolumeInfo } from "../../types/index.js";

const CONTAINER_CLI = "container";

export class VolumeService {
  /**
   * Run a container volume command and return the result
   */
  private runCommand(args: string[], timeoutMs: number = 30000): Promise<{ ok: boolean; out: string; err: string; timedOut?: boolean }> {
    return new Promise((resolve) => {
      const proc = spawn(CONTAINER_CLI, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGKILL");
      }, timeoutMs);

      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (err += d.toString()));
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, out: out.trim(), err: err.trim(), timedOut: killed });
      });
    });
  }

  /**
   * Create a new volume
   */
  async create(options: VolumeCreateOptions): Promise<{ success: boolean; data?: VolumeInfo; error?: string }> {
    const args = ["volume", "create"];

    if (options.size) {
      args.push("-s", options.size);
    }

    if (options.label) {
      args.push("--label", options.label);
    }

    args.push(options.id);

    const { ok, out, err } = await this.runCommand(args);
    if (!ok) {
      return { success: false, error: `Failed to create volume: ${err}` };
    }

    return {
      success: true,
      data: {
        id: options.id,
      },
    };
  }

  /**
   * List all volumes
   */
  async list(): Promise<{ success: boolean; data?: VolumeInfo[]; error?: string }> {
    const { ok, out, err } = await this.runCommand(["volume", "list", "--format", "json"]);
    if (!ok) {
      return { success: false, error: `Failed to list volumes: ${err}` };
    }

    try {
      const volumes = JSON.parse(out);
      // Map 'name' to 'id' for consistency
      const mappedVolumes = volumes.map((v: any) => ({ ...v, id: v.name }));
      return { success: true, data: mappedVolumes };
    } catch (parseError) {
      return { success: false, error: "Failed to parse volume list" };
    }
  }

  /**
   * Delete a volume by id
   */
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    const { ok, err } = await this.runCommand(["volume", "delete", id]);
    if (!ok) {
      return { success: false, error: `Failed to delete volume: ${err}` };
    }

    return { success: true };
  }

  /**
   * Delete multiple volumes
   */
  async deleteMultiple(ids: string[]): Promise<{ success: boolean; error?: string }> {
    if (ids.length === 0) {
      return { success: false, error: "No volume ids provided" };
    }

    const { ok, err } = await this.runCommand(["volume", "delete", ...ids]);
    if (!ok) {
      return { success: false, error: `Failed to delete volumes: ${err}` };
    }

    return { success: true };
  }
}

// Singleton instance
let volumeServiceInstance: VolumeService | null = null;

export function getVolumeService(): VolumeService {
  if (!volumeServiceInstance) {
    volumeServiceInstance = new VolumeService();
  }
  return volumeServiceInstance;
}

export function resetVolumeService(): void {
  volumeServiceInstance = null;
}
