/**
 * Mac Sandbox Types
 */

import { z } from "@hono/zod-openapi";

// Zod Schemas
export const SandboxEntrySchema = z
  .object({
    id: z.string().openapi({ example: "abc123" }),
    ipAddress: z.string().openapi({ example: "192.168.64.10" }),
    hostPort: z.number().openapi({ example: 8080 }),
    createdAt: z.number().openapi({ example: 1704067200000 }),
    routePrefix: z.string().openapi({ example: "/__platform" }),
    volume: z.string().nullable().openapi({ example: "sandbox-abc123", description: "Volume name when storage was provided" }),
    urls: z.object({
      tunnel: z.string().nullable().openapi({ example: "https://sandbox.trycloudflare.com" }),
      lan: z.string().nullable().openapi({ example: "http://192.168.1.100:8080" }),
      container: z.string().openapi({ example: "http://192.168.64.10:80" }),
    }),
  })
  .openapi("SandboxEntry");

export const PairingRequestSchema = z
  .object({
    code: z.string().openapi({ example: "ABC123" }),
    createdAt: z.number().openapi({ example: 1704067200000 }),
    expiresAt: z.number().openapi({ example: 1704070800000 }),
    confirmed: z.boolean().openapi({ example: false }),
    token: z.string().optional().openapi({ example: "tok_secret..." }),
    deviceName: z.string().optional().openapi({ example: "My Laptop" }),
  })
  .openapi("PairingRequest");

export const AuthTokenSchema = z
  .object({
    token: z.string().openapi({ example: "tok_secret..." }),
    deviceName: z.string().openapi({ example: "My Laptop" }),
    createdAt: z.number().openapi({ example: 1704067200000 }),
    lastUsed: z.number().openapi({ example: 1704153600000 }),
  })
  .openapi("AuthToken");

export const SandboxConfigSchema = z
  .object({
    flags: z.object({
      tunnel: z.boolean().optional().openapi({ example: true, description: "Enable Cloudflare tunnel" }),
      lan: z.boolean().optional().openapi({ example: true, description: "Enable LAN access" }),
    }).optional(),
    healthCheck: z.object({
      url: z.enum(["tunnel", "lan", "container"]).optional().openapi({ example: "tunnel", description: "Health check URL" }),
      timeout: z.number().optional().openapi({ example: 5000, description: "Health check timeout in milliseconds" }),
      interval: z.number().optional().openapi({ example: 1000, description: "Health check interval in milliseconds" }),
      maxAttempts: z.number().optional().openapi({ example: 10, description: "Maximum number of health check attempts" }),
      destroy: z.boolean().optional().openapi({ example: true, description: "Destroy container if health check fails" }),
    }).optional(),
    cpus: z.number().optional().openapi({ example: 2, description: "Number of CPUs to allocate" }),
    volumeId: z.string().optional().openapi({ example: "41806d1f", description: "Existing volume ID to attach to /workspace. Takes precedence over storage." }),
    storage: z
      .enum(["1G", "5G", "10G", "15G", "20G", "25G", "30G", "32G", "64G", "128G"])
      .nullable()
      .optional()
      .openapi({ example: "10G", description: "Storage size to create a new volume. Ignored if volumeId is provided." }),
    memory: z.string().optional().openapi({ example: "4G", description: "Memory limit" }),
    env: z
      .record(z.string(), z.string())
      .optional()
      .openapi({ example: { NODE_ENV: "development" } }),
  })
  .openapi("SandboxConfig");

export const SandboxResponseSchema = z
  .object({
    id: z.string().openapi({ example: "abc123" }),
    ipAddress: z.string().optional().openapi({ example: "192.168.64.10" }),
    platformToken: z.string().optional().openapi({ example: "tok_abc123..." }),
    inspectData: z.record(z.string(), z.any()).optional(),
    tunnelUrl: z.string().nullable().optional().openapi({ example: "https://sandbox.trycloudflare.com" }),
    alreadyRunning: z.boolean().optional().openapi({ example: false }),
    routePrefix: z.string().optional().openapi({ example: "/__platform" }),
  })
  .openapi("SandboxResponse");

export const ServerConfigSchema = z
  .object({
    port: z.number().optional().openapi({ example: 4000 }),
    sandboxImage: z.string().optional().openapi({ example: "sandbox:latest" }),
    tokenSecret: z.string().optional(),
    dataDir: z.string().optional().openapi({ example: "/var/lib/sandbox" }),
  })
  .openapi("ServerConfig");

