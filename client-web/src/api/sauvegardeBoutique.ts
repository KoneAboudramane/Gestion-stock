import * as sauvegarde from "../services/sauvegarde";
import { obtenirBoutiqueInstallee, type AbonnementBoutique } from "../services/abonnementAdmin";
import { arreterBoucleCaisse } from "../services/reseau";
import { arreterPostePrincipal } from "../services/reseauPrincipal";
import type { ResultatEcriture } from "./transport";

/**
 * Appels de la fenêtre « Sauvegarde » (components/ModaleSauvegardeAdmin.tsx), avec
 * la même forme que `api` du bureau : la fenêtre reste une copie fidèle de
 * client-electron/src/components/ModaleSauvegardeAdmin.tsx (docs/plan_mobile_complet.md, lot 4).
 */

export type { CopieSauvegarde, EtatSauvegarde, ListeSauvegardes } from "../services/sauvegarde";
export type { AbonnementBoutique } from "../services/abonnementAdmin";

async function enResultat<T>(operation: () => Promise<T>): Promise<ResultatEcriture<T>> {
  try {
    return { succes: true, resultat: await operation() };
  } catch (e) {
    return { succes: false, message: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

/** Après une restauration : plus aucun échange par-dessus les données restaurées, puis l'appli se recharge. */
async function restaurerPuisRecharger<T>(operation: () => Promise<T>): Promise<ResultatEcriture<T>> {
  arreterBoucleCaisse();
  await arreterPostePrincipal().catch(() => {});
  const resultat = await enResultat(operation);
  if (resultat.succes) setTimeout(() => window.location.reload(), 1500);
  return resultat;
}

export const api = {
  admin: {
    boutiqueLocale: (): Promise<AbonnementBoutique | null> => obtenirBoutiqueInstallee(),
  },
  sauvegarde: {
    /** Pas d'explorateur de fichiers à ouvrir sur un téléphone : le bouton n'est pas proposé. */
    peutOuvrirDossier: false,
    etat: () => sauvegarde.etatSauvegarde(),
    lister: (dossier?: string | null) => sauvegarde.listerSauvegardes(dossier),
    ouvrirDossier: async (_dossier: string) => {},
    configurer: (params: Parameters<typeof sauvegarde.configurerSauvegarde>[0]) =>
      enResultat(() => sauvegarde.configurerSauvegarde(params)),
    modifierReglages: (params: Parameters<typeof sauvegarde.modifierReglagesSauvegarde>[0]) =>
      enResultat(() => sauvegarde.modifierReglagesSauvegarde(params)),
    changerMotDePasse: (motDePasse: string) => enResultat(() => sauvegarde.changerMotDePasseSauvegarde(motDePasse)),
    desactiver: () => sauvegarde.desactiverSauvegarde(),
    maintenant: () => enResultat(() => sauvegarde.sauvegarderMaintenant()),
    choisirDossier: () => sauvegarde.choisirDossier().catch(() => null),
    choisirFichier: () => sauvegarde.choisirFichier().catch(() => null),
    restaurer: (fichier: string, motDePasse: string) => restaurerPuisRecharger(() => sauvegarde.restaurerSauvegarde(fichier, motDePasse)),
    aUneCleSecours: (fichier: string) => sauvegarde.aUneCleSecours(fichier),
    restaurerAvecSecours: (fichier: string, username: string, password: string) =>
      restaurerPuisRecharger(() => sauvegarde.restaurerAvecSecours(fichier, username, password)),
  },
};
