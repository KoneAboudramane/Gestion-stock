import type { Session } from "../api/auth";
import { apiFetch } from "../api/transport";
import { ouvrirBaseDeDonnees } from "../db";
import { recalculerStock } from "../db/helpers";
import { REGISTRE_CLIENT, type EntreeRegistreClient } from "../db/registre";

/**
 * Moteur de synchronisation, port navigateur de
 * client-electron/electron/services/sync.ts (même contrat HTTP
 * `/sync/push/` + `/sync/pull/`, même registre parent-avant-enfant) :
 * push = upsert des lignes locales non encore synchronisées ; pull = upsert
 * des enregistrements renvoyés par le serveur ; conflits déjà résolus
 * côté serveur (dernier gagne) — le client applique simplement le résultat.
 *
 * Différence avec Electron : passe par `apiFetch` (client-web/src/api/transport.ts)
 * plutôt que fetch+Authorization manuel, donc bénéficie gratuitement du
 * rafraîchissement de jeton sur 401 déjà implémenté là-bas.
 */

const META_EXCLUES_VERS_SERVEUR = new Set(["id", "synchronise", "supprime", "date_synchronisation", "date_creation"]);

export interface Changement {
  table: string;
  action: "cree" | "modifie" | "supprime";
  enregistrement_id: string;
  donnees: Record<string, unknown>;
}

export interface ResultatPush {
  table: string;
  enregistrement_id: string;
  statut: "synchronise" | "conflit" | "erreur";
  message?: string;
}

/** Ligne locale (colonnes `xxx_id`) → JSON attendu par le serveur (clés `xxx`). */
export function versDonneesServeur(entree: EntreeRegistreClient, ligne: Record<string, unknown>): Record<string, unknown> {
  const donnees: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(ligne)) {
    if (META_EXCLUES_VERS_SERVEUR.has(cle)) continue;
    const estFK = cle.endsWith("_id") && entree.champsFK.includes(cle.slice(0, -3));
    donnees[estFK ? cle.slice(0, -3) : cle] = valeur;
  }
  return donnees;
}

/** JSON du serveur (clés `xxx`) → ligne locale (colonnes `xxx_id`, booléens en 0/1, DecimalField en number). */
export function versLigneLocale(entree: EntreeRegistreClient, donnees: Record<string, unknown>): Record<string, unknown> {
  const ligne: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(donnees)) {
    const colonneLocale = entree.champsFK.includes(cle) ? `${cle}_id` : cle;
    if (typeof valeur === "boolean") {
      ligne[colonneLocale] = valeur ? 1 : 0;
    } else if (entree.champsNumeriques?.includes(cle) && typeof valeur === "string") {
      ligne[colonneLocale] = Number(valeur);
    } else {
      ligne[colonneLocale] = valeur;
    }
  }
  return ligne;
}

async function construireChangements(): Promise<Changement[]> {
  const db = await ouvrirBaseDeDonnees();
  const changements: Changement[] = [];
  for (const entree of REGISTRE_CLIENT) {
    const lignes = await db.getAllFromIndex(entree.store as never, "synchronise" as never, 0 as never);
    for (const ligne of lignes as Record<string, unknown>[]) {
      changements.push({
        table: entree.table,
        action: Number(ligne.supprime) ? "supprime" : "cree",
        enregistrement_id: String(ligne.id),
        donnees: versDonneesServeur(entree, ligne),
      });
    }
  }
  return changements;
}

export async function pousser(): Promise<ResultatPush[]> {
  const changements = await construireChangements();
  if (changements.length === 0) return [];

  const reponse = await apiFetch("/sync/push/", {
    method: "POST",
    body: JSON.stringify({ appareil: await idAppareil(), changements }),
  });
  if (!reponse.ok) throw new Error(`Échec du push (HTTP ${reponse.status}).`);
  const { resultats } = (await reponse.json()) as { resultats: ResultatPush[] };

  const db = await ouvrirBaseDeDonnees();
  const maintenantIso = new Date().toISOString();
  for (const resultat of resultats) {
    if (resultat.statut !== "synchronise") continue;
    const entree = REGISTRE_CLIENT.find((e) => e.table === resultat.table);
    if (!entree) continue;
    const ligne = await db.get(entree.store as never, resultat.enregistrement_id);
    if (!ligne) continue;
    await db.put(entree.store as never, {
      ...(ligne as object),
      synchronise: 1,
      date_synchronisation: maintenantIso,
    } as never);
  }

  return resultats;
}

