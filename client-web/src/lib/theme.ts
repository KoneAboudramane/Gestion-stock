export type Theme = "clair" | "sombre" | "nuit" | "orange" | "vert" | "bleu" | "gris";

const CLE_STOCKAGE = "gs_theme";
const THEMES_VALIDES: Theme[] = ["clair", "sombre", "nuit", "orange", "vert", "bleu", "gris"];

/** Préférence d'affichage de l'appareil, pas une donnée de boutique : stockée en local, pas synchronisée. */
export function themeActuel(): Theme {
  const valeur = localStorage.getItem(CLE_STOCKAGE);
  return THEMES_VALIDES.includes(valeur as Theme) ? (valeur as Theme) : "sombre";
}

export function appliquerTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(CLE_STOCKAGE, theme);
}

/** À appeler une fois au démarrage, avant le premier rendu, pour éviter un flash du thème clair. */
export function initialiserTheme() {
  appliquerTheme(themeActuel());
}
