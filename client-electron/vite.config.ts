import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { startup } from "vite-plugin-electron";
import electron from "vite-plugin-electron/simple";

// Windows : au redémarrage après une modification du processus principal, la
// fermeture de l'ancienne fenêtre (taskkill) échoue parfois sur un processus
// enfant déjà parti, et l'erreur arrêtait tout `npm run dev`. On l'ignore :
// l'appli redémarre quand même avec le nouveau code.
const fermerElectron = startup.exit;
startup.exit = async () => {
  try {
    await fermerElectron();
  } catch {
    // Fenêtre déjà fermée : rien à faire.
  }
};

export default defineConfig({
  server: {
    // Sur ce poste, la surveillance native rate des fichiers modifiés par des
    // scripts : la scrutation garantit le rechargement automatique de l'écran.
    watch: { usePolling: true, interval: 300, ignored: ["**/dist/**", "**/dist-electron/**", "**/release/**"] },
    // Styles communs aux trois applis : ../partage (voir partage/styles/admin.css).
    fs: { allow: [".", "../partage"] },
  },
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