export async function tirer(depuis: string | null): Promise<string> {
  const chemin = depuis ? `/sync/pull/?depuis=${encodeURIComponent(depuis)}` : "/sync/pull/";
  const reponse = await apiFetch(chemin);
  if (!reponse.ok) throw new Error(`Échec du pull (HTTP ${reponse.status}).`);
  const corps = (await reponse.json()) as {
    maintenant: string;
    tables: { table: string; enregistrements: Record<string, unknown>[] }[];
  };

  const db = await ouvrirBaseDeDonnees();
  const maintenantIso = new Date().toISOString();
  const pairesStock = new Set<string>();

  for (const tableReponse of corps.tables) {
    const entree = REGISTRE_CLIENT.find((e) => e.table === tableReponse.table);
    if (!entree) continue;

    for (const enr of tableReponse.enregistrements) {
      const ligne = versLigneLocale(entree, enr);
      ligne.synchronise = 1;
      ligne.date_synchronisation = maintenantIso;
      await db.put(entree.store as never, ligne as never);

      if (entree.table === "stock.MouvementStock") {
        pairesStock.add(`${ligne.variante_id}::${ligne.depot_id}`);
      }
    }
  }

  for (const paire of pairesStock) {
    const [varianteId, depotId] = paire.split("::");
    await recalculerStock(varianteId, depotId);
  }

  return corps.maintenant;
}

// --- État de synchro persisté (appareil, curseur, dernière synchro) ---

const CLE_ETAT = "gestion-stock:sync-etat";

interface EtatSync {
  appareilId: string;
  dernierCurseur: string | null;
  derniereSynchro: string | null;
}

function lireEtat(): EtatSync {
  try {
    const brut = localStorage.getItem(CLE_ETAT);
    if (brut) return JSON.parse(brut) as EtatSync;
  } catch {
    // valeur corrompue : on repart d'un état neuf ci-dessous
  }
  const nouveau: EtatSync = { appareilId: crypto.randomUUID(), dernierCurseur: null, derniereSynchro: null };
  localStorage.setItem(CLE_ETAT, JSON.stringify(nouveau));
  return nouveau;
}

function ecrireEtat(etat: EtatSync): void {
  localStorage.setItem(CLE_ETAT, JSON.stringify(etat));
}

async function idAppareil(): Promise<string> {
  return lireEtat().appareilId;
}

export interface ResumeSynchro {
  push: ResultatPush[];
  derniereSynchro: string;
}

// Verrou au niveau du module (pas juste du composant) : React StrictMode
// double-invoque les effets en dev, et plusieurs déclencheurs (montage,
// intervalle, retour en ligne, bouton) peuvent coïncider — sans ce verrou,
// plusieurs push+pull tournent en parallèle sur la même base IndexedDB.
let synchronisationEnCours: Promise<ResumeSynchro> | null = null;

/**
 * Activée uniquement par l'administrateur pour la boutique (comptes.Boutique.
 * synchro_autorisee, voir comptes/models.py côté backend) — certains
 * commerçants ne veulent pas que leurs données quittent leur poste. Vérifié
 * ici (avant tout appel réseau) plutôt que de laisser échouer sur un 403 du
 * serveur, qui gate quand même push/pull en dernier ressort (voir
 * core/permissions.py::SynchroAutorisee) au cas où la session serait périmée.
 */
export class SynchroNonAutoriseeError extends Error {}

export function synchroniser(session: Session): Promise<ResumeSynchro> {
  if (!session.synchroAutorisee) {
    return Promise.reject(
      new SynchroNonAutoriseeError(
        "La synchronisation n'est pas encore activée pour votre boutique. Contactez l'administrateur pour l'activer.",
      ),
    );
  }
  if (synchronisationEnCours) return synchronisationEnCours;
  synchronisationEnCours = (async () => {
    try {
      const etat = lireEtat();
      const resultatsPush = await pousser();
      const curseur = await tirer(etat.dernierCurseur);
      const derniereSynchro = new Date().toISOString();
      ecrireEtat({ ...etat, dernierCurseur: curseur, derniereSynchro });
      return { push: resultatsPush, derniereSynchro };
    } finally {
      synchronisationEnCours = null;
    }
  })();
  return synchronisationEnCours;
}

export function etatSynchro(): { derniereSynchro: string | null } {
  const brut = localStorage.getItem(CLE_ETAT);
  if (!brut) return { derniereSynchro: null };
  return { derniereSynchro: lireEtat().derniereSynchro };
}
