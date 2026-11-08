import { api } from "./api";

/**
 * Thème du site d'administration : les 7 thèmes de l'appli (même couleurs,
 * partage/styles/themes.css), attaché au COMPTE de l'admin sur le serveur
 * (administration.PreferencesAdmin) pour le retrouver sur tous ses appareils.
 * Le navigateur en garde une copie seulement pour l'appliquer dès le
 * chargement, avant la réponse du serveur (pas de flash du thème clair).
 */
export type Theme = "clair" | "sombre" | "nuit" | "orange" | "vert" | "bleu" | "gris";

export const THEMES: { valeur: Theme; libelle: string; icone: string }[] = [
  { valeur: "clair", libelle: "Clair", icone: "☀️" },
  { valeur: "sombre", libelle: "Sombre", icone: "🌙" },
  { valeur: "nuit", libelle: "Nuit", icone: "🌌" },
  { valeur: "orange", libelle: "Orange", icone: "🟠" },
  { valeur: "vert", libelle: "Vert", icone: "🟢" },
  { valeur: "bleu", libelle: "Bleu", icone: "🔵" },
  { valeur: "gris", libelle: "Gris", icone: "⚪" },
];

const CLE = "gs_admin_theme";

function valide(valeur: unknown): valeur is Theme {
  return THEMES.some((t) => t.valeur === valeur);
}

export function appliquerTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(CLE, theme);
  } catch {
    // stockage indisponible : le thème vaut pour cette page seulement
  }
}

/** Au démarrage, avant le premier rendu : dernier thème connu dans ce navigateur. */
export function initialiserTheme() {
  let enregistre: string | null = null;
  try {
    enregistre = localStorage.getItem(CLE);
  } catch {
    enregistre = null;
  }
  appliquerTheme(valide(enregistre) ? enregistre : "clair");
}

/** Thème du compte (reçu avec /admin/moi/). */
export function appliquerThemeDuCompte(theme: unknown) {
  if (valide(theme)) appliquerTheme(theme);
}

/** Choix de l'admin : appliqué tout de suite, puis enregistré sur son compte. */
export async function choisirTheme(theme: Theme): Promise<void> {
  appliquerTheme(theme);
  await api("/admin/moi/theme/", { method: "POST", body: JSON.stringify({ theme }) });
}
