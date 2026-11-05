import path from "node:path";
import { BrowserWindow, app } from "electron";

import { rafraichirDatePlafond } from "./services/abonnement";
import { ouvrirBaseDeDonnees } from "./db";
import { enregistrerLesHandlers } from "./ipc/handlers";
import { arreterBoucleCaisse, demarrerBoucleCaisse } from "./services/reseauCaisse";
import { arreterPostePrincipal, demarrerPostePrincipal, verifierAutorisationReseau } from "./services/reseauPrincipal";
import { sauvegarderALaFermeture, verifierSauvegardePlanifiee } from "./services/sauvegarde";

// Fixe le nom de l'appli (donc app.getPath("userData")) avant toute autre
// initialisation : sans ça, un lancement non empaqueté (electron.cmd
// dist-electron/main.js, hors "npm run dev") retombe sur le nom générique
// "Electron" et lit/écrit une base SQLite différente de celle utilisée par
// les autres méthodes de lancement.
app.setName("client-electron");

let fenetrePrincipale: BrowserWindow | null = null;

/** Accès à la fenêtre principale depuis d'autres modules (ex. clic sur une notification système). */
export function obtenirFenetrePrincipale(): BrowserWindow | null {
  return fenetrePrincipale;
}

async function creerFenetre(): Promise<void> {
  fenetrePrincipale = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "gestion_stock — Caisse",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await fenetrePrincipale.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await fenetrePrincipale.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  await ouvrirBaseDeDonnees();
  rafraichirDatePlafond();
  enregistrerLesHandlers();
  // Réseau de la boutique : le poste principal rouvre son serveur, une caisse
  // reprend ses échanges toutes les 4 s (rien ne se passe sur un poste seul).
  void demarrerPostePrincipal();
  demarrerBoucleCaisse();
  // Sauvegarde chiffrée de la boutique (lot 7) : vérifiée au démarrage puis toutes les 5 min.
  verifierSauvegardePlanifiee();
  setInterval(() => verifierSauvegardePlanifiee(), 5 * 60 * 1000);
  // Réseau de la boutique désactivé / réactivé par l'administrateur : vérifié chaque minute.
  setInterval(() => void verifierAutorisationReseau(), 60 * 1000);
  await creerFenetre();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void creerFenetre();
  });
});

app.on("before-quit", () => {
  sauvegarderALaFermeture();
  arreterBoucleCaisse();
  void arreterPostePrincipal();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
