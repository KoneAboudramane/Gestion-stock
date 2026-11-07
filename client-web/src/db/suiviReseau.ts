import { REGISTRE_CLIENT } from "./registre";

/**
 * Suivi des changements pour le réseau de la boutique — équivalent des
 * déclencheurs SQLite du bureau (client-electron/electron/db/reseau.ts ;
 * docs/plan_mobile_complet.md §4.2, docs/plan_reseau_local.md §4.4-4.5).
 *
 * Sur chaque table synchronisée :
 * - `synchro_reseau` : 1 = la ligne a été envoyée au poste principal ;
 * - `seq_reseau` : numéro d'écriture tiré d'un compteur local — un poste
 *   principal sert « tout ce qui a un numéro plus grand que N », sans se fier
 *   aux horloges des appareils.
 *
 * IndexedDB n'a pas de déclencheurs : on intercepte une fois pour toutes
 * `put` / `add` des magasins du registre (toutes les écritures y passent, celles
 * des services comme celles des transactions). Règles (mêmes effets que les
 * déclencheurs du bureau) :
 * - toute écriture prend un nouveau numéro (`seq_reseau`) — y compris ce que
 *   le poste principal reçoit du serveur en ligne, qu'il doit redistribuer ;
 * - une écriture avec `synchronise = 0` (convention de tous les services pour
 *   une modification) repasse aussi `synchro_reseau` à 0 : à envoyer au poste principal ;
 * - les écritures de pur suivi (marquer « envoyé ») sont signalées par
 *   `ecritureDeSuivi()` : elles passent telles quelles, sans nouveau numéro.
 */

const MAGASINS_SUIVIS = new Set<string>(REGISTRE_CLIENT.map((e) => e.store));
const CLE_COMPTEUR = "gestion-stock:compteur-reseau";
/** Marque (jamais enregistrée) d'une écriture de suivi qui garde `synchronise = 0`. */
const MARQUE_SUIVI = "__ecriture_de_suivi";

export const INDEX_SYNCHRO_RESEAU = "synchro_reseau";
export const INDEX_SEQ_RESEAU = "seq_reseau";

/** Prochain numéro d'écriture (le compteur ne fait qu'avancer). */
export function prochainNumeroReseau(): number {
  const valeur = Number(localStorage.getItem(CLE_COMPTEUR) ?? "0") + 1;
  localStorage.setItem(CLE_COMPTEUR, String(valeur));
  return valeur;
}

/** Dernier numéro distribué (curseur d'un poste principal qui n'a rien de plus récent). */
export function dernierNumeroReseau(): number {
  return Number(localStorage.getItem(CLE_COMPTEUR) ?? "0");
}

/** Ligne à écrire SANS la compter comme une modification (ex. marquée « envoyée au poste principal »). */
export function ecritureDeSuivi<T extends object>(ligne: T): T {
  return { ...ligne, [MARQUE_SUIVI]: true };
}

function marquer(magasin: string, valeur: unknown): unknown {
  if (!valeur || typeof valeur !== "object") return valeur;
  const ligne = valeur as Record<string, unknown>;
  // Marque retirée quel que soit le magasin (ex. restauration d'une sauvegarde, qui écrit tout).
  if (MARQUE_SUIVI in ligne) {
    const { [MARQUE_SUIVI]: _marque, ...reste } = ligne;
    return reste;
  }
  if (!MAGASINS_SUIVIS.has(magasin)) return valeur;
  if (ligne.synchronise !== 0) return { ...ligne, seq_reseau: prochainNumeroReseau() };
  return { ...ligne, synchro_reseau: 0, seq_reseau: prochainNumeroReseau() };
}

let installe = false;

/** À appeler avant la première ouverture de la base (idempotent). */
export function installerSuiviReseau(): void {
  if (installe || typeof IDBObjectStore === "undefined") return;
  installe = true;
  const putOriginal = IDBObjectStore.prototype.put;
  const addOriginal = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, valeur: unknown, cle?: IDBValidKey) {
    const marquee = marquer(this.name, valeur);
    return cle === undefined ? putOriginal.call(this, marquee) : putOriginal.call(this, marquee, cle);
  };
  IDBObjectStore.prototype.add = function (this: IDBObjectStore, valeur: unknown, cle?: IDBValidKey) {
    const marquee = marquer(this.name, valeur);
    return cle === undefined ? addOriginal.call(this, marquee) : addOriginal.call(this, marquee, cle);
  };
}
