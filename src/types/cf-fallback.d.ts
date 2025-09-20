// Fallback minimal Cloudflare types for local editor before installing @cloudflare/workers-types
// These will be merged with real types once the package is installed.

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}
