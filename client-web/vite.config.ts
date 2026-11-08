import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // PWA installable + démarrage hors-ligne (Caisse). L'icône pwa-icon.png est
    // l'icône existante du client Electron (client-electron/build/icon.png) —
    // à redécliner en tailles propres (192/512, maskable) pour la production,
    // un seul fichier suffit pour ce premier passage.
    VitePWA({
      // Appli Android (mode « capacitor », voir capacitor.config.ts) : les pages
      // sont déjà dans l'appli, un service worker ne servirait à rien et
      // garderait d'anciennes versions en cache après une mise à jour du Play Store.
      // `disable` garde les modules virtuels (useRegisterSW) qui ne font alors rien.
      disable: mode === "capacitor",
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
        // Le service worker a un scope "/" (toute l'origine, pas juste
        // client-web) : sans exclusion, sa NavigationRoute intercepte AUSSI
        // les navigations vers /admin/ et /api/ et leur sert le shell SPA en
        // cache à la place de la vraie page (bug constaté : l'admin Django
        // affichait client-web). /admin et /api sont servis par Django, pas
        // par ce SPA — jamais de fallback vers index.html pour eux.
        navigateFallbackDenylist: [/^\/admin/, /^\/api/],
      },
    }),
  ],
  // L'appli Android a son propre dossier (webDir de capacitor.config.ts) :
  // dist/ est versionné et servi tel quel par Django en production, il ne doit
  // jamais recevoir la version Android (API en adresse absolue, sans service worker).
  build: mode === "capacitor" ? { outDir: "dist-android" } : {},
  server: {
    port: 5174,
    // Styles communs aux trois applis : ../partage (voir partage/styles/admin.css).
    fs: { allow: [".", "../partage"] },
  },
}));
