import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { URL_BASE_API } from "../config";

import * as abonnement from "../services/abonnement";
import * as abonnementAdmin from "../services/abonnementAdmin";
import * as achats from "../services/achats";
import * as alertesSysteme from "../services/alertesSysteme";
import * as auth from "../services/auth";
import { unResultat } from "../db/helpers";
import * as clients from "../services/clients";
import * as comptabilite from "../services/comptabilite";
import * as comptes from "../services/comptes";
import * as comptesTiers from "../services/comptesTiers";
import * as commandesClient from "../services/commandesClient";
import * as exportService from "../services/export";
import * as inscriptionLocale from "../services/inscriptionLocale";
import * as messages from "../services/messages";
import * as notifications from "../services/notifications";
import * as paiements from "../services/paiements";
import * as rapports from "../services/rapports";
import * as recettes from "../services/recettes";
import * as reseauCaisse from "../services/reseauCaisse";
import * as reseauPrincipal from "../services/reseauPrincipal";
import * as sauvegarde from "../services/sauvegarde";
import * as reglages from "../services/reglages";
import * as catalogue from "../services/catalogue";
import * as produits from "../services/produits";
import * as stock from "../services/stock";
import * as sync from "../services/sync";
import * as tresorerie from "../services/tresorerie";
import * as ventes from "../services/ventes";

/** Popup système "best-effort" : une panne ici ne doit jamais faire échouer l'opération métier qui vient de réussir. */
function signalerRuptureEnSecurite(depotId: string): void {
  try {
    alertesSysteme.signalerNouvellesAlertesRupture(depotId);
  } catch {
    // Ignoré volontairement (ex. Notification non supportée sur ce poste).
  }
}

/** Convertit une exception en message affichable : les erreurs réseau brutes (ex. "fetch failed",
 * levées par le fetch natif de Node quand le serveur est injoignable) sont remplacées par un
 * message compréhensible, puisque l'appli fonctionne aussi hors-ligne. */
const MESSAGES_TRADUITS: [RegExp, string][] = [
  [/no active account found with the given credentials/i, "Nom d'utilisateur ou mot de passe incorrect."],
  [/this field may not be blank/i, "Ce champ est obligatoire."],
  [/this field is required/i, "Ce champ est obligatoire."],
  [/user with this username already exists/i, "Ce nom d'utilisateur est déjà pris."],
  [/user with this email already exists/i, "Cet email est déjà utilisé."],
];

function messageErreur(erreur: unknown): string {
  const brut = erreur instanceof Error ? erreur.message : String(erreur);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(brut)) {
    return "Impossible de joindre le serveur. Vérifiez votre connexion internet.";
  }
  const traduction = MESSAGES_TRADUITS.find(([motif]) => motif.test(brut));
  return traduction ? traduction[1] : brut;
}

/** Petit wrapper commun : transforme une exception métier en réponse {succes:false} plutôt que de faire planter l'appel IPC. */
function executerEnSecurite<T>(operation: () => T): { succes: true; resultat: T } | { succes: false; message: string } {
  try {
    return { succes: true, resultat: operation() };
  } catch (erreur) {
    return { succes: false, message: messageErreur(erreur) };
  }
}

/** Synchro best-effort après connexion : échec silencieux si hors-ligne — l'appli reste utilisable hors-ligne. */
async function tenterSynchroApresConnexion(session: auth.Session): Promise<void> {
  try {
    await sync.synchroniser(session);
  } catch {
    // Pas de réseau ou serveur injoignable : pas grave, l'utilisateur pourra
    // relancer manuellement via le bouton "Synchroniser" de la barre de synchro.
  }
}

/**
 * Mémorise dans le cache local un compte que le patron vient de créer ou de
 * modifier (réseau de la boutique : le poste principal le transmet aux caisses).
 * Jamais bloquant : l'opération en ligne a déjà réussi.
 */
async function memoriserCompteDepuisServeur(
  session: auth.Session,
  utilisateur: comptes.UtilisateurResume,
  motDePasse: string | null,
): Promise<void> {
  try {
    const role = utilisateur.role
      ? (await comptes.listerRoles(session).catch(() => [])).find((r) => String(r.id) === String(utilisateur.role))
      : undefined;
    const depot = utilisateur.depot
      ? unResultat<{ nom: string }>("SELECT nom FROM depots WHERE id = ?", [utilisateur.depot])
      : undefined;
    auth.memoriserCompteVendeur(utilisateur.username, motDePasse, {
      utilisateurId: String(utilisateur.id),
      username: utilisateur.username,
      boutiqueId: session.boutiqueId,
      boutiqueNom: session.boutiqueNom,
      role: role?.nom ?? "",
      permissions: role?.permissions ?? {},
      depotId: utilisateur.depot,
      depotNom: depot?.nom ?? null,
      synchroAutorisee: session.synchroAutorisee,
      codeVendeur: utilisateur.code_vendeur || undefined,
    });
  } catch {
    // cache illisible ou base pas prête : le vendeur se connectera une fois en ligne
  }
}

