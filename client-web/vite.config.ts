import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // PWA installable + démarrage hors-ligne (Caisse). L'icône pwa-icon.png est
    // l'icône existante du client Electron (client-electron/build/icon.png) —
    // à redécliner en tailles propres (192/512, maskable) pour la production,
    // un seul fichier suffit pour ce premier passage.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-icon.png"],
      manifest: {
        name: "Gestion Stock",
        short_name: "Gestion Stock",
        description: "Caisse et gestion de stock — utilisable hors-ligne",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#2563eb",
        icons: [
          { src: "/pwa-icon.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-icon.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell en cache : le navigateur charge l'appli sans réseau une
        // fois installée/visitée une première fois. Les appels /api/* ne sont
        // volontairement pas mis en cache Workbox ici — la couche
        // IndexedDB + sync (src/db, src/sync) gère déjà la persistance et la
        // resynchronisation des données métier, un double cache HTTP créerait
        // deux sources de vérité à réconcilier pour rien.
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
      },
    }),
  ],
  server: {
    port: 5174,
  },
});
