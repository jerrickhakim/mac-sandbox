import fs from "fs/promises";
import path from "path";

const DEV_STATE_DIR = path.join(process.cwd(), ".dev");

export interface PersistentMapOptions {
  /**
   * Name of the file to persist to (e.g., "sandboxes")
   * Will be saved as .dev/{filename}.json
   */
  filename: string;
  
  /**
   * Enable persistence (defaults to NODE_ENV === "development")
   */
  enabled?: boolean;
  
  /**
   * Debounce write operations in milliseconds (defaults to 100ms)
   */
  debounceMs?: number;
}

/**
 * A Map that automatically persists to filesystem in development mode.
 * Behaves exactly like a regular Map but saves state to .dev/{filename}.json
 */
export class PersistentMap<K, V> extends Map<K, V> {
  private filename: string;
  private enabled: boolean;
  private debounceMs: number;
  private saveTimer: NodeJS.Timeout | null = null;
  private filePath: string;

  constructor(options: PersistentMapOptions, entries?: readonly (readonly [K, V])[] | null) {
    super(entries);
    
    this.filename = options.filename;
    this.enabled = options.enabled ?? process.env.NODE_ENV === "development";
    this.debounceMs = options.debounceMs ?? 100;
    this.filePath = path.join(DEV_STATE_DIR, `${this.filename}.json`);
    
    if (this.enabled) {
      this.loadSync();
    }
  }

  /**
   * Load state from file synchronously during initialization
   */
  private loadSync(): void {
    try {
      const data = require('fs').readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(data);
      
      if (parsed.entries && Array.isArray(parsed.entries)) {
        for (const [key, value] of parsed.entries) {
          super.set(key, value);
        }
      }
    } catch (error: any) {
      // Silently ignore if file doesn't exist
      if (error.code !== "ENOENT") {
        console.warn(`Could not load ${this.filename}:`, error.message);
      }
    }
  }

  /**
   * Save state to file with debouncing
   */
  private scheduleSave(): void {
    if (!this.enabled) return;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveNow().catch((err) => {
        console.warn(`Error saving ${this.filename}:`, err.message);
      });
    }, this.debounceMs);
  }

  /**
   * Immediately save state to file
   */
  private async saveNow(): Promise<void> {
    try {
      await fs.mkdir(DEV_STATE_DIR, { recursive: true });

      const state = {
        timestamp: Date.now(),
        entries: Array.from(this.entries()),
      };

      await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (error: any) {
      console.warn(`Error writing ${this.filename}:`, error.message);
    }
  }

  // Override Map methods to trigger persistence

  set(key: K, value: V): this {
    super.set(key, value);
    this.scheduleSave();
    return this;
  }

  delete(key: K): boolean {
    const result = super.delete(key);
    if (result) {
      this.scheduleSave();
    }
    return result;
  }

  clear(): void {
    super.clear();
    this.scheduleSave();
  }

  /**
   * Manually trigger an immediate save (useful before shutdown)
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveNow();
  }
}
