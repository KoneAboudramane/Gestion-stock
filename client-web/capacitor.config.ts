import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Appli Android (puis iOS) du commerçant : le même client web, emballé par
 * Capacitor. Les écrans sont DANS l'appli (dossier dist-android), elle démarre donc
 * sans réseau ; seul l'échange avec le serveur (connexion, synchro) a besoin
 * d'internet. Construire avec `npm run build:android` (mode « capacitor »,
 * voir .env.capacitor et vite.config.ts).
 */
const config: CapacitorConfig = {
  // Identifiant définitif une fois l'appli publiée sur le Play Store : à valider avant.
  appId: "com.gestionstock.commercant",
  appName: "Gestion Stock",
  // Pas « dist » : celui-là est le build web versionné servi en production.
  webDir: "dist-android",
  android: {
    // Pas de contenu http dans une page https : l'API doit être en HTTPS valide.
    allowMixedContent: false,
    // Android 15+ dessine l'appli SOUS la barre d'état et les boutons du bas : sans
    // marges, le bas de l'écran (⚙ Espace Admin, barre d'onglets) était caché
    // (constaté sur Galaxy Tab A11, Android 16, le 07/11/2026).
    adjustMarginsForEdgeToEdge: "auto",
  },
  server: {
    // Origine des pages dans l'appli : https://localhost (à autoriser dans CORS_ALLOWED_ORIGINS du serveur).
    androidScheme: "https",
  },
};

export default config;
