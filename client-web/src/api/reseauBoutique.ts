import * as reseau from "../services/reseau";
import * as principal from "../services/reseauPrincipal";
import { etatSauvegarde } from "../services/sauvegarde";
import { compterEnAttente } from "../sync";
import { obtenirBoutiqueInstallee } from "../services/abonnementAdmin";
import { rafraichirPermissions, type Session } from "./auth";
import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Appels de la fenêtre « Réseau de la boutique » (components/ModaleReseauBoutique.tsx),
 * avec la même forme que `api` du bureau : la fenêtre reste ainsi une copie
 * fidèle de client-electron/src/components/ModaleReseauBoutique.tsx
 * (docs/plan_mobile_complet.md, lot 2).
 *
 * Cet appareil peut être CAISSE (lot 2) ou POSTE PRINCIPAL (lot 3) ; la
 * sauvegarde arrive au lot 4.
 */

export type { EtatReseau, PostePrincipalTrouve } from "../services/reseau";
export type { Session } from "./auth";

/** Réseau de la boutique : activé ou non, demande d'activation en cours. */
export interface EtatDemandeReseau {
  reseau_autorise: boolean;
  demande_en_attente: string | null;
  whatsapp: string;
}

/** Sauvegarde de l'appareil (lot 4 — pas encore sur mobile). */
export interface EtatSauvegarde {
  configuree: boolean;
  dossier: string | null;
  heure: string | null;
  conservation: "progressive" | "illimitee" | null;
  prochaine: string | null;
  secours: boolean;
  derniereSauvegarde: string | null;
  dernierFichier: string | null;
  derniereErreur: string | null;
  echecsConsecutifs: number;
  alerte: "aucune" | "echecs" | "ancienne";
}

async function enResultat<T>(operation: () => Promise<T>): Promise<ResultatEcriture<T>> {
  try {
    return { succes: true, resultat: await operation() };
  } catch (e) {
    return { succes: false, message: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

export const api = {
  comptes: {
    etatDemandeReseau: (_session: Session): Promise<ResultatEcriture<EtatDemandeReseau>> =>
      executerEnSecurite(async () => {
        const reponse = await apiFetch("/boutique/reseau/");
        if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
        return (await reponse.json()) as EtatDemandeReseau;
      }),
    demanderActivationReseau: (_session: Session, note: string): Promise<ResultatEcriture<EtatDemandeReseau>> =>
      executerEnSecurite(async () => {
        const reponse = await apiFetch("/boutique/reseau/", { method: "POST", body: JSON.stringify({ note }) });
        if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
        return (await reponse.json()) as EtatDemandeReseau;
      }),
  },
  auth: {
    /** Relit l'activation du réseau (écrite sur l'appareil par /auth/moi/). */
    rafraichirPermissions: (session: Session) => rafraichirPermissions(session),
  },
  systeme: {
    ouvrirExterne: (url: string) => {
      window.open(url, "_blank", "noopener");
    },
  },
  sauvegarde: {
    etat: (): Promise<EtatSauvegarde> => etatSauvegarde(),
  },
  admin: {
    /** Boutique déjà installée sur cet appareil (ou aucune : appareil neuf). */
    boutiqueLocale: () => obtenirBoutiqueInstallee(),
  },
  sync: {
    enAttente: (_boutiqueId: string) => compterEnAttente("en_ligne"),
  },
  reseau: {
    etat: () => reseau.etatReseauComplet(),
    rechercher: () => reseau.rechercherPostesPrincipaux(),
    seBrancher: (params: { adresse: string; code: string; boutiqueId: string; nomAppareil?: string }) =>
      enResultat(() => reseau.seBrancher(params)),
    seDebrancher: () => reseau.seDebrancher(),
    synchroniser: async () => {
      await reseau.synchroniserAvecPrincipal();
      return reseau.etatReseauComplet();
    },
    rejoindreAvantConnexion: (params: { adresse: string; code: string; nomAppareil?: string }) =>
      enResultat(() => reseau.rejoindreAvantConnexion(params)),
    // Poste principal (lot 3).
    devenirPrincipal: (params: { boutiqueId: string; boutiqueNom: string; nomPoste?: string }) =>
      enResultat(() => principal.devenirPostePrincipal(params)),
    quitterPrincipal: () => enResultat(() => principal.quitterPostePrincipal()),
    mettreEnPause: () => enResultat(() => principal.mettreEnPausePostePrincipal()),
    reprendre: () => enResultat(() => principal.reprendrePostePrincipal()),
    redemarrer: () => enResultat(() => principal.redemarrerPostePrincipal()),
    nouveauCode: async () => principal.nouveauCodeAppairage(),
    annulerCode: async () => principal.annulerCodeAppairage(),
    debrancher: (appareilId: string) => principal.debrancherAppareil(appareilId),
  },
};
