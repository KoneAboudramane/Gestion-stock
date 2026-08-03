import { defineConfig } from "vitest/config";

// Config Vitest séparée de vite.config.ts : celle-ci charge vite-plugin-electron
// (qui tente de lancer Electron), inutile et gênant pour de simples tests unitaires.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/mock-electron.ts"],
  },
});
