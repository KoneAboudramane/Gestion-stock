import { sessionEnregistree } from "../contexts/SessionContext";
import { ouvrirBaseDeDonnees } from "../db";

/**
 * Port de client-electron/electron/services/numerotation.ts : numéros de
 * documents (ventes, commandes clients, commandes fournisseurs).
 *
 * Chaque poste numérote hors ligne sans voir les documents des autres : le
 * numéro contient donc le code vendeur de son auteur (unique dans la
 * boutique, attribué par le serveur : comptes/codes_vendeur.py), et le
 * compteur repart du plus grand numéro de cet auteur pour ce jour.
 *   VTE-20261002-AKO-0001
 * Reste possible : le même compte sur deux appareils hors ligne le même jour
 * (accepté, cas rare).
 */

/** Code vendeur de l'auteur du document (inconnu : l'utilisateur connecté). */
export function codeVendeur(utilisateurId: string | null): string {
  const session = sessionEnregistree();
  if (session && (utilisateurId === null || session.utilisateurId === utilisateurId)) {
    // Session enregistrée avant l'introduction du code : abréviation de l'identifiant.
    return session.codeVendeur || abreger(session.username);
  }
  return abreger(utilisateurId ?? "");
}

function abreger(texte: string): string {
  return (
    texte
      .normalize("NFD")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 3) || "X"
  );
}

/** Prochain numéro `PREFIXE-AAAAMMJJ-CODE-0001` de cet auteur dans `table`. */
export async function prochainNumero(
  table: "ventes" | "commandes_client" | "commandes_achat",
  prefixe: string,
  boutiqueId: string,
  utilisateurId: string | null,
): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const jour = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const debut = `${prefixe}-${jour}-${codeVendeur(utilisateurId)}-`;
  const documents = (await db.getAllFromIndex(table, "boutique_id", boutiqueId)) as { numero: string }[];
  const dernier = documents
    .filter((d) => d.numero.startsWith(debut))
    .reduce((max, d) => Math.max(max, Number(d.numero.slice(debut.length)) || 0), 0);
  return `${debut}${String(dernier + 1).padStart(4, "0")}`;
}
