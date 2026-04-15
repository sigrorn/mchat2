import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "src-tauri/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["src-tauri/**", "tests/e2e/**", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
