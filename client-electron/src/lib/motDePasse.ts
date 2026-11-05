// Mots de passe choisis dans l'appli (Espace Admin → Réinitialiser mot de passe,
// premier choix après un mot de passe provisoire) : génération lisible et
// solidité affichée. Les règles réelles sont celles du serveur (validateurs
// Django : 8 caractères au moins, pas seulement des chiffres, pas trop courant,
// pas trop proche de l'identifiant).

const CONSONNES = "bcdfgklmnprstvz";
const VOYELLES = "aeiou";

function aleatoire(max: number): number {
  const tableau = new Uint32Array(1);
  crypto.getRandomValues(tableau);
  return tableau[0] % max;
}

function motPrononcable(syllabes: number): string {
  let mot = "";
  for (let i = 0; i < syllabes; i++) mot += CONSONNES[aleatoire(CONSONNES.length)] + VOYELLES[aleatoire(VOYELLES.length)];
  return mot.charAt(0).toUpperCase() + mot.slice(1);
}

/** « Kalumo-Bitesa-4827 » : facile à lire et à dicter, solide (≈ 60 bits). */
export function genererMotDePasse(): string {
  return `${motPrononcable(3)}-${motPrononcable(3)}-${String(aleatoire(10000)).padStart(4, "0")}`;
}

export interface SoliditeMotDePasse {
  /** 0 (vide) à 4 (très bon). */
  score: number;
  libelle: string;
  /** Règles du serveur non respectées (à afficher). */
  manques: string[];
}

export function soliditeMotDePasse(motDePasse: string, identifiant = ""): SoliditeMotDePasse {
  const manques: string[] = [];
  if (motDePasse.length < 8) manques.push("8 caractères au moins");
  if (/^\d+$/.test(motDePasse)) manques.push("pas seulement des chiffres");
  if (identifiant && motDePasse.toLowerCase().includes(identifiant.toLowerCase())) manques.push("ne pas contenir l'identifiant");
  if (!motDePasse) return { score: 0, libelle: "", manques };
  let score = 0;
  if (motDePasse.length >= 8) score++;
  if (motDePasse.length >= 12) score++;
  if (/[a-z]/.test(motDePasse) && /[A-Z]/.test(motDePasse)) score++;
  if (/\d/.test(motDePasse) && /[^A-Za-z0-9]/.test(motDePasse)) score++;
  if (manques.length) score = Math.min(score, 1);
  const libelle = ["Trop faible", "Faible", "Moyen", "Bon", "Très bon"][Math.max(0, Math.min(4, score))];
  return { score: Math.max(1, score), libelle, manques };
}