export const PairingConfirmRequestSchema = z
  .object({
    code: z.string().min(1, "Pairing code is required").openapi({ example: "ABC123" }),
    deviceName: z.string().optional().openapi({ example: "My Laptop" }),
  })
  .openapi("PairingConfirmRequest");

export const PairingConfirmResponseSchema = z
  .object({
    token: z.string().openapi({ example: "tok_secret..." }),
    expiresIn: z.number().optional().openapi({ example: 86400 }),
  })
  .openapi("PairingConfirmResponse");

export const ClientConfigSchema = z
  .object({
    baseUrl: z.string().openapi({ example: "http://localhost:4000" }),
    token: z.string().openapi({ example: "tok_secret..." }),
  })
  .openapi("ClientConfig");

export const ExecRequestSchema = z
  .object({
    command: z.string().min(1, "Command is required").openapi({ example: "ls", description: "Command to execute" }),
    args: z
      .array(z.string())
      .optional()
      .openapi({ example: ["-la", "/workspace"] }),
    timeout: z.number().positive().optional().openapi({ example: 30000, description: "Timeout in milliseconds" }),
    user: z.string().optional().openapi({ example: "node", description: "User to execute command as (default: root)" }),
  })
  .openapi("ExecRequest");

export const ExecResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    command: z.string().openapi({ example: "ls" }),
    args: z
      .array(z.string())
      .optional()
      .openapi({ example: ["-la"] }),
    exitCode: z.number().openapi({ example: 0 }),
    stdout: z.string().openapi({ example: "file1.txt\nfile2.txt" }),
    stderr: z.string().openapi({ example: "" }),
    durationMs: z.number().openapi({ example: 250 }),
  })
  .openapi("ExecResponse");

export const VolumeCreateOptionsSchema = z
  .object({
    id: z.string().min(1, "Volume id is required").openapi({ example: "my-volume", description: "Volume id" }),
    size: z.string().optional().openapi({ example: "10G", description: "Volume size (e.g., 10G, 500M)" }),
    label: z.string().optional().openapi({ example: "my-label", description: "Volume label" }),
  })
  .openapi("VolumeCreateOptions");

export const VolumeDeleteBatchSchema = z
  .object({
    ids: z
      .array(z.string().min(1))
      .nonempty("At least one volume id is required")
      .openapi({
        example: ["volume1", "volume2"],
        description: "Array of volume ids to delete",
      }),
  })
  .openapi("VolumeDeleteBatch");

export const VolumeInfoSchema = z
  .object({
    id: z.string().openapi({ example: "my-volume" }),
    driver: z.string().optional().openapi({ example: "local" }),
    mountpoint: z.string().optional().openapi({ example: "/var/lib/volumes/my-volume" }),
    createdAt: z.string().optional().openapi({ example: "2024-01-01T00:00:00Z" }),
    labels: z
      .record(z.string(), z.string())
      .optional()
      .openapi({ example: { env: "production" } }),
  })
  .openapi("VolumeInfo");

// Common Response Schemas
export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ example: "Invalid request" }),
    details: z.any().optional(),
  })
  .openapi("ErrorResponse");

export const SuccessResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().optional().openapi({ example: "Operation completed successfully" }),
  })
  .openapi("SuccessResponse");

export const HealthResponseSchema = z
  .object({
    status: z.string().openapi({ example: "ok" }),
    timestamp: z.string().openapi({ example: "2024-01-01T00:00:00.000Z" }),
    version: z.string().openapi({ example: "1.0.0" }),
  })
  .openapi("HealthResponse");

// Inferred TypeScript Types
export type SandboxEntry = z.infer<typeof SandboxEntrySchema> & {
  // Internal fields for container management (not exposed in API)
  container?: string;
  platformToken?: string;
  inspectData?: Record<string, any>;
};
export type PairingRequest = z.infer<typeof PairingRequestSchema>;
export type AuthToken = z.infer<typeof AuthTokenSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type SandboxResponse = z.infer<typeof SandboxResponseSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type PairingConfirmRequest = z.infer<typeof PairingConfirmRequestSchema>;
export type PairingConfirmResponse = z.infer<typeof PairingConfirmResponseSchema>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type ExecRequest = z.infer<typeof ExecRequestSchema>;
export type ExecResponse = z.infer<typeof ExecResponseSchema>;
export type VolumeCreateOptions = z.infer<typeof VolumeCreateOptionsSchema>;
export type VolumeDeleteBatch = z.infer<typeof VolumeDeleteBatchSchema>;
export type VolumeInfo = z.infer<typeof VolumeInfoSchema>;
