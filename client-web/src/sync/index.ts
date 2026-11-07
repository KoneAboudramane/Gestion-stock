import type { Session } from "../api/auth";
import { apiFetch } from "../api/transport";
import { ouvrirBaseDeDonnees } from "../db";
import { recalculerStock } from "../db/helpers";
import { REGISTRE_CLIENT, type EntreeRegistreClient } from "../db/registre";
import { ecritureDeSuivi, INDEX_SEQ_RESEAU, INDEX_SYNCHRO_RESEAU } from "../db/suiviReseau";

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
 *
 * Le même moteur sert deux cibles (docs/plan_mobile_complet.md §4.3, comme le
 * bureau) : le serveur en ligne et le poste principal de la boutique (réseau
 * local), même contrat /sync/push/ + /sync/pull/. Seuls changent le transport,
 * la marque « envoyé » et ce qu'on transmet (voir CibleSynchro).
 */

const META_EXCLUES_VERS_SERVEUR = new Set([
  "id",
  "synchronise",
  "supprime",
  "date_synchronisation",
  "date_creation",
  "synchro_reseau",
  "seq_reseau",
]);

/**
 * Vers le poste principal, la ligne part entière (id, date de création,
 * suppression comprises) : il la recopie telle quelle. Seul le suivi propre à
 * chaque appareil reste.
 */
const META_EXCLUES_VERS_RESEAU = new Set(["synchronise", "date_synchronisation", "synchro_reseau", "seq_reseau"]);

/** Canal d'une synchronisation : vers le serveur en ligne ou vers le poste principal. */
export type CanalSynchro = "en_ligne" | "reseau";

/** Où vont les changements, et comment on les y envoie. */
export interface CibleSynchro {
  canal: CanalSynchro;
  /** Appel d'une route du contrat (« /sync/push/ »…) sur cette cible. */
  appeler: (chemin: string, options?: { method?: string; body?: string }) => Promise<Response>;
}

/** Le serveur en ligne (jeton de session, rafraîchi tout seul). */
export const CIBLE_EN_LIGNE: CibleSynchro = {
  canal: "en_ligne",
  appeler: (chemin, options) => apiFetch(chemin, options),
};

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

/** Ligne locale (colonnes `xxx_id`) → JSON attendu par le serveur ou le poste principal (clés `xxx`). */
export function versDonneesServeur(
  entree: EntreeRegistreClient,
  ligne: Record<string, unknown>,
  canal: CanalSynchro = "en_ligne",
): Record<string, unknown> {
  const exclues = canal === "en_ligne" ? META_EXCLUES_VERS_SERVEUR : META_EXCLUES_VERS_RESEAU;
  const donnees: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(ligne)) {
    if (exclues.has(cle)) continue;
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

/** Index des lignes pas encore envoyées à cette cible. */
function indexAEnvoyer(canal: CanalSynchro): string {
  return canal === "en_ligne" ? "synchronise" : INDEX_SYNCHRO_RESEAU;
}

/** Lignes pas encore envoyées à cette cible, au format du contrat /sync/push/. */
export async function construireChangements(canal: CanalSynchro = "en_ligne"): Promise<Changement[]> {
  const db = await ouvrirBaseDeDonnees();
  const changements: Changement[] = [];
  for (const entree of REGISTRE_CLIENT) {
    const lignes = await db.getAllFromIndex(entree.store as never, indexAEnvoyer(canal) as never, 0 as never);
    for (const ligne of lignes as Record<string, unknown>[]) {
      changements.push({
        table: entree.table,
        action: Number(ligne.supprime) ? "supprime" : "cree",
        enregistrement_id: String(ligne.id),
        donnees: versDonneesServeur(entree, ligne, canal),
      });
    }
  }
  return changements;
}

/** Marque comme envoyées à cette cible les lignes qu'elle a acceptées. */
async function marquerEnvoyes(canal: CanalSynchro, resultats: ResultatPush[]): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const maintenantIso = new Date().toISOString();
  for (const resultat of resultats) {
    if (resultat.statut !== "synchronise") continue;
    const entree = REGISTRE_CLIENT.find((e) => e.table === resultat.table);
    if (!entree) continue;
    const ligne = await db.get(entree.store as never, resultat.enregistrement_id);
    if (!ligne) continue;
    const marquee =
      canal === "en_ligne"
        ? ecritureDeSuivi({ ...(ligne as object), synchronise: 1, date_synchronisation: maintenantIso })
        : ecritureDeSuivi({ ...(ligne as object), synchro_reseau: 1 });
    await db.put(entree.store as never, marquee as never);
  }
}

