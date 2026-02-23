import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { AuthToken, PairingRequest } from "../../types/index.js";

const DEFAULT_DATA_DIR = path.join(process.env.HOME || "~", ".sandbox-mac");

export class TokenManager {
  private tokens: Map<string, AuthToken> = new Map();
  private pairingRequests: Map<string, PairingRequest> = new Map();
  private secret: string;
  private dataDir: string;
  private tokensFile: string;

  constructor(secret?: string, dataDir?: string) {
    this.secret = secret || crypto.randomBytes(32).toString("hex");
    this.dataDir = dataDir || DEFAULT_DATA_DIR;
    this.tokensFile = path.join(this.dataDir, "tokens.json");
    this.ensureDataDir();
    this.loadTokens();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokensFile)) {
        const data = JSON.parse(fs.readFileSync(this.tokensFile, "utf-8"));
        this.tokens = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error("Failed to load tokens:", error);
    }
  }

  private saveTokens(): void {
    try {
      const data = Object.fromEntries(this.tokens);
      fs.writeFileSync(this.tokensFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Failed to save tokens:", error);
    }
  }

  /**
   * Generate a human-readable pairing code (6 digits)
   */
  generatePairingCode(): string {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += Math.floor(Math.random() * 10).toString();
    }
    return code;
  }

  /**
   * Create a new pairing request
   */
  createPairingRequest(): PairingRequest {
    // Clean up expired pairing requests
    const now = Date.now();
    for (const [code, request] of this.pairingRequests) {
      if (request.expiresAt < now) {
        this.pairingRequests.delete(code);
      }
    }

    const code = this.generatePairingCode();
    const request: PairingRequest = {
      code,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000, // 5 minutes
      confirmed: false,
    };

    this.pairingRequests.set(code, request);
    return request;
  }

  /**
   * Get a pairing request by code
   */
  getPairingRequest(code: string): PairingRequest | undefined {
    const request = this.pairingRequests.get(code.toUpperCase());
    if (request && request.expiresAt > Date.now()) {
      return request;
    }
    return undefined;
  }

  /**
   * Confirm a pairing request and generate a token
   */
  confirmPairing(code: string, deviceName?: string): string | null {
    const request = this.getPairingRequest(code.toUpperCase());
    if (!request) {
      return null;
    }

    // Generate a secure token
    const token = this.generateToken();
    const authToken: AuthToken = {
      token,
      deviceName: deviceName || `Device-${Date.now()}`,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    this.tokens.set(token, authToken);
    this.saveTokens();

    // Mark pairing as confirmed and store token
    request.confirmed = true;
    request.token = token;
    request.deviceName = deviceName;

    return token;
  }

  /**
   * Generate a secure API token
   */
  private generateToken(): string {
    const payload = crypto.randomBytes(32).toString("hex");
    const hmac = crypto.createHmac("sha256", this.secret);
    hmac.update(payload);
    const signature = hmac.digest("hex").substring(0, 16);
    return `${payload}${signature}`;
  }

  /**
   * Validate a token and return the auth info
   */
  validateToken(token: string): AuthToken | null {
    const authToken = this.tokens.get(token);
    if (authToken) {
      // Update last used timestamp
      authToken.lastUsed = Date.now();
      this.saveTokens();
      return authToken;
    }
    return null;
  }

  /**
   * Revoke a token
   */
  revokeToken(token: string): boolean {
    const deleted = this.tokens.delete(token);
    if (deleted) {
      this.saveTokens();
    }
    return deleted;
  }

  /**
   * List all active tokens (without exposing the actual token values)
   */
  listTokens(): Array<{ deviceName: string; createdAt: number; lastUsed: number }> {
    return Array.from(this.tokens.values()).map((t) => ({
      deviceName: t.deviceName,
      createdAt: t.createdAt,
      lastUsed: t.lastUsed,
    }));
  }

  /**
   * Check if a pairing was confirmed and return the token
   */
  checkPairingStatus(code: string): { confirmed: boolean; token?: string } {
    const request = this.pairingRequests.get(code.toUpperCase());
    if (!request) {
      return { confirmed: false };
    }
    return {
      confirmed: request.confirmed,
      token: request.token,
    };
  }
}

// Singleton instance
let tokenManagerInstance: TokenManager | null = null;

export function getTokenManager(secret?: string, dataDir?: string): TokenManager {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager(secret, dataDir);
  }
  return tokenManagerInstance;
}

export function resetTokenManager(): void {
  tokenManagerInstance = null;
}
