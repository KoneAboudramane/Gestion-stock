/**
 * Formate un montant avec une espace tous les 3 chiffres pour la lisibilité
 * (ex: 1234567 -> "1 234 567"). Utilisé pour tout affichage de prix/montant
 * (totaux, tickets, tableaux) et pour les champs de saisie via ChampMontant.
 */
export function formaterMontant(valeur: number | string): string {
  if (valeur === "" || valeur === null || valeur === undefined) return "";
  const nombre = typeof valeur === "string" ? Number(valeur) : valeur;
  if (!Number.isFinite(nombre)) return String(valeur);
  const negatif = nombre < 0;
  const [entier, decimales] = Math.abs(nombre).toString().split(".");
  const entierEspace = entier.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (negatif ? "-" : "") + entierEspace + (decimales ? "," + decimales : "");
}

/** Retire les espaces d'un montant saisi (formaté) pour retrouver la valeur numérique brute. */
export function nettoyerMontantSaisi(texte: string): string {
  return texte.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.]/g, "");
}

/**
 * Format international E.164 exigé pour les téléphones (ex. +2250712345678) :
 * indispensable pour que les liens WhatsApp (wa.me) retrouvent le bon contact.
 */
export function telephoneValide(telephone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(telephone.trim());
}

/** Le "+" est ajouté automatiquement : l'utilisateur ne saisit que les chiffres (indicatif + numéro). */
export function normaliserTelephone(saisie: string): string {
  const chiffres = saisie.replace(/\D/g, "");
  return chiffres ? `+${chiffres}` : "";
}