export async function pousserVers(cible: CibleSynchro, appareil: string): Promise<ResultatPush[]> {
  const changements = await construireChangements(cible.canal);
  if (changements.length === 0) return [];

  const reponse = await cible.appeler("/sync/push/", {
    method: "POST",
    body: JSON.stringify({ appareil, changements }),
  });
  if (!reponse.ok) throw new Error(`Échec du push (HTTP ${reponse.status}).`);
  const { resultats } = (await reponse.json()) as { resultats: ResultatPush[] };
  await marquerEnvoyes(cible.canal, resultats);
  return resultats;
}

export async function pousser(): Promise<ResultatPush[]> {
  return pousserVers(CIBLE_EN_LIGNE, await idAppareil());
}

/** Réponse du contrat /sync/pull/ : `maintenant` est le curseur à renvoyer au prochain pull. */
export interface ReponsePull {
  maintenant: string;
  tables: { table: string; enregistrements: Record<string, unknown>[] }[];
}

/**
 * Recopie localement ce qu'une cible a renvoyé (dans l'ordre du registre) puis
 * recalcule le stock touché. Ce qui vient du poste principal est marqué envoyé
 * des deux côtés : c'est lui qui le relaie au serveur en ligne.
 */
export async function appliquerPull(corps: ReponsePull, canal: CanalSynchro = "en_ligne"): Promise<void> {
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
      if (canal === "reseau") ligne.synchro_reseau = 1;
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
}

export async function tirerDe(cible: CibleSynchro, depuis: string | null): Promise<string> {
  const chemin = depuis ? `/sync/pull/?depuis=${encodeURIComponent(depuis)}` : "/sync/pull/";
  const reponse = await cible.appeler(chemin);
  if (!reponse.ok) throw new Error(`Échec du pull (HTTP ${reponse.status}).`);
  const corps = (await reponse.json()) as ReponsePull;
  await appliquerPull(corps, cible.canal);
  return corps.maintenant;
}

export async function tirer(depuis: string | null): Promise<string> {
  return tirerDe(CIBLE_EN_LIGNE, depuis);
}

