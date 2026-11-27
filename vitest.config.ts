import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// Tests run in plain Node: no browser, no server, no network.
// `cloudflare:workers` and `next/headers` are replaced by small stand-ins in tests/.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^cloudflare:workers$/, replacement: p("./tests/mocks/cloudflare-workers.ts") },
      { find: /^next\/headers$/, replacement: p("./tests/mocks/next-headers.ts") },
      { find: /^@\//, replacement: p("./") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