export function enregistrerLesHandlers(): void {
  ipcMain.handle("auth:connexion", async (_evt, username: string, password: string) => {
    try {
      const session = await auth.connexion(username, password);
      await tenterSynchroApresConnexion(session);
      return { succes: true as const, resultat: session };
    } catch (erreur) {
      return { succes: false as const, message: messageErreur(erreur) };
    }
  });

  ipcMain.handle(
    "auth:inscription",
    async (_evt, params: { boutiqueNom: string; username: string; password: string; email: string }) => {
      try {
        await auth.inscription(params);
        return { succes: true as const, resultat: undefined };
      } catch (erreur) {
        return { succes: false as const, message: messageErreur(erreur) };
      }
    },
  );

  ipcMain.handle("auth:verifierAccesAdmin", async (_evt, username: string, password: string) => {
    try {
      return { succes: true as const, resultat: await auth.verifierAccesAdmin(username, password) };
    } catch (erreur) {
      return { succes: false as const, message: messageErreur(erreur) };
    }
  });
  ipcMain.handle("auth:etatConnexionAdmin", () => auth.etatConnexionAdmin());
  ipcMain.handle("auth:etatPosteConnexion", () => auth.etatPosteConnexion());
  ipcMain.handle("auth:connexionAdmin", (_evt, username: string, password: string) =>
    executerEnSecuriteAsync(() => auth.connexionAdmin(username, password)),
  );
  ipcMain.handle("auth:connexionAdminParLaissezPasser", (_evt, code: string, username: string, password: string) =>
    executerEnSecuriteAsync(() => auth.connexionAdminParLaissezPasser(code, username, password)),
  );
  ipcMain.handle(
    "auth:genererLaissezPasser",
    (_evt, username: string, password: string, dureeJours: number | null) =>
      executerEnSecuriteAsync(async () => (await import("../services/laissezPasser")).genererLaissezPasser(username, password, dureeJours)),
  );
  ipcMain.handle("auth:listerLaissezPasser", (_evt, username: string, password: string) =>
    executerEnSecuriteAsync(async () => (await import("../services/laissezPasser")).listerLaissezPasser(username, password)),
  );
  ipcMain.handle("auth:revoquerLaissezPasser", (_evt, username: string, password: string, id: string) =>
    executerEnSecuriteAsync(async () => (await import("../services/laissezPasser")).revoquerLaissezPasser(username, password, id)),
  );
  ipcMain.handle("auth:signalerLaissezPasser", async () => {
    try {
      await auth.signalerLaissezPasser();
    } catch {
      // silencieux : réessayé à la prochaine ouverture de l'Espace Admin
    }
  });
  ipcMain.handle("auth:verifierRevocationAdmin", async () => {
    try {
      await auth.verifierRevocationAdmin();
    } catch {
      // Best-effort : ne doit jamais faire échouer l'ouverture d'Espace Admin.
    }
  });

  ipcMain.handle(
    "auth:reinitialiserMotDePasseAdmin",
    async (
      _evt,
      usernameAdmin: string,
      passwordAdmin: string,
      usernameCible: string,
      nouveauMotDePasse: string,
      doitChanger?: boolean,
    ) => {
      try {
        return {
          succes: true as const,
          resultat: await auth.reinitialiserMotDePasseAdmin(usernameAdmin, passwordAdmin, usernameCible, nouveauMotDePasse, doitChanger),
        };
      } catch (erreur) {
        return { succes: false as const, message: messageErreur(erreur) };
      }
    },
  );

  ipcMain.handle("auth:listerPatrons", async (_evt, usernameAdmin: string, passwordAdmin: string) =>
    auth.listerPatrons(usernameAdmin, passwordAdmin),
  );
  ipcMain.handle("auth:listerComptesAdmin", (_evt, usernameAdmin: string, passwordAdmin: string) =>
    executerEnSecuriteAsync(() => auth.listerComptesAdmin(usernameAdmin, passwordAdmin)),
  );
  ipcMain.handle("auth:reinitialisationsARefaire", () => auth.lireReinitialisationsARefaire());
  ipcMain.handle("auth:changerMotDePasse", (_evt, session: auth.Session, nouveau: string, ancien?: string) =>
    executerEnSecuriteAsync(() => auth.changerMotDePasse(session, nouveau, ancien)),
  );

  ipcMain.handle("abonnement:etat", (_evt, boutiqueId: string) => abonnement.obtenirEtatAbonnement(boutiqueId));
  // Code d'activation (docs/plan_reseau_local.md, lot 6) : vérifié sans internet.
  ipcMain.handle("abonnement:activerParCode", (_evt, boutiqueId: string, code: string) =>
    executerEnSecurite(() => abonnement.activerParCode(boutiqueId, code)),
  );
  ipcMain.handle("admin:boutiqueLocale", () => abonnementAdmin.obtenirBoutiqueLocale());
  ipcMain.handle("admin:abonnementEnAttente", () => abonnementAdmin.lireAbonnementEnAttente());
  ipcMain.handle(
    "admin:detailAbonnement",
    (
      _evt,
      username: string,
      password: string,
      boutiqueId: string,
      action?: "valider" | "rejeter" | "code",
      params?: { demandeId?: string; motif?: string },
    ) => executerEnSecuriteAsync(() => abonnementAdmin.detailAbonnementAdmin(username, password, boutiqueId, action, params)),
  );
  ipcMain.handle(
    "admin:etatReseau",
    (_evt, username: string, password: string, boutiqueId: string, action?: "refuser") =>
      executerEnSecuriteAsync(() => abonnementAdmin.etatReseauAdmin(username, password, boutiqueId, action)),
  );
  ipcMain.handle(
    "admin:soumettreAbonnement",
    async (
      _evt,
      username: string,
      password: string,
      boutiqueId: string,
      boutiqueNom: string,
      champs: abonnementAdmin.ChampsAbonnement,
    ) => {
      try {
        return {
          succes: true as const,
          resultat: await abonnementAdmin.soumettreAbonnement(username, password, boutiqueId, boutiqueNom, champs),
        };
      } catch (erreur) {
        return { succes: false as const, message: messageErreur(erreur) };
      }
    },
  );

  ipcMain.handle(
    "admin:creerBoutiqueLocale",
    (_evt, params: inscriptionLocale.ParametresCreationBoutique) =>
      executerEnSecurite(() => inscriptionLocale.creerBoutiqueLocale(params)),
  );
  ipcMain.handle(
    "admin:creerBoutiqueEnLigne",
    async (
      _evt,
      usernameAdmin: string,
      passwordAdmin: string,
      params: inscriptionLocale.ParametresCreationBoutique,
    ) => {
      try {
        return {
          succes: true as const,
          resultat: await inscriptionLocale.creerBoutiqueEnLigne(usernameAdmin, passwordAdmin, params),
        };
      } catch (erreur) {
        return { succes: false as const, message: messageErreur(erreur) };
      }
    },
  );
  ipcMain.handle("admin:boutiqueLocaleEnAttente", () => inscriptionLocale.lireBoutiqueLocaleEnAttente());
  ipcMain.handle("admin:identifiantDisponible", (_evt, usernameAdmin: string, passwordAdmin: string, identifiant: string) =>
    inscriptionLocale.identifiantDisponible(usernameAdmin, passwordAdmin, identifiant),
  );
  ipcMain.handle(
    "admin:activerEnLigne",
    async (_evt, usernameAdmin: string, passwordAdmin: string, patronPassword: string, session: auth.Session) => {
      try {
        return {
          succes: true as const,
          resultat: await inscriptionLocale.activerEnLigne(usernameAdmin, passwordAdmin, patronPassword, session),
        };
      } catch (erreur) {
        return { succes: false as const, message: messageErreur(erreur) };
      }
    },
  );

  ipcMain.handle("auth:session", () => auth.sessionActuelle());
  ipcMain.handle("auth:deconnexion", () => auth.deconnexion());
  ipcMain.handle("auth:rafraichirPermissions", (_evt, session: auth.Session) => auth.rafraichirPermissions(session));
  ipcMain.handle("auth:demanderReinitialisationMotDePasse", async (_evt, email: string) => {
    try {
      return { succes: true as const, resultat: await auth.demanderReinitialisationMotDePasse(email) };
    } catch (erreur) {
      return { succes: false as const, message: messageErreur(erreur) };
    }
  });
  ipcMain.handle(
    "auth:reinitialiserMotDePasse",
    async (_evt, email: string, code: string, nouveauMotDePasse: string) => {
      try {
        return {
          succes: true as const,
          resultat: await auth.reinitialiserMotDePasse(email, code, nouveauMotDePasse),
        };
      } catch (erreur) {
        return { succes: false as const, message: messageErreur(erreur) };
      }
    },
  );

  ipcMain.handle("catalogue:rechercherVariantes", (_evt, boutiqueId: string, terme: string) =>
    catalogue.rechercherVariantes(boutiqueId, terme),
  );
  ipcMain.handle("catalogue:listerVariantesActives", (_evt, boutiqueId: string) =>
    catalogue.listerVariantesActives(boutiqueId),
  );
  ipcMain.handle("catalogue:listerVariantesCatalogue", (_evt, boutiqueId: string, depotId?: string) =>
    catalogue.listerVariantesCatalogue(boutiqueId, depotId),
  );
  ipcMain.handle("catalogue:listerDepots", (_evt, boutiqueId: string) =>
    catalogue.listerDepots(boutiqueId),
  );
  ipcMain.handle("catalogue:listerClients", (_evt, boutiqueId: string) =>
    catalogue.listerClients(boutiqueId),
  );
  ipcMain.handle("catalogue:obtenirStock", (_evt, varianteId: string, depotId: string) =>
    catalogue.obtenirStock(varianteId, depotId),
  );

  ipcMain.handle("ventes:creer", async (_evt, params: ventes.ParametresVente) => {
    try {
      // Caisse reliée : article presque en rupture → on demande d'abord au poste principal.
      await reseauCaisse.verifierStockAvantVente(params);
      const vente = ventes.creerVente(params);
      signalerRuptureEnSecurite(params.depotId);
      // La vente part tout de suite au poste principal (sans attendre le tour suivant).
      void reseauCaisse.synchroniserAvecPrincipal();
      return { succes: true as const, vente };
    } catch (erreur) {
      return {
        succes: false as const,
        message: messageErreur(erreur),
      };
    }
  });
  ipcMain.handle(
    "ventes:lister",
    (
      _evt,
      boutiqueId: string,
      depotId?: string,
      statut?: ventes.StatutVente,
      terme?: string,
      limite?: number,
      clientId?: string,
    ) => ventes.listerVentes(boutiqueId, depotId, statut, terme, limite, clientId),
  );
  ipcMain.handle("ventes:obtenir", (_evt, id: string) => ventes.obtenirVente(id));
  ipcMain.handle("ventes:annuler", (_evt, id: string, utilisateurId: string | null) =>
    executerEnSecurite(() => ventes.annulerVente(id, utilisateurId)),
  );
  ipcMain.handle("ventes:listerParProduit", (_evt, produitId: string, limite?: number) =>
    ventes.listerVentesParProduit(produitId, limite),
  );

  ipcMain.handle("produits:attribuerReferencesManquantes", (_evt, boutiqueId: string) =>
    executerEnSecurite(() => produits.attribuerReferencesManquantes(boutiqueId)),
  );
  ipcMain.handle("produits:lister", (_evt, boutiqueId: string, terme?: string) =>
    produits.listerProduits(boutiqueId, terme),
  );
  ipcMain.handle("produits:obtenir", (_evt, id: string) => produits.obtenirProduit(id));
  ipcMain.handle("produits:creer", (_evt, params: produits.ParametresProduit) =>
    executerEnSecurite(() => produits.creerProduit(params)),
  );
  ipcMain.handle("produits:modifier", (_evt, id: string, champs: Parameters<typeof produits.modifierProduit>[1]) =>
    executerEnSecurite(() => produits.modifierProduit(id, champs)),
  );
  ipcMain.handle("produits:supprimer", (_evt, id: string) => executerEnSecurite(() => produits.supprimerProduit(id)));
  ipcMain.handle("produits:usagesCatalogue", (_evt, boutiqueId: string) => produits.usagesCatalogue(boutiqueId));
  ipcMain.handle("produits:prochaineReference", (_evt, boutiqueId: string) =>
    produits.prochaineReferenceProduit(boutiqueId),
  );

  ipcMain.handle("variantes:creer", (_evt, params: produits.ParametresVarianteEntree) =>
    executerEnSecurite(() => produits.creerVariante(params)),
  );
  ipcMain.handle(
    "variantes:modifier",
    (_evt, id: string, champs: Parameters<typeof produits.modifierVariante>[1]) =>
      executerEnSecurite(() => produits.modifierVariante(id, champs)),
  );

  ipcMain.handle("categories:lister", (_evt, boutiqueId: string) => produits.listerCategories(boutiqueId));
  ipcMain.handle("categories:listerDetail", (_evt, boutiqueId: string) => produits.listerCategoriesDetail(boutiqueId));
  ipcMain.handle("categories:articles", (_evt, categorieId: string) => produits.listerArticlesCategorie(categorieId));
  ipcMain.handle("categories:articlesBoutique", (_evt, boutiqueId: string) => produits.listerArticlesBoutique(boutiqueId));
  ipcMain.handle("categories:creer", (_evt, boutiqueId: string, nom: string) =>
    executerEnSecurite(() => produits.creerCategorie(boutiqueId, nom)),
  );
  ipcMain.handle("categories:modifier", (_evt, id: string, nom: string) =>
    executerEnSecurite(() => produits.modifierCategorie(id, nom)),
  );
  ipcMain.handle("categories:supprimer", (_evt, id: string, remplacementId?: string | null) =>
    executerEnSecurite(() => produits.supprimerCategorie(id, remplacementId)),
  );

  ipcMain.handle("unites:lister", (_evt, boutiqueId: string) => produits.listerUnites(boutiqueId));
  ipcMain.handle("unites:creer", (_evt, boutiqueId: string, nom: string, abreviation?: string) =>
    executerEnSecurite(() => produits.creerUnite(boutiqueId, nom, abreviation)),
  );
  ipcMain.handle("unites:modifier", (_evt, id: string, champs: Parameters<typeof produits.modifierUnite>[1]) =>
    executerEnSecurite(() => produits.modifierUnite(id, champs)),
  );
  ipcMain.handle("unites:supprimer", (_evt, id: string) => executerEnSecurite(() => produits.supprimerUnite(id)));

  ipcMain.handle("attributs:lister", (_evt, boutiqueId: string) => produits.listerAttributs(boutiqueId));
  ipcMain.handle("attributs:creer", (_evt, boutiqueId: string, nom: string) =>
    executerEnSecurite(() => produits.creerAttribut(boutiqueId, nom)),
  );
  ipcMain.handle("attributs:modifier", (_evt, id: string, nom: string) =>
    executerEnSecurite(() => produits.modifierAttribut(id, nom)),
  );
  ipcMain.handle("attributs:supprimer", (_evt, id: string) =>
    executerEnSecurite(() => produits.supprimerAttribut(id)),
  );
  ipcMain.handle("attributs:listerValeurs", (_evt, attributId: string) =>
    produits.listerValeursAttribut(attributId),
  );
  ipcMain.handle("attributs:modifierValeur", (_evt, id: string, valeur: string) =>
    executerEnSecurite(() => produits.modifierValeurAttribut(id, valeur)),
  );
  ipcMain.handle("attributs:supprimerValeur", (_evt, id: string) => executerEnSecurite(() => produits.supprimerValeurAttribut(id)));
  ipcMain.handle("attributs:creerValeur", (_evt, attributId: string, valeur: string) =>
    executerEnSecurite(() => produits.creerValeurAttribut(attributId, valeur)),
  );

  ipcMain.handle("depots:lister", (_evt, boutiqueId: string) => stock.listerDepotsDetail(boutiqueId));
  ipcMain.handle("depots:creer", (_evt, boutiqueId: string, nom: string, adresse?: string) =>
    executerEnSecurite(() => stock.creerDepot(boutiqueId, nom, adresse)),
  );
  ipcMain.handle("depots:modifier", (_evt, id: string, champs: Parameters<typeof stock.modifierDepot>[1]) =>
    executerEnSecurite(() => stock.modifierDepot(id, champs)),
  );
  ipcMain.handle("depots:supprimer", (_evt, id: string) => executerEnSecurite(() => stock.supprimerDepot(id)));
  ipcMain.handle("depots:transfererTout", (_evt, sourceId: string, destinationId: string, utilisateurId: string | null) =>
    executerEnSecurite(() => stock.transfererToutLeStock(sourceId, destinationId, utilisateurId)),
  );
  ipcMain.handle("depots:supprimesAvecStock", (_evt, boutiqueId: string) => stock.depotsSupprimesAvecStock(boutiqueId));

  ipcMain.handle("stock:lister", (_evt, boutiqueId: string, depotId?: string, terme?: string) =>
    stock.listerStock(boutiqueId, depotId, terme),
  );
  ipcMain.handle("stock:obtenirLigne", (_evt, id: string) => stock.obtenirLigneStock(id));

  ipcMain.handle(
    "mouvements:lister",
    (_evt, boutiqueId: string, depotId?: string, limite?: number | null, depuis?: string | null, jusqua?: string | null) =>
      stock.listerMouvements(boutiqueId, depotId, limite, depuis, jusqua),
  );
  ipcMain.handle("mouvements:listerParProduit", (_evt, produitId: string, limite?: number) =>
    stock.listerMouvementsParProduit(produitId, limite),
  );
  ipcMain.handle("mouvements:creerGroupe", (_evt, params: stock.ParametresMouvementsGroupe) => {
    const resultat = executerEnSecurite(() => stock.creerMouvementsGroupe(params));
    if (resultat.succes) signalerRuptureEnSecurite(params.depotId);
    return resultat;
  });
  ipcMain.handle("mouvements:creer", (_evt, params: stock.ParametresMouvement) => {
    const resultat = executerEnSecurite(() => stock.creerMouvementManuel(params));
    if (resultat.succes) signalerRuptureEnSecurite(params.depotId);
    return resultat;
  });
  ipcMain.handle("mouvements:creerEntreeProduction", (_evt, params: stock.ParametresEntreeProduction) => {
    const resultat = executerEnSecurite(() => stock.creerEntreeProduction(params));
    if (resultat.succes) signalerRuptureEnSecurite(params.depotId);
    return resultat;
  });

  ipcMain.handle("entreesStock:achatRapide", (_evt, params: achats.ParametresAchatRapide) =>
    executerEnSecurite(() => achats.achatRapide(params)),
  );
  ipcMain.handle("entreesStock:ouverture", (_evt, params: stock.ParametresEntreeStock) =>
    executerEnSecurite(() => stock.entreeStockOuverture(params)),
  );
  ipcMain.handle("entreesStock:fabrication", (_evt, params: stock.ParametresEntreeStock) =>
    executerEnSecurite(() => stock.entreeFabrication(params)),
  );
  ipcMain.handle("entreesStock:don", (_evt, params: stock.ParametresEntreeStock) =>
    executerEnSecurite(() => stock.entreeDon(params)),
  );
  // Sauvegarde chiffrée de la boutique (docs/plan_reseau_local.md, lot 7).
  ipcMain.handle("sauvegarde:etat", () => sauvegarde.etatSauvegarde());
  ipcMain.handle("sauvegarde:lister", (_evt, dossier?: string | null) => sauvegarde.listerSauvegardes(dossier));
  ipcMain.handle("sauvegarde:ouvrirDossier", async (_evt, dossier: string) => {
    await shell.openPath(dossier);
  });
  ipcMain.handle(
    "sauvegarde:configurer",
    (
      _evt,
      params: {
        boutiqueId: string;
        boutiqueNom: string;
        dossier: string;
        heure: string;
        conservation: sauvegarde.Conservation;
        motDePasse: string;
        secours?: boolean;
      },
    ) => executerEnSecurite(() => sauvegarde.configurerSauvegarde(params)),
  );
  ipcMain.handle(
    "sauvegarde:modifierReglages",
    (_evt, params: { dossier: string; heure: string; conservation: sauvegarde.Conservation; secours?: boolean }) =>
    executerEnSecurite(() => sauvegarde.modifierReglagesSauvegarde(params)),
  );
  ipcMain.handle("sauvegarde:changerMotDePasse", (_evt, motDePasse: string) =>
    executerEnSecurite(() => sauvegarde.changerMotDePasseSauvegarde(motDePasse)),
  );
  ipcMain.handle("sauvegarde:desactiver", () => sauvegarde.desactiverSauvegarde());
  ipcMain.handle("sauvegarde:maintenant", () => executerEnSecurite(() => sauvegarde.sauvegarderMaintenant()));
  ipcMain.handle("sauvegarde:choisirDossier", async () => {
    const fenetre = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Dossier de sauvegarde (ex. le dossier Google Drive de la boutique)",
      properties: ["openDirectory", "createDirectory"],
    };
    const resultat = fenetre ? await dialog.showOpenDialog(fenetre, options) : await dialog.showOpenDialog(options);
    return resultat.canceled ? null : resultat.filePaths[0];
  });
  ipcMain.handle("sauvegarde:choisirFichier", async () => {
    const fenetre = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Sauvegarde à restaurer",
      properties: ["openFile"],
      filters: [{ name: "Sauvegarde Gestion Stock", extensions: ["gsbak"] }],
    };
    const resultat = fenetre ? await dialog.showOpenDialog(fenetre, options) : await dialog.showOpenDialog(options);
    return resultat.canceled ? null : resultat.filePaths[0];
  });
  ipcMain.handle("sauvegarde:restaurer", (_evt, fichier: string, motDePasse: string) => {
    const resultat = executerEnSecurite(() => {
      // Plus aucune écriture de la base en mémoire par-dessus le fichier restauré.
      reseauCaisse.arreterBoucleCaisse();
      sauvegarde.restaurerSauvegarde(fichier, motDePasse);
    });
    // Redémarrage pour rouvrir la base restaurée (app.exit : pas de sauvegarde de fermeture).
    if (resultat.succes) {
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1500);
    }
    return resultat;
  });
  ipcMain.handle("sauvegarde:aUneCleSecours", (_evt, fichier: string) => sauvegarde.aUneCleSecours(fichier));
  ipcMain.handle("sauvegarde:restaurerAvecSecours", async (_evt, fichier: string, username: string, password: string) => {
    const resultat = await executerEnSecuriteAsync(async () => {
      reseauCaisse.arreterBoucleCaisse();
      return sauvegarde.restaurerAvecSecours(fichier, username, password);
    });
    if (resultat.succes) {
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1500);
    }
    return resultat;
  });

  // Réseau de la boutique (docs/plan_reseau_local.md) — poste principal.
  ipcMain.handle("reseau:etat", () => reseauCaisse.etatReseauComplet());
  ipcMain.handle(
    "reseau:devenirPrincipal",
    (_evt, params: { boutiqueId: string; boutiqueNom: string; nomPoste?: string }) =>
      executerEnSecuriteAsync(() => reseauPrincipal.devenirPostePrincipal(params)),
  );
  ipcMain.handle("reseau:quitterPrincipal", () => executerEnSecuriteAsync(() => reseauPrincipal.quitterPostePrincipal()));
  ipcMain.handle("reseau:nouveauCode", () => reseauPrincipal.nouveauCodeAppairage());
  ipcMain.handle("reseau:annulerCode", () => reseauPrincipal.annulerCodeAppairage());
  ipcMain.handle("reseau:mettreEnPause", () => executerEnSecuriteAsync(() => reseauPrincipal.mettreEnPausePostePrincipal()));
  ipcMain.handle("reseau:reprendre", () => executerEnSecuriteAsync(() => reseauPrincipal.reprendrePostePrincipal()));
  ipcMain.handle("reseau:redemarrer", () => executerEnSecuriteAsync(() => reseauPrincipal.redemarrerPostePrincipal()));
  ipcMain.handle("reseau:debrancher", (_evt, appareilId: string) => reseauPrincipal.debrancherAppareil(appareilId));
  // Réseau de la boutique — côté caisse.
  ipcMain.handle("reseau:rechercher", () => reseauCaisse.rechercherPostesPrincipaux());
  ipcMain.handle(
    "reseau:seBrancher",
    (_evt, params: { adresse: string; code: string; boutiqueId: string; nomAppareil?: string }) =>
      executerEnSecuriteAsync(() => reseauCaisse.seBrancher(params)),
  );
  ipcMain.handle("reseau:rejoindreAvantConnexion", (_evt, params: { adresse: string; code: string; nomAppareil?: string }) =>
    executerEnSecuriteAsync(() => reseauCaisse.rejoindreAvantConnexion(params)),
  );
  ipcMain.handle("reseau:seDebrancher", () => reseauCaisse.seDebrancher());
  ipcMain.handle("reseau:synchroniser", async () => {
    await reseauCaisse.synchroniserAvecPrincipal();
    return reseauCaisse.etatReseauComplet();
  });
  ipcMain.handle("recettes:obtenir", (_evt, varianteId: string) => recettes.obtenirRecette(varianteId));
  ipcMain.handle("recettes:lister", (_evt, boutiqueId: string) => recettes.listerRecettes(boutiqueId));
  ipcMain.handle("recettes:enregistrer", (_evt, params: recettes.ParametresRecette) =>
    executerEnSecurite(() => recettes.enregistrerRecette(params)),
  );
  ipcMain.handle("recettes:supprimer", (_evt, varianteId: string) =>
    executerEnSecurite(() => recettes.supprimerRecette(varianteId)),
  );
  ipcMain.handle("entreesStock:articlesSansStock", (_evt, boutiqueId: string, depotId?: string) =>
    stock.articlesSansStock(boutiqueId, depotId),
  );

  ipcMain.handle("commandesClient:lister", (_evt, boutiqueId: string) => commandesClient.listerCommandesClient(boutiqueId));
  ipcMain.handle("commandesClient:obtenir", (_evt, id: string) => commandesClient.obtenirCommandeClient(id));
  ipcMain.handle("commandesClient:creer", (_evt, params: commandesClient.ParametresCommandeClient) =>
    executerEnSecurite(() => commandesClient.creerCommandeClient(params)),
  );
  ipcMain.handle("commandesClient:modifier", (_evt, id: string, champs: commandesClient.ModificationCommandeClient) =>
    executerEnSecurite(() => commandesClient.modifierCommandeClient(id, champs)),
  );
  ipcMain.handle("commandesClient:marquerPrete", (_evt, id: string, prete: boolean) =>
    executerEnSecurite(() => commandesClient.marquerCommandePrete(id, prete)),
  );
  ipcMain.handle("commandesClient:annuler", (_evt, id: string) =>
    executerEnSecurite(() => commandesClient.annulerCommandeClient(id)),
  );
  ipcMain.handle("commandesClient:verserAvance", (_evt, id: string, op: comptesTiers.OperationCompte) =>
    executerEnSecurite(() => commandesClient.verserAvanceCommande(id, op)),
  );
  ipcMain.handle("commandesClient:livrer", (_evt, params: commandesClient.ParametresLivraison) => {
    const resultat = executerEnSecurite(() => commandesClient.livrerCommandeClient(params));
    if (resultat.succes) {
      const depot = commandesClient.obtenirCommandeClient(params.commandeId)?.depotId;
      if (depot) signalerRuptureEnSecurite(depot);
    }
    return resultat;
  });
  ipcMain.handle("commandesClient:reservations", (_evt, boutiqueId: string, depotId?: string) =>
    commandesClient.reservations(boutiqueId, depotId),
  );

  ipcMain.handle("transferts:creer", (_evt, params: stock.ParametresTransfert) => {
    const resultat = executerEnSecurite(() => stock.transfererStock(params));
    // Le dépôt source est celui dont le stock baisse (destination augmente).
    if (resultat.succes) signalerRuptureEnSecurite(params.depotSourceId);
    return resultat;
  });
  ipcMain.handle(
    "transferts:lister",
    (_evt, boutiqueId: string, limite?: number | null, depuis?: string | null, jusqua?: string | null) =>
      stock.listerTransferts(boutiqueId, limite, depuis, jusqua),
  );
  ipcMain.handle("transferts:creerGroupe", (_evt, params: stock.ParametresTransfertsGroupe) => {
    const resultat = executerEnSecurite(() => stock.creerTransfertsGroupe(params));
    if (resultat.succes) signalerRuptureEnSecurite(params.depotSourceId);
    return resultat;
  });

  ipcMain.handle("tresorerie:journee", (_evt, boutiqueId: string, depotId: string | null, debut: string, fin: string) =>
    tresorerie.journeeCaisse(boutiqueId, depotId, debut, fin),
  );
  ipcMain.handle("pertes:declarerGroupe", (_evt, params: stock.ParametresPertesGroupe) => {
    const resultat = executerEnSecurite(() => stock.declarerPertesGroupe(params));
    if (resultat.succes) signalerRuptureEnSecurite(params.depotId);
    return resultat;
  });
  ipcMain.handle("pertes:declarer", (_evt, params: stock.ParametresPerte) => {
    const resultat = executerEnSecurite(() => stock.declarerPerte(params));
    if (resultat.succes) signalerRuptureEnSecurite(params.depotId);
    return resultat;
  });
  ipcMain.handle("pertes:annuler", (_evt, id: string, utilisateurId: string | null) => {
    const resultat = executerEnSecurite(() => stock.annulerPerte(id, utilisateurId));
    return resultat;
  });
  ipcMain.handle(
    "destockages:modifier",
    (_evt, id: string, champs: { prixDestockage?: number; dateFin?: string | null }) =>
      executerEnSecurite(() => stock.modifierDestockage(id, champs)),
  );
  ipcMain.handle("pertes:lister", (_evt, boutiqueId: string, debut?: string, fin?: string) =>
    stock.listerPertes(boutiqueId, debut, fin),
  );
  ipcMain.handle("detaillages:operer", (_evt, params: stock.ParametresDetaillage) => {
    const resultat = executerEnSecurite(() => stock.detaillerOuRegrouper(params));
    if (resultat.succes) signalerRuptureEnSecurite(params.depotId);
    return resultat;
  });
  ipcMain.handle("detaillages:annuler", (_evt, id: string, utilisateurId: string | null) =>
    executerEnSecurite(() => stock.annulerDetaillage(id, utilisateurId)),
  );
  ipcMain.handle("detaillages:lister", (_evt, boutiqueId: string) => stock.listerDetaillages(boutiqueId));
  ipcMain.handle("detaillages:variantes", (_evt, boutiqueId: string) => stock.listerVariantesSimples(boutiqueId));
  ipcMain.handle("detaillages:articles", (_evt, boutiqueId: string, depotId?: string) =>
    stock.listerArticlesDetaillables(boutiqueId, depotId),
  );
  ipcMain.handle("detaillages:grosDisponible", (_evt, varianteDetailId: string, depotId: string) =>
    stock.grosDisponiblePourDetail(varianteDetailId, depotId),
  );
  ipcMain.handle("variantes:infoDetail", (_evt, varianteId: string) => produits.infoDetailVariante(varianteId));
  ipcMain.handle(
    "variantes:definirDetail",
    (_evt, varianteGrosId: string, varianteDetailId: string | null, quantite: number | null) =>
      executerEnSecurite(() => produits.definirArticleDetail(varianteGrosId, varianteDetailId, quantite)),
  );
  ipcMain.handle("variantes:creerDetail", (_evt, params: produits.ParametresArticleDetail) =>
    executerEnSecurite(() => produits.creerArticleDetail(params)),
  );

  ipcMain.handle("destockages:lister", (_evt, boutiqueId: string) => stock.listerDestockages(boutiqueId));
  ipcMain.handle("destockages:demarrer", (_evt, params: stock.ParametresDestockage) =>
    executerEnSecurite(() => stock.demarrerDestockage(params)),
  );
  ipcMain.handle("destockages:arreter", (_evt, id: string) => executerEnSecurite(() => stock.arreterDestockage(id)));
  ipcMain.handle("destockages:demarrerOperation", (_evt, params: stock.ParametresOperationDestockage) =>
    executerEnSecurite(() => stock.demarrerOperationDestockage(params)),
  );
  ipcMain.handle("destockages:arreterOperation", (_evt, id: string) =>
    executerEnSecurite(() => stock.arreterOperationDestockage(id)),
  );

  ipcMain.handle("inventaires:lister", (_evt, boutiqueId: string) => stock.listerInventaires(boutiqueId));
  ipcMain.handle(
    "inventaires:demarrer",
    (_evt, boutiqueId: string, depotId: string, utilisateurId: string | null, aZero?: boolean) =>
      executerEnSecurite(() => stock.demarrerInventaire(boutiqueId, depotId, utilisateurId, !!aZero)),
  );
  ipcMain.handle("inventaires:ajouterLigne", (_evt, inventaireId: string, varianteId: string, qtePhysique?: number) =>
    executerEnSecurite(() => stock.ajouterLigneInventaire(inventaireId, varianteId, qtePhysique ?? 0)),
  );
  ipcMain.handle("inventaires:obtenir", (_evt, id: string) => stock.obtenirInventaire(id));
  ipcMain.handle("inventaires:validerLigne", (_evt, id: string, qtePhysique: number) =>
    executerEnSecurite(() => stock.modifierLigneInventaire(id, qtePhysique)),
  );
  ipcMain.handle("inventaires:valider", (_evt, id: string, utilisateurId: string | null) =>
    executerEnSecurite(() => stock.validerInventaire(id, utilisateurId)),
  );

  ipcMain.handle("fournisseurs:lister", (_evt, boutiqueId: string) => achats.listerFournisseurs(boutiqueId));
  ipcMain.handle("fournisseurs:derniers", (_evt, boutiqueId: string, varianteIds: string[]) =>
    achats.obtenirDerniersFournisseurs(boutiqueId, varianteIds),
  );
  ipcMain.handle(
    "fournisseurs:creer",
    (_evt, boutiqueId: string, nom: string, telephone?: string, adresse?: string, contact?: string) =>
      executerEnSecurite(() => achats.creerFournisseur(boutiqueId, nom, telephone, adresse, contact)),
  );
  ipcMain.handle("fournisseurs:supprimer", (_evt, id: string) =>
    executerEnSecurite(() => achats.supprimerFournisseur(id)),
  );
  ipcMain.handle(
    "fournisseurs:modifier",
    (_evt, id: string, champs: Parameters<typeof achats.modifierFournisseur>[1]) =>
      executerEnSecurite(() => achats.modifierFournisseur(id, champs)),
  );

  ipcMain.handle(
    "commandes:lister",
    (_evt, boutiqueId: string, fournisseurId?: string, statut?: achats.StatutCommande, terme?: string) =>
      achats.listerCommandes(boutiqueId, fournisseurId, statut, terme),
  );
  ipcMain.handle("commandes:obtenir", (_evt, id: string) => achats.obtenirCommande(id));
  ipcMain.handle("commandes:creer", (_evt, params: achats.ParametresCommande) =>
    executerEnSecurite(() => achats.creerCommande(params)),
  );
  ipcMain.handle(
    "commandes:modifier",
    (_evt, id: string, champs: achats.ParametresModifierCommande) =>
      executerEnSecurite(() => achats.modifierCommande(id, champs)),
  );
  ipcMain.handle("commandes:receptionner", (_evt, params: achats.ParametresReception) =>
    executerEnSecurite(() => achats.receptionnerCommande(params)),
  );
  ipcMain.handle("commandes:annulerReception", (_evt, receptionId: string, utilisateurId: string | null) =>
    executerEnSecurite(() => achats.annulerReception(receptionId, utilisateurId)),
  );
  ipcMain.handle("commandes:retournerAuFournisseur", (_evt, params: achats.ParametresRetourFournisseur) =>
    executerEnSecurite(() => achats.retournerAuFournisseur(params)),
  );
  ipcMain.handle("commandes:listerReceptions", (_evt, commandeId: string) =>
    achats.listerReceptionsCommande(commandeId),
  );
  ipcMain.handle(
    "commandes:historiqueReceptions",
    (_evt, boutiqueId: string, fournisseurId?: string, terme?: string) =>
      achats.listerHistoriqueReceptions(boutiqueId, fournisseurId, terme),
  );
  ipcMain.handle("commandes:historique", (_evt, boutiqueId: string) => achats.historiqueAchats(boutiqueId));
  ipcMain.handle("commandes:suivi", (_evt, commandeId: string) => achats.suiviCommande(commandeId));

  ipcMain.handle("dettes:rembourseDepuis", (_evt, boutiqueId: string, depuis: string) =>
    achats.montantRembourseDettesDepuis(boutiqueId, depuis),
  );
  ipcMain.handle("credits:regleDepuis", (_evt, boutiqueId: string, depuis: string) =>
    clients.montantRegleCreditsDepuis(boutiqueId, depuis),
  );
  ipcMain.handle("dettes:echeancier", (_evt, detteId: string) => achats.echeancierDette(detteId));
  ipcMain.handle("dettes:planifier", (_evt, detteId: string, tranches: { dateEcheance: string; montant: number }[]) =>
    executerEnSecurite(() => achats.planifierEcheancier(detteId, tranches)),
  );
  ipcMain.handle("dettes:annulerPaiement", (_evt, paiementId: string, utilisateurId: string | null, motif?: string) =>
    executerEnSecurite(() => achats.annulerPaiementDette(paiementId, utilisateurId, motif)),
  );
  ipcMain.handle(
    "dettes:lister",
    (_evt, boutiqueId: string, fournisseurId?: string, statut?: achats.StatutDette) =>
      achats.listerDettes(boutiqueId, fournisseurId, statut),
  );
  ipcMain.handle(
    "dettes:payer",
    (_evt, id: string, montant: number, mode?: string, depotId?: string | null, utilisateurId?: string | null) =>
      executerEnSecurite(() => achats.payerDette(id, montant, mode, depotId ?? null, utilisateurId ?? null)),
  );
  ipcMain.handle("dettes:listerPaiements", (_evt, detteId: string) => achats.listerPaiementsDette(detteId));

  ipcMain.handle("clients:lister", (_evt, boutiqueId: string, terme?: string) =>
    clients.listerClientsDetail(boutiqueId, terme),
  );
  ipcMain.handle("clients:obtenir", (_evt, id: string) => clients.obtenirClient(id));
  ipcMain.handle(
    "clients:creer",
    (_evt, boutiqueId: string, nom: string, telephone?: string, adresse?: string, estPermanent?: boolean) =>
      executerEnSecurite(() => clients.creerClient(boutiqueId, nom, telephone, adresse, estPermanent)),
  );
  ipcMain.handle(
    "clients:modifier",
    (_evt, id: string, champs: Parameters<typeof clients.modifierClient>[1]) =>
      executerEnSecurite(() => clients.modifierClient(id, champs)),
  );
  ipcMain.handle("clients:supprimer", (_evt, id: string) => executerEnSecurite(() => clients.supprimerClient(id)));

  ipcMain.handle(
    "credits:lister",
    (_evt, boutiqueId: string, clientId?: string, statut?: clients.StatutCredit) =>
      clients.listerCredits(boutiqueId, clientId, statut),
  );
  ipcMain.handle("credits:obtenir", (_evt, id: string) => clients.obtenirCredit(id));
  ipcMain.handle("credits:remboursements", (_evt, boutiqueId: string) => clients.listerRemboursementsClients(boutiqueId));
  ipcMain.handle("credits:echeancier", (_evt, creditId: string) => clients.echeancierCredit(creditId));
  ipcMain.handle("credits:planifier", (_evt, creditId: string, tranches: { dateEcheance: string; montant: number }[]) =>
    executerEnSecurite(() => clients.planifierEcheancierCredit(creditId, tranches)),
  );
  // Comptes client / fournisseur (porte-monnaie, avances, avoirs).
  ipcMain.handle("comptesTiers:resumesClients", (_evt, boutiqueId: string, depuis: string) =>
    comptesTiers.resumesComptesClients(boutiqueId, depuis),
  );
  ipcMain.handle("comptesTiers:resumesFournisseurs", (_evt, boutiqueId: string, depuis: string) =>
    comptesTiers.resumesComptesFournisseurs(boutiqueId, depuis),
  );
  ipcMain.handle("comptesTiers:releveClient", (_evt, clientId: string) => comptesTiers.releveCompletClient(clientId));
  ipcMain.handle("comptesTiers:releveFournisseur", (_evt, fournisseurId: string) =>
    comptesTiers.releveCompletFournisseur(fournisseurId),
  );
  ipcMain.handle("comptesTiers:compteClient", (_evt, clientId: string) => comptesTiers.compteClient(clientId));
  ipcMain.handle("comptesTiers:soldesClients", (_evt, boutiqueId: string) => comptesTiers.soldesComptesClients(boutiqueId));
  ipcMain.handle("comptesTiers:deposerClient", (_evt, clientId: string, op: comptesTiers.OperationCompte) =>
    executerEnSecurite(() => comptesTiers.deposerSurCompteClient(clientId, op)),
  );
  ipcMain.handle("comptesTiers:rendreClient", (_evt, clientId: string, op: comptesTiers.OperationCompte) =>
    executerEnSecurite(() => comptesTiers.rendreDuCompteClient(clientId, op)),
  );
  ipcMain.handle("comptesTiers:compteFournisseur", (_evt, fournisseurId: string) =>
    comptesTiers.compteFournisseur(fournisseurId),
  );
  ipcMain.handle("comptesTiers:soldesFournisseurs", (_evt, boutiqueId: string) =>
    comptesTiers.soldesComptesFournisseurs(boutiqueId),
  );
  ipcMain.handle("comptesTiers:verserAvance", (_evt, fournisseurId: string, op: comptesTiers.OperationCompte) =>
    executerEnSecurite(() => comptesTiers.verserAvanceFournisseur(fournisseurId, op)),
  );
  ipcMain.handle("comptesTiers:remboursementFournisseur", (_evt, fournisseurId: string, op: comptesTiers.OperationCompte) =>
    executerEnSecurite(() => comptesTiers.remboursementFournisseur(fournisseurId, op)),
  );

  ipcMain.handle(
    "credits:rembourser",
    (_evt, id: string, montant: number, mode?: string, depotId?: string | null, utilisateurId?: string | null) =>
      executerEnSecurite(() => clients.rembourserCredit(id, montant, mode, depotId ?? null, utilisateurId ?? null)),
  );

  ipcMain.handle(
    "rapports:plageDates",
    (_evt, periode?: rapports.Periode, dateDebut?: string, dateFin?: string) =>
      rapports.calculerPlageDates(periode, dateDebut, dateFin),
  );
  ipcMain.handle(
    "rapports:syntheseVentes",
    (_evt, boutiqueId: string, debut: string, fin: string) => rapports.syntheseVentes(boutiqueId, debut, fin),
  );
  ipcMain.handle(
    "rapports:topProduits",
    (_evt, boutiqueId: string, debut: string, fin: string, limite?: number, ordre?: "asc" | "desc") =>
      rapports.topProduits(boutiqueId, debut, fin, limite, ordre),
  );
  ipcMain.handle("rapports:valeurStock", (_evt, boutiqueId: string, depotId?: string) =>
    rapports.valeurStock(boutiqueId, depotId),
  );
  ipcMain.handle("rapports:produitsDormants", (_evt, boutiqueId: string, jours: number) =>
    rapports.produitsDormants(boutiqueId, jours),
  );
  ipcMain.handle("rapports:enregistrerReleveDormants", (_evt, boutiqueId: string) =>
    executerEnSecurite(() => rapports.enregistrerReleveDormants(boutiqueId)),
  );
  ipcMain.handle("rapports:relevesDormants", (_evt, boutiqueId: string) => rapports.listerRelevesDormants(boutiqueId));
  ipcMain.handle("rapports:sortiesDormance", (_evt, boutiqueId: string, seuil: number) =>
    rapports.sortiesDormance(boutiqueId, seuil),
  );
  ipcMain.handle(
    "rapports:ventesParVendeur",
    (_evt, boutiqueId: string, debut: string, fin: string) => rapports.ventesParVendeur(boutiqueId, debut, fin),
  );
  ipcMain.handle(
    "rapports:ventesParCategorie",
    (_evt, boutiqueId: string, debut: string, fin: string) => rapports.ventesParCategorie(boutiqueId, debut, fin),
  );
  ipcMain.handle(
    "rapports:ventesParModePaiement",
    (_evt, boutiqueId: string, debut: string, fin: string) =>
      rapports.ventesParModePaiement(boutiqueId, debut, fin),
  );
  ipcMain.handle(
    "rapports:ventesParJour",
    (_evt, boutiqueId: string, debut: string, fin: string) => rapports.ventesParJour(boutiqueId, debut, fin),
  );
  ipcMain.handle(
    "rapports:topClients",
    (_evt, boutiqueId: string, debut: string, fin: string, limite?: number) =>
      rapports.topClients(boutiqueId, debut, fin, limite),
  );
  ipcMain.handle("comptabilite:planComptable", () => comptabilite.PLAN_COMPTABLE_SYSCOHADA);
  ipcMain.handle("comptabilite:journal", (_evt, boutiqueId: string, debut: string, fin: string, journalCode?: string) =>
    comptabilite.journalLocal(comptabilite.genererEcrituresLocales(boutiqueId), debut, fin, journalCode),
  );
  ipcMain.handle("comptabilite:grandLivre", (_evt, boutiqueId: string, compte: string, debut: string, fin: string) =>
    comptabilite.grandLivreLocal(comptabilite.genererEcrituresLocales(boutiqueId), compte, debut, fin),
  );
  ipcMain.handle("comptabilite:balance", (_evt, boutiqueId: string, debut: string, fin: string) =>
    comptabilite.balanceGeneraleLocale(comptabilite.genererEcrituresLocales(boutiqueId), debut, fin),
  );
  ipcMain.handle("comptabilite:compteDeResultat", (_evt, boutiqueId: string, debut: string, fin: string) =>
    comptabilite.compteDeResultatLocal(comptabilite.genererEcrituresLocales(boutiqueId), debut, fin),
  );
  ipcMain.handle("comptabilite:bilan", (_evt, boutiqueId: string, dateFin: string) =>
    comptabilite.bilanLocal(comptabilite.genererEcrituresLocales(boutiqueId), dateFin),
  );
  ipcMain.handle(
    "comptabilite:journalOfficiel",
    (_evt, session: auth.Session, debut: string, fin: string, journalCode?: string) =>
      executerEnSecuriteAsync(() => comptabilite.journalOfficiel(session, debut, fin, journalCode)),
  );
  ipcMain.handle(
    "comptabilite:grandLivreOfficiel",
    (_evt, session: auth.Session, compte: string, debut: string, fin: string) =>
      executerEnSecuriteAsync(() => comptabilite.grandLivreOfficiel(session, compte, debut, fin)),
  );
  ipcMain.handle("comptabilite:balanceOfficielle", (_evt, session: auth.Session, debut: string, fin: string) =>
    executerEnSecuriteAsync(() => comptabilite.balanceOfficielle(session, debut, fin)),
  );
  ipcMain.handle(
    "comptabilite:compteDeResultatOfficiel",
    (_evt, session: auth.Session, debut: string, fin: string) =>
      executerEnSecuriteAsync(() => comptabilite.compteDeResultatOfficiel(session, debut, fin)),
  );
  ipcMain.handle("comptabilite:bilanOfficiel", (_evt, session: auth.Session, dateFin: string) =>
    executerEnSecuriteAsync(() => comptabilite.bilanOfficiel(session, dateFin)),
  );
  ipcMain.handle(
    "rapports:exporter",
    async (
      _evt,
      titre: string,
      colonnes: exportService.ColonneExport[],
      lignes: Record<string, unknown>[],
      format: exportService.FormatExport,
      cheminForce?: string,
    ) => {
      try {
        return {
          succes: true as const,
          resultat: await exportService.exporterTableau(titre, colonnes, lignes, format, cheminForce),
        };
      } catch (erreur) {
        return {
          succes: false as const,
          message: messageErreur(erreur),
        };
      }
    },
  );

  ipcMain.handle("reglages:obtenirBoutique", (_evt, boutiqueId: string) => reglages.obtenirBoutique(boutiqueId));
  ipcMain.handle(
    "reglages:modifierBoutique",
    (_evt, id: string, champs: Parameters<typeof reglages.modifierBoutique>[1]) =>
      executerEnSecurite(() => reglages.modifierBoutique(id, champs)),
  );
  ipcMain.handle("reglages:obtenirLogoBoutique", (_evt, boutiqueId: string) =>
    reglages.obtenirLogoBoutique(boutiqueId),
  );
  ipcMain.handle("reglages:definirLogoBoutique", (_evt, boutiqueId: string, logo: string) =>
    executerEnSecurite(() => reglages.definirLogoBoutique(boutiqueId, logo)),
  );
  ipcMain.handle("reglages:listerParametres", (_evt, boutiqueId: string) => reglages.listerParametres(boutiqueId));
  ipcMain.handle("reglages:definirParametre", (_evt, boutiqueId: string, cle: string, valeur: string) =>
    executerEnSecurite(() => reglages.definirParametre(boutiqueId, cle, valeur)),
  );
  ipcMain.handle("reglages:supprimerParametre", (_evt, id: string) =>
    executerEnSecurite(() => reglages.supprimerParametre(id)),
  );

  /**
   * Contrairement à executerEnSecurite (synchrone), ces opérations réseau sont
   * asynchrones : un try/catch synchrone ne capturerait pas un rejet de
   * promesse, et un objet { resultat: Promise<...> } n'est de toute façon pas
   * sérialisable tel quel par IPC — d'où ce wrapper async dédié (même besoin
   * que pour "ventes:creer"/"sync:executer"/"rapports:exporter" plus haut).
   */
  async function executerEnSecuriteAsync<T>(
    operation: () => Promise<T>,
  ): Promise<{ succes: true; resultat: T } | { succes: false; message: string }> {
    try {
      return { succes: true, resultat: await operation() };
    } catch (erreur) {
      return { succes: false, message: messageErreur(erreur) };
    }
  }

  ipcMain.handle("comptes:listerRoles", (_evt, session: auth.Session) =>
    executerEnSecuriteAsync(() => comptes.listerRoles(session)),
  );
  ipcMain.handle(
    "comptes:modifierRole",
    (_evt, session: auth.Session, id: string, permissions: Record<string, boolean>) =>
      executerEnSecuriteAsync(() => comptes.modifierRole(session, id, permissions)),
  );
  ipcMain.handle(
    "comptes:creerRole",
    (_evt, session: auth.Session, nom: string, permissions: Record<string, boolean>) =>
      executerEnSecuriteAsync(() => comptes.creerRole(session, nom, permissions)),
  );
  ipcMain.handle("comptes:renommerRole", (_evt, session: auth.Session, id: string, nom: string) =>
    executerEnSecuriteAsync(() => comptes.renommerRole(session, id, nom)),
  );
  ipcMain.handle("comptes:supprimerRole", (_evt, session: auth.Session, id: string) =>
    executerEnSecuriteAsync(() => comptes.supprimerRole(session, id)),
  );
  ipcMain.handle("comptes:etatDemandeReseau", (_evt, session: auth.Session) =>
    executerEnSecuriteAsync(() => comptes.etatDemandeReseau(session)),
  );
  ipcMain.handle("comptes:demanderActivationReseau", (_evt, session: auth.Session, note: string) =>
    executerEnSecuriteAsync(() => comptes.demanderActivationReseau(session, note)),
  );
  ipcMain.handle("comptes:abonnementBoutique", (_evt, session: auth.Session) =>
    executerEnSecuriteAsync(() => comptes.abonnementBoutique(session)),
  );
  ipcMain.handle(
    "comptes:declarerPaiementAbonnement",
    (_evt, session: auth.Session, declaration: comptes.DeclarationPaiementAbonnement) =>
      executerEnSecuriteAsync(() => comptes.declarerPaiementAbonnement(session, declaration)),
  );
  ipcMain.handle("comptes:listerUtilisateurs", (_evt, session: auth.Session) =>
    executerEnSecuriteAsync(() => comptes.listerUtilisateurs(session)),
  );
  ipcMain.handle("comptes:annuaire", (_evt, session: auth.Session) =>
    executerEnSecuriteAsync(() => comptes.annuaireUtilisateurs(session)),
  );
  ipcMain.handle(
    "comptes:creerUtilisateur",
    (_evt, session: auth.Session, params: comptes.ParametresCreationUtilisateur) =>
      executerEnSecuriteAsync(async () => {
        const utilisateur = await comptes.creerUtilisateur(session, params);
        await memoriserCompteDepuisServeur(session, utilisateur, params.password);
        return utilisateur;
      }),
  );
  ipcMain.handle(
    "comptes:modifierUtilisateur",
    (_evt, session: auth.Session, id: number, champs: comptes.ChampsUtilisateur) =>
      executerEnSecuriteAsync(async () => {
        const utilisateur = await comptes.modifierUtilisateur(session, id, champs);
        if (utilisateur && utilisateur.is_active === false) auth.desactiverCompteLocal(utilisateur.username);
        else if (utilisateur) await memoriserCompteDepuisServeur(session, utilisateur, champs.password ?? null);
        return utilisateur;
      }),
  );
  ipcMain.handle("comptes:supprimerUtilisateur", (_evt, session: auth.Session, id: number) =>
    executerEnSecuriteAsync(async () => {
      const username = (await comptes.listerUtilisateurs(session).catch(() => [])).find((u) => u.id === id)?.username;
      await comptes.supprimerUtilisateur(session, id);
      if (username) auth.desactiverCompteLocal(username);
    }),
  );

  ipcMain.handle("paiements:initier", (_evt, params: paiements.ParametresInitiationMobileMoney) =>
    executerEnSecurite(() => paiements.initierPaiementMobileMoney(params)),
  );
  ipcMain.handle("paiements:obtenirTransaction", (_evt, paiementId: string) =>
    paiements.obtenirTransactionPourPaiement(paiementId),
  );

  ipcMain.handle("notifications:lister", (_evt, boutiqueId: string, filtres?: notifications.FiltresNotifications) =>
    notifications.listerNotifications(boutiqueId, filtres),
  );
  ipcMain.handle("notifications:genererAlertesDestockage", (_evt, boutiqueId: string) =>
    executerEnSecurite(() => notifications.genererAlertesDestockage(boutiqueId)),
  );
  ipcMain.handle("notifications:genererAlertesAbonnement", (_evt, boutiqueId: string) =>
    executerEnSecurite(() => notifications.genererAlertesAbonnement(boutiqueId)),
  );
  ipcMain.handle("notifications:genererAlertesDoublons", (_evt, boutiqueId: string) =>
    executerEnSecurite(() => notifications.genererAlertesDoublons(boutiqueId)),
  );
  ipcMain.handle("notifications:genererAlertesRupture", (_evt, boutiqueId: string) =>
    executerEnSecurite(() => notifications.genererAlertesRupture(boutiqueId)),
  );
  ipcMain.handle("notifications:compterNonLues", (_evt, boutiqueId: string, depotId?: string) =>
    notifications.compterNotificationsNonLues(boutiqueId, depotId),
  );
  ipcMain.handle("notifications:marquerLues", (_evt, boutiqueId: string, depotId?: string) =>
    executerEnSecurite(() => notifications.marquerNotificationsLues(boutiqueId, depotId)),
  );

  ipcMain.handle("messages:lister", (_evt, boutiqueId: string, filtres?: messages.FiltresMessages) =>
    messages.listerMessages(boutiqueId, filtres),
  );
  ipcMain.handle("messages:genererRappelsCredit", (_evt, boutiqueId: string) =>
    executerEnSecurite(() => messages.genererRappelsCredit(boutiqueId)),
  );
  ipcMain.handle("messages:genererTicketWhatsapp", (_evt, venteId: string) =>
    executerEnSecurite(() => messages.genererTicketWhatsapp(venteId)),
  );
  ipcMain.handle(
    "messages:enregistrerRelanceCredit",
    (_evt, creditId: string, destinataire: string, message: string, utilisateurId: string | null) =>
      executerEnSecurite(() => messages.enregistrerRelanceCredit(creditId, destinataire, message, utilisateurId)),
  );
  ipcMain.handle("messages:envoyer", (_evt, id: string, texte?: string, destinataire?: string) =>
    executerEnSecurite(() => messages.envoyerMessage(id, texte, destinataire)),
  );
  ipcMain.handle("messages:marquerTraite", (_evt, id: string) => executerEnSecurite(() => messages.marquerMessageTraite(id)));

  ipcMain.handle("tresorerie:solde", (_evt, depotId: string, jusqua?: string) =>
    tresorerie.soldeCaisse(depotId, jusqua),
  );
  ipcMain.handle("tresorerie:listerMouvements", (_evt, depotId: string, limite?: number) =>
    tresorerie.listerMouvements(depotId, limite),
  );
  ipcMain.handle("tresorerie:listerDepenses", (_evt, depotId: string, limite?: number) =>
    tresorerie.listerDepenses(depotId, limite),
  );
  ipcMain.handle(
    "tresorerie:enregistrerDepense",
    (_evt, depotId: string, categorie: tresorerie.CategorieDepense, montant: number, description?: string, utilisateurId?: string | null) =>
      executerEnSecurite(() => tresorerie.enregistrerDepense(depotId, categorie, montant, description, utilisateurId)),
  );
  ipcMain.handle(
    "tresorerie:effectuerRetrait",
    (_evt, depotId: string, montant: number, motif?: string, utilisateurId?: string | null) =>
      executerEnSecurite(() => tresorerie.effectuerRetrait(depotId, montant, motif, utilisateurId)),
  );
  ipcMain.handle(
    "tresorerie:enregistrerApport",
    (_evt, depotId: string, montant: number, motif?: string, utilisateurId?: string | null) =>
      executerEnSecurite(() => tresorerie.enregistrerApport(depotId, montant, motif, utilisateurId)),
  );
  ipcMain.handle(
    "tresorerie:ajusterCaisse",
    (_evt, depotId: string, montantSigne: number, motif: string, utilisateurId?: string | null) =>
      executerEnSecurite(() => tresorerie.ajusterCaisse(depotId, montantSigne, motif, utilisateurId)),
  );
  ipcMain.handle(
    "tresorerie:soldeMobileMoneyDisponible",
    (_evt, boutiqueId: string, utilisateurSourceId: string, operateur: tresorerie.OperateurMobileMoney) =>
      tresorerie.soldeMobileMoneyDisponible(boutiqueId, utilisateurSourceId, operateur),
  );
  ipcMain.handle("tresorerie:effectuerTransfert", (_evt, params: tresorerie.ParametresTransfertCaisse) =>
    executerEnSecurite(() => tresorerie.effectuerTransfert(params)),
  );
  ipcMain.handle("tresorerie:listerTransferts", (_evt, depotId: string, limite?: number) =>
    tresorerie.listerTransferts(depotId, limite),
  );
  ipcMain.handle("tresorerie:listerClotures", (_evt, depotId: string, limite?: number) =>
    tresorerie.listerClotures(depotId, limite),
  );
  ipcMain.handle(
    "tresorerie:cloturer",
    (_evt, depotId: string, soldeCompte: number, utilisateurId?: string | null) =>
      executerEnSecurite(() => tresorerie.cloturerCaisse(depotId, soldeCompte, utilisateurId)),
  );

  ipcMain.handle("sync:executer", async (_evt, session: auth.Session) => {
    try {
      // Une caisse branchée ne parle pas au serveur en ligne : c'est le poste
      // principal qui relaie tout (un seul chemin, pas de doublons).
      if (reseauPrincipal.lireConfigReseau().role === "caisse") {
        await reseauCaisse.synchroniserAvecPrincipal();
        throw new Error("Cette caisse est branchée au poste principal : c'est lui qui synchronise en ligne.");
      }
      const resume = await sync.synchroniser(session);
      return { succes: true as const, ...resume };
    } catch (erreur) {
      return {
        succes: false as const,
        message: messageErreur(erreur),
      };
    }
  });

  ipcMain.handle("sync:enAttente", (_evt, boutiqueId: string) => sync.compterEnAttente(boutiqueId));

  ipcMain.handle("sync:etat", async () => {
    const { derniereSynchro } = sync.etatSynchro();
    const enLigne = await sync.verifierEnLigne();
    return { derniereSynchro, enLigne };
  });

  ipcMain.handle("systeme:exporterPdf", async (evenement, nomFichierDefaut: string) => {
    try {
      // preferCSSPageSize (plutôt qu'un pageSize fixe) : laisse la règle @page
      // du CSS imprimé décider du format (A4 par défaut, mais 80mm/58mm pour
      // un ticket — voir index.css et FactureVente.tsx pour format_ticket).
      const buffer = await evenement.sender.printToPDF({ printBackground: true, preferCSSPageSize: true });
      return {
        succes: true as const,
        resultat: await exportService.exporterBufferPdf(buffer, nomFichierDefaut),
      };
    } catch (erreur) {
      return { succes: false as const, message: messageErreur(erreur) };
    }
  });

  ipcMain.handle("systeme:ouvrirExterne", async (_evt, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("systeme:version", () => app.getVersion());

  // Adresse fixe de téléchargement de l'appli Android (QR code de Informations
  // boutique) : même serveur que l'API, route Django /telecharger/android/.
  ipcMain.handle("systeme:urlAppliAndroid", () => `${URL_BASE_API.replace(/\/api\/?$/, "")}/telecharger/android/`);
}
