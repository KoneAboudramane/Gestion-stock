import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            // sql.js (CJS/UMD) casse si inliné en ESM (sa détection interne
            // de `module` échoue) : on le force en require() Node natif.
            rollupOptions: { external: ["sql.js", "electron", "exceljs", "pdfkit"] },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
      },
      renderer: {},
    }),
  ],
});
