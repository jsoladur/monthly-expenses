import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// `server-only` throws when imported outside a React Server Component
// boundary. In Vitest we run in a plain Node environment, so we alias it to
// an empty stub. The real protection (client imports failing the build) is
// still active in `next build` via the package's own conditional exports.
const SERVER_ONLY_STUB = resolve(import.meta.dirname, "./tests/stubs/server-only.ts");

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "server-only": SERVER_ONLY_STUB,
    },
  },
});
