import { app, ipcMain, shell } from "electron";

import * as abonnementAdmin from "../services/abonnementAdmin";
import * as achats from "../services/achats";
import * as alertesSysteme from "../services/alertesSysteme";
import * as auth from "../services/auth";
import * as clients from "../services/clients";
import * as comptabilite from "../services/comptabilite";
import * as comptes from "../services/comptes";
import * as exportService from "../services/export";
import * as inscriptionLocale from "../services/inscriptionLocale";
import * as messages from "../services/messages";
import * as notifications from "../services/notifications";
import * as paiements from "../services/paiements";
import * as rapports from "../services/rapports";
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
  ipcMain.handle("auth:verifierRevocationAdmin", async () => {
    try {
      await auth.verifierRevocationAdmin();
    } catch {
      // Best-effort : ne doit jamais faire échouer l'ouverture d'Espace Admin.
    }
  });

  ipcMain.handle(
    "auth:reinitialiserMotDePasseAdmin",
    async (_evt, usernameAdmin: string, passwordAdmin: string, usernameCible: string, nouveauMotDePasse: string) => {
      try {
        await auth.reinitialiserMotDePasseAdmin(usernameAdmin, passwordAdmin, usernameCible, nouveauMotDePasse);
        return { succes: true as const, resultat: undefined };
      } catch (erreur) {
        return { succes: false as const, message: messageErreur(erreur) };
      }
    },
  );

  ipcMain.handle("auth:listerPatrons", async (_evt, usernameAdmin: string, passwordAdmin: string) =>
    auth.listerPatrons(usernameAdmin, passwordAdmin),
  );

  ipcMain.handle("admin:boutiqueLocale", () => abonnementAdmin.obtenirBoutiqueLocale());
  ipcMain.handle("admin:abonnementEnAttente", () => abonnementAdmin.lireAbonnementEnAttente());
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
    (_evt, params: { boutiqueNom: string; username: string; password: string; email: string }) =>
      executerEnSecurite(() => inscriptionLocale.creerBoutiqueLocale(params)),
  );
  ipcMain.handle(
    "admin:creerBoutiqueEnLigne",
    async (
      _evt,
      usernameAdmin: string,
      passwordAdmin: string,
      params: { boutiqueNom: string; username: string; password: string; email: string },
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

  ipcMain.handle("ventes:creer", (_evt, params: ventes.ParametresVente) => {
    try {
      const vente = ventes.creerVente(params);
      signalerRuptureEnSecurite(params.depotId);
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
  ipcMain.handle("categories:creer", (_evt, boutiqueId: string, nom: string) =>
    executerEnSecurite(() => produits.creerCategorie(boutiqueId, nom)),
  );
  ipcMain.handle("categories:modifier", (_evt, id: string, nom: string) =>
    executerEnSecurite(() => produits.modifierCategorie(id, nom)),
  );
  ipcMain.handle("categories:supprimer", (_evt, id: string) =>
    executerEnSecurite(() => produits.supprimerCategorie(id)),
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

  ipcMain.handle("stock:lister", (_evt, boutiqueId: string, depotId?: string, terme?: string) =>
    stock.listerStock(boutiqueId, depotId, terme),
  );
  ipcMain.handle("stock:obtenirLigne", (_evt, id: string) => stock.obtenirLigneStock(id));

  ipcMain.handle("mouvements:lister", (_evt, boutiqueId: string, depotId?: string, limite?: number) =>
    stock.listerMouvements(boutiqueId, depotId, limite),
  );
  ipcMain.handle("mouvements:listerParProduit", (_evt, produitId: string, limite?: number) =>
    stock.listerMouvementsParProduit(produitId, limite),
  );
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

  ipcMain.handle("transferts:creer", (_evt, params: stock.ParametresTransfert) => {
    const resultat = executerEnSecurite(() => stock.transfererStock(params));
    // Le dépôt source est celui dont le stock baisse (destination augmente).
    if (resultat.succes) signalerRuptureEnSecurite(params.depotSourceId);
    return resultat;
  });
  ipcMain.handle("transferts:lister", (_evt, boutiqueId: string, limite?: number) =>
    stock.listerTransferts(boutiqueId, limite),
  );

  ipcMain.handle("inventaires:lister", (_evt, boutiqueId: string) => stock.listerInventaires(boutiqueId));
  ipcMain.handle(
    "inventaires:demarrer",
    (_evt, boutiqueId: string, depotId: string, utilisateurId: string | null) =>
      executerEnSecurite(() => stock.demarrerInventaire(boutiqueId, depotId, utilisateurId)),
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
  ipcMain.handle("comptes:listerUtilisateurs", (_evt, session: auth.Session) =>
    executerEnSecuriteAsync(() => comptes.listerUtilisateurs(session)),
  );
  ipcMain.handle(
    "comptes:creerUtilisateur",
    (_evt, session: auth.Session, params: comptes.ParametresCreationUtilisateur) =>
      executerEnSecuriteAsync(() => comptes.creerUtilisateur(session, params)),
  );
  ipcMain.handle(
    "comptes:modifierUtilisateur",
    (_evt, session: auth.Session, id: number, champs: comptes.ChampsUtilisateur) =>
      executerEnSecuriteAsync(() => comptes.modifierUtilisateur(session, id, champs)),
  );
  ipcMain.handle("comptes:supprimerUtilisateur", (_evt, session: auth.Session, id: number) =>
    executerEnSecuriteAsync(() => comptes.supprimerUtilisateur(session, id)),
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
  ipcMain.handle("messages:envoyer", (_evt, id: string) => executerEnSecurite(() => messages.envoyerMessage(id)));

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
      const resume = await sync.synchroniser(session);
      return { succes: true as const, ...resume };
    } catch (erreur) {
      return {
        succes: false as const,
        message: messageErreur(erreur),
      };
    }
  });

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
}
