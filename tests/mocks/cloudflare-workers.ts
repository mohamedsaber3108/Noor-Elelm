// Stand-in for the `cloudflare:workers` module. tests/setup.ts puts a fresh D1 stand-in into env.DB.
export const env: Record<string, unknown> & { DB?: unknown } = {};
