import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Mirrors the `@/*` path alias from tsconfig.json. Without it, any test that reaches a module
 * importing `@/data/questions.json` fails to resolve.
 *
 * `server-only` throws when imported outside React Server Components, which is everywhere a
 * test runs; its own empty build (what the react-server condition loads) stands in for it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});
