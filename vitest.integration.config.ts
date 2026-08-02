import { defineConfig } from "vitest/config";
import path from "path";

/** Postgres critical-path suites — `npm run test:integration` (skip without DATABASE_URL). */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