/** Un échange complet (envoyer puis recevoir) avec une cible ; renvoie le nouveau curseur. */
export async function synchroniserVers(
  cible: CibleSynchro,
  appareil: string,
  curseur: string | null,
): Promise<{ push: ResultatPush[]; curseur: string }> {
  const push = await pousserVers(cible, appareil);
  return { push, curseur: await tirerDe(cible, curseur) };
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

export async function idAppareil(): Promise<string> {
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

/** Changements locaux pas encore envoyés à cette cible, par type (ex. « ventes.Vente » → 3). */
export async function compterEnAttente(canal: CanalSynchro = "en_ligne"): Promise<{ table: string; nombre: number }[]> {
  const db = await ouvrirBaseDeDonnees();
  const resultat: { table: string; nombre: number }[] = [];
  for (const entree of REGISTRE_CLIENT) {
    const nombre = await db.countFromIndex(entree.store as never, indexAEnvoyer(canal) as never, 0 as never);
    if (nombre > 0) resultat.push({ table: entree.table, nombre });
  }
  return resultat.sort((a, b) => b.nombre - a.nombre);
}

export function etatSynchro(): { derniereSynchro: string | null } {
  const brut = localStorage.getItem(CLE_ETAT);
  if (!brut) return { derniereSynchro: null };
  return { derniereSynchro: lireEtat().derniereSynchro };
}

// --- Côté poste principal (servi aux caisses, docs/plan_mobile_complet.md lot 3) ---
// Port de recevoirChangements / extraireDepuis de client-electron/electron/services/sync.ts.

/**
 * Reçoit les changements d'une caisse : recopiés, laissés « à envoyer » au
 * serveur en ligne (le poste principal les relaie), stock recalculé. Même règle
 * et même réponse que le serveur Django : la DERNIÈRE modification gagne — une
 * version plus ancienne que celle du poste principal est refusée (« conflit »)
 * et la version gagnante reprend un numéro, pour que la caisse la reçoive à son
 * prochain pull.
 */
export async function recevoirChangements(changements: Changement[]): Promise<ResultatPush[]> {
  const db = await ouvrirBaseDeDonnees();
  const resultats: ResultatPush[] = [];
  const pairesStock = new Set<string>();
  for (const changement of changements) {
    const entree = REGISTRE_CLIENT.find((e) => e.table === changement.table);
    if (!entree) {
      resultats.push({ table: changement.table, enregistrement_id: changement.enregistrement_id, statut: "erreur", message: "Table inconnue." });
      continue;
    }
    const existante = (await db.get(entree.store as never, changement.enregistrement_id)) as Record<string, unknown> | undefined;
    // Vraies dates (le serveur écrit « +00:00 » et des microsecondes, l'appli « Z ») ; une date illisible ne bloque pas.
    const dateExistante = Date.parse(String(existante?.date_modification ?? ""));
    const dateRecue = Date.parse(String(changement.donnees.date_modification ?? ""));
    if (existante && dateExistante > dateRecue) {
      // Réécrite telle quelle : nouveau numéro d'écriture (db/suiviReseau.ts).
      await db.put(entree.store as never, existante as never);
      resultats.push({ table: changement.table, enregistrement_id: changement.enregistrement_id, statut: "conflit" });
      continue;
    }
    const ligne = versLigneLocale(entree, changement.donnees);
    ligne.id = changement.enregistrement_id;
    if (changement.action === "supprime") ligne.supprime = 1;
    if (ligne.supprime === undefined) ligne.supprime = 0;
    ligne.synchronise = 0;
    ligne.date_synchronisation = null;
    await db.put(entree.store as never, ligne as never);
    if (entree.table === "stock.MouvementStock") pairesStock.add(`${ligne.variante_id}::${ligne.depot_id}`);
    resultats.push({ table: changement.table, enregistrement_id: changement.enregistrement_id, statut: "synchronise" });
  }
  for (const paire of pairesStock) {
    const [varianteId, depotId] = paire.split("::");
    await recalculerStock(varianteId, depotId);
  }
  return resultats;
}

/**
 * Ce qu'une caisse n'a pas encore : les lignes dont le numéro d'écriture
 * (seq_reseau) dépasse son curseur — tout, au premier passage (curseur nul).
 * Le curseur renvoyé est le plus grand numéro servi.
 */
export async function extraireDepuis(depuis: string | null): Promise<ReponsePull> {
  const db = await ouvrirBaseDeDonnees();
  const seuil = depuis === null || depuis === "" ? null : Number(depuis);
  let curseur = seuil ?? 0;
  const tables: ReponsePull["tables"] = [];
  for (const entree of REGISTRE_CLIENT) {
    const lignes = (
      seuil === null
        ? await db.getAll(entree.store as never)
        : await db.getAllFromIndex(entree.store as never, INDEX_SEQ_RESEAU as never, IDBKeyRange.lowerBound(seuil, true) as never)
    ) as Record<string, unknown>[];
    if (lignes.length === 0) continue;
    lignes.sort((a, b) => Number(a.seq_reseau ?? 0) - Number(b.seq_reseau ?? 0));
    for (const ligne of lignes) curseur = Math.max(curseur, Number(ligne.seq_reseau ?? 0));
    tables.push({ table: entree.table, enregistrements: lignes.map((l) => versDonneesServeur(entree, l, "reseau")) });
  }
  return { maintenant: String(curseur), tables };
}
