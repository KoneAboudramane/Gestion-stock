import { contextBridge, ipcRenderer } from "electron";

// Aucun accès Node direct au renderer (contextIsolation) : seule cette
// surface explicite est exposée via window.api.
contextBridge.exposeInMainWorld("api", {
  auth: {
    connexion: (username: string, password: string) =>
      ipcRenderer.invoke("auth:connexion", username, password),
    inscription: (params: { boutiqueNom: string; username: string; password: string; email: string }) =>
      ipcRenderer.invoke("auth:inscription", params),
    verifierAccesAdmin: (username: string, password: string) =>
      ipcRenderer.invoke("auth:verifierAccesAdmin", username, password),
    verifierRevocationAdmin: () => ipcRenderer.invoke("auth:verifierRevocationAdmin"),
    session: () => ipcRenderer.invoke("auth:session"),
    deconnexion: () => ipcRenderer.invoke("auth:deconnexion"),
    rafraichirPermissions: (session: unknown) => ipcRenderer.invoke("auth:rafraichirPermissions", session),
    demanderReinitialisationMotDePasse: (email: string) =>
      ipcRenderer.invoke("auth:demanderReinitialisationMotDePasse", email),
    reinitialiserMotDePasse: (email: string, code: string, nouveauMotDePasse: string) =>
      ipcRenderer.invoke("auth:reinitialiserMotDePasse", email, code, nouveauMotDePasse),
    reinitialiserMotDePasseAdmin: (
      usernameAdmin: string,
      passwordAdmin: string,
      usernameCible: string,
      nouveauMotDePasse: string,
    ) =>
      ipcRenderer.invoke(
        "auth:reinitialiserMotDePasseAdmin",
        usernameAdmin,
        passwordAdmin,
        usernameCible,
        nouveauMotDePasse,
      ),
    listerPatrons: (usernameAdmin: string, passwordAdmin: string) =>
      ipcRenderer.invoke("auth:listerPatrons", usernameAdmin, passwordAdmin),
  },
  admin: {
    boutiqueLocale: () => ipcRenderer.invoke("admin:boutiqueLocale"),
    abonnementEnAttente: () => ipcRenderer.invoke("admin:abonnementEnAttente"),
    soumettreAbonnement: (
      username: string,
      password: string,
      boutiqueId: string,
      boutiqueNom: string,
      champs: { formule?: string; dateExpirationAbonnement?: string | null; synchroAutorisee?: boolean },
    ) => ipcRenderer.invoke("admin:soumettreAbonnement", username, password, boutiqueId, boutiqueNom, champs),
    creerBoutiqueLocale: (params: { boutiqueNom: string; username: string; password: string; email: string }) =>
      ipcRenderer.invoke("admin:creerBoutiqueLocale", params),
    creerBoutiqueEnLigne: (
      usernameAdmin: string,
      passwordAdmin: string,
      params: { boutiqueNom: string; username: string; password: string; email: string },
    ) => ipcRenderer.invoke("admin:creerBoutiqueEnLigne", usernameAdmin, passwordAdmin, params),
    boutiqueLocaleEnAttente: () => ipcRenderer.invoke("admin:boutiqueLocaleEnAttente"),
    activerEnLigne: (usernameAdmin: string, passwordAdmin: string, patronPassword: string, session: unknown) =>
      ipcRenderer.invoke("admin:activerEnLigne", usernameAdmin, passwordAdmin, patronPassword, session),
  },
  catalogue: {
    rechercherVariantes: (boutiqueId: string, terme: string) =>
      ipcRenderer.invoke("catalogue:rechercherVariantes", boutiqueId, terme),
    listerVariantesCatalogue: (boutiqueId: string, depotId?: string) =>
      ipcRenderer.invoke("catalogue:listerVariantesCatalogue", boutiqueId, depotId),
    listerDepots: (boutiqueId: string) => ipcRenderer.invoke("catalogue:listerDepots", boutiqueId),
    listerClients: (boutiqueId: string) => ipcRenderer.invoke("catalogue:listerClients", boutiqueId),
    obtenirStock: (varianteId: string, depotId: string) =>
      ipcRenderer.invoke("catalogue:obtenirStock", varianteId, depotId),
  },
  ventes: {
    creer: (params: unknown) => ipcRenderer.invoke("ventes:creer", params),
    lister: (
      boutiqueId: string,
      depotId?: string,
      statut?: string,
      terme?: string,
      limite?: number,
      clientId?: string,
    ) => ipcRenderer.invoke("ventes:lister", boutiqueId, depotId, statut, terme, limite, clientId),
    obtenir: (id: string) => ipcRenderer.invoke("ventes:obtenir", id),
    annuler: (id: string, utilisateurId: string | null) =>
      ipcRenderer.invoke("ventes:annuler", id, utilisateurId),
    listerParProduit: (produitId: string, limite?: number) =>
      ipcRenderer.invoke("ventes:listerParProduit", produitId, limite),
  },
  produits: {
    lister: (boutiqueId: string, terme?: string) => ipcRenderer.invoke("produits:lister", boutiqueId, terme),
    obtenir: (id: string) => ipcRenderer.invoke("produits:obtenir", id),
    creer: (params: unknown) => ipcRenderer.invoke("produits:creer", params),
    modifier: (id: string, champs: unknown) => ipcRenderer.invoke("produits:modifier", id, champs),
    supprimer: (id: string) => ipcRenderer.invoke("produits:supprimer", id),
    prochaineReference: (boutiqueId: string) => ipcRenderer.invoke("produits:prochaineReference", boutiqueId),
  },
  variantes: {
    creer: (params: unknown) => ipcRenderer.invoke("variantes:creer", params),
    modifier: (id: string, champs: unknown) => ipcRenderer.invoke("variantes:modifier", id, champs),
  },
  categories: {
    lister: (boutiqueId: string) => ipcRenderer.invoke("categories:lister", boutiqueId),
    creer: (boutiqueId: string, nom: string) => ipcRenderer.invoke("categories:creer", boutiqueId, nom),
    modifier: (id: string, nom: string) => ipcRenderer.invoke("categories:modifier", id, nom),
    supprimer: (id: string) => ipcRenderer.invoke("categories:supprimer", id),
  },
  unites: {
    lister: (boutiqueId: string) => ipcRenderer.invoke("unites:lister", boutiqueId),
    creer: (boutiqueId: string, nom: string, abreviation?: string) =>
      ipcRenderer.invoke("unites:creer", boutiqueId, nom, abreviation),
    modifier: (id: string, champs: unknown) => ipcRenderer.invoke("unites:modifier", id, champs),
    supprimer: (id: string) => ipcRenderer.invoke("unites:supprimer", id),
  },
  attributs: {
    lister: (boutiqueId: string) => ipcRenderer.invoke("attributs:lister", boutiqueId),
    creer: (boutiqueId: string, nom: string) => ipcRenderer.invoke("attributs:creer", boutiqueId, nom),
    modifier: (id: string, nom: string) => ipcRenderer.invoke("attributs:modifier", id, nom),
    supprimer: (id: string) => ipcRenderer.invoke("attributs:supprimer", id),
    listerValeurs: (attributId: string) => ipcRenderer.invoke("attributs:listerValeurs", attributId),
    creerValeur: (attributId: string, valeur: string) =>
      ipcRenderer.invoke("attributs:creerValeur", attributId, valeur),
  },
  depots: {
    lister: (boutiqueId: string) => ipcRenderer.invoke("depots:lister", boutiqueId),
    creer: (boutiqueId: string, nom: string, adresse?: string) =>
      ipcRenderer.invoke("depots:creer", boutiqueId, nom, adresse),
    modifier: (id: string, champs: unknown) => ipcRenderer.invoke("depots:modifier", id, champs),
    supprimer: (id: string) => ipcRenderer.invoke("depots:supprimer", id),
  },
  stock: {
    lister: (boutiqueId: string, depotId?: string, terme?: string) =>
      ipcRenderer.invoke("stock:lister", boutiqueId, depotId, terme),
    obtenirLigne: (id: string) => ipcRenderer.invoke("stock:obtenirLigne", id),
  },
  mouvements: {
    lister: (boutiqueId: string, depotId?: string, limite?: number) =>
      ipcRenderer.invoke("mouvements:lister", boutiqueId, depotId, limite),
    listerParProduit: (produitId: string, limite?: number) =>
      ipcRenderer.invoke("mouvements:listerParProduit", produitId, limite),
    creer: (params: unknown) => ipcRenderer.invoke("mouvements:creer", params),
    creerEntreeProduction: (params: unknown) => ipcRenderer.invoke("mouvements:creerEntreeProduction", params),
  },
  transferts: {
    creer: (params: unknown) => ipcRenderer.invoke("transferts:creer", params),
    lister: (boutiqueId: string, limite?: number) => ipcRenderer.invoke("transferts:lister", boutiqueId, limite),
  },
  inventaires: {
    lister: (boutiqueId: string) => ipcRenderer.invoke("inventaires:lister", boutiqueId),
    demarrer: (boutiqueId: string, depotId: string, utilisateurId: string | null) =>
      ipcRenderer.invoke("inventaires:demarrer", boutiqueId, depotId, utilisateurId),
    obtenir: (id: string) => ipcRenderer.invoke("inventaires:obtenir", id),
    validerLigne: (id: string, qtePhysique: number) => ipcRenderer.invoke("inventaires:validerLigne", id, qtePhysique),
    valider: (id: string, utilisateurId: string | null) =>
      ipcRenderer.invoke("inventaires:valider", id, utilisateurId),
  },
  fournisseurs: {
    lister: (boutiqueId: string) => ipcRenderer.invoke("fournisseurs:lister", boutiqueId),
    creer: (boutiqueId: string, nom: string, telephone?: string, adresse?: string, contact?: string) =>
      ipcRenderer.invoke("fournisseurs:creer", boutiqueId, nom, telephone, adresse, contact),
    modifier: (id: string, champs: unknown) => ipcRenderer.invoke("fournisseurs:modifier", id, champs),
    derniers: (boutiqueId: string, varianteIds: string[]) =>
      ipcRenderer.invoke("fournisseurs:derniers", boutiqueId, varianteIds),
  },
  commandes: {
    lister: (boutiqueId: string, fournisseurId?: string, statut?: string, terme?: string) =>
      ipcRenderer.invoke("commandes:lister", boutiqueId, fournisseurId, statut, terme),
    obtenir: (id: string) => ipcRenderer.invoke("commandes:obtenir", id),
    creer: (params: unknown) => ipcRenderer.invoke("commandes:creer", params),
    modifier: (id: string, champs: unknown) => ipcRenderer.invoke("commandes:modifier", id, champs),
    receptionner: (params: unknown) => ipcRenderer.invoke("commandes:receptionner", params),
  },
  dettes: {
    lister: (boutiqueId: string, fournisseurId?: string, statut?: string) =>
      ipcRenderer.invoke("dettes:lister", boutiqueId, fournisseurId, statut),
    payer: (id: string, montant: number, mode?: string, depotId?: string | null, utilisateurId?: string | null) =>
      ipcRenderer.invoke("dettes:payer", id, montant, mode, depotId, utilisateurId),
    listerPaiements: (detteId: string) => ipcRenderer.invoke("dettes:listerPaiements", detteId),
  },
  clients: {
    lister: (boutiqueId: string, terme?: string) => ipcRenderer.invoke("clients:lister", boutiqueId, terme),
    obtenir: (id: string) => ipcRenderer.invoke("clients:obtenir", id),
    creer: (boutiqueId: string, nom: string, telephone?: string, adresse?: string, estPermanent?: boolean) =>
      ipcRenderer.invoke("clients:creer", boutiqueId, nom, telephone, adresse, estPermanent),
    modifier: (id: string, champs: unknown) => ipcRenderer.invoke("clients:modifier", id, champs),
    supprimer: (id: string) => ipcRenderer.invoke("clients:supprimer", id),
  },
  credits: {
    lister: (boutiqueId: string, clientId?: string, statut?: string) =>
      ipcRenderer.invoke("credits:lister", boutiqueId, clientId, statut),
    obtenir: (id: string) => ipcRenderer.invoke("credits:obtenir", id),
    rembourser: (id: string, montant: number, mode?: string, depotId?: string | null, utilisateurId?: string | null) =>
      ipcRenderer.invoke("credits:rembourser", id, montant, mode, depotId, utilisateurId),
  },
  rapports: {
    plageDates: (periode?: string, dateDebut?: string, dateFin?: string) =>
      ipcRenderer.invoke("rapports:plageDates", periode, dateDebut, dateFin),
    syntheseVentes: (boutiqueId: string, debut: string, fin: string) =>
      ipcRenderer.invoke("rapports:syntheseVentes", boutiqueId, debut, fin),
    topProduits: (boutiqueId: string, debut: string, fin: string, limite?: number, ordre?: string) =>
      ipcRenderer.invoke("rapports:topProduits", boutiqueId, debut, fin, limite, ordre),
    valeurStock: (boutiqueId: string, depotId?: string) =>
      ipcRenderer.invoke("rapports:valeurStock", boutiqueId, depotId),
    ventesParVendeur: (boutiqueId: string, debut: string, fin: string) =>
      ipcRenderer.invoke("rapports:ventesParVendeur", boutiqueId, debut, fin),
    ventesParCategorie: (boutiqueId: string, debut: string, fin: string) =>
      ipcRenderer.invoke("rapports:ventesParCategorie", boutiqueId, debut, fin),
    ventesParModePaiement: (boutiqueId: string, debut: string, fin: string) =>
      ipcRenderer.invoke("rapports:ventesParModePaiement", boutiqueId, debut, fin),
    ventesParJour: (boutiqueId: string, debut: string, fin: string) =>
      ipcRenderer.invoke("rapports:ventesParJour", boutiqueId, debut, fin),
    topClients: (boutiqueId: string, debut: string, fin: string, limite?: number) =>
      ipcRenderer.invoke("rapports:topClients", boutiqueId, debut, fin, limite),
    exporter: (
      titre: string,
      colonnes: unknown,
      lignes: unknown,
      format: string,
      cheminForce?: string,
    ) => ipcRenderer.invoke("rapports:exporter", titre, colonnes, lignes, format, cheminForce),
  },
  comptabilite: {
    planComptable: () => ipcRenderer.invoke("comptabilite:planComptable"),
    journal: (boutiqueId: string, debut: string, fin: string, journalCode?: string) =>
      ipcRenderer.invoke("comptabilite:journal", boutiqueId, debut, fin, journalCode),
    grandLivre: (boutiqueId: string, compte: string, debut: string, fin: string) =>
      ipcRenderer.invoke("comptabilite:grandLivre", boutiqueId, compte, debut, fin),
    balance: (boutiqueId: string, debut: string, fin: string) =>
      ipcRenderer.invoke("comptabilite:balance", boutiqueId, debut, fin),
    compteDeResultat: (boutiqueId: string, debut: string, fin: string) =>
      ipcRenderer.invoke("comptabilite:compteDeResultat", boutiqueId, debut, fin),
    bilan: (boutiqueId: string, dateFin: string) => ipcRenderer.invoke("comptabilite:bilan", boutiqueId, dateFin),
    journalOfficiel: (session: unknown, debut: string, fin: string, journalCode?: string) =>
      ipcRenderer.invoke("comptabilite:journalOfficiel", session, debut, fin, journalCode),
    grandLivreOfficiel: (session: unknown, compte: string, debut: string, fin: string) =>
      ipcRenderer.invoke("comptabilite:grandLivreOfficiel", session, compte, debut, fin),
    balanceOfficielle: (session: unknown, debut: string, fin: string) =>
      ipcRenderer.invoke("comptabilite:balanceOfficielle", session, debut, fin),
    compteDeResultatOfficiel: (session: unknown, debut: string, fin: string) =>
      ipcRenderer.invoke("comptabilite:compteDeResultatOfficiel", session, debut, fin),
    bilanOfficiel: (session: unknown, dateFin: string) =>
      ipcRenderer.invoke("comptabilite:bilanOfficiel", session, dateFin),
  },
  reglages: {
    obtenirBoutique: (boutiqueId: string) => ipcRenderer.invoke("reglages:obtenirBoutique", boutiqueId),
    modifierBoutique: (id: string, champs: unknown) => ipcRenderer.invoke("reglages:modifierBoutique", id, champs),
    obtenirLogoBoutique: (boutiqueId: string) => ipcRenderer.invoke("reglages:obtenirLogoBoutique", boutiqueId),
    definirLogoBoutique: (boutiqueId: string, logo: string) =>
      ipcRenderer.invoke("reglages:definirLogoBoutique", boutiqueId, logo),
    listerParametres: (boutiqueId: string) => ipcRenderer.invoke("reglages:listerParametres", boutiqueId),
    definirParametre: (boutiqueId: string, cle: string, valeur: string) =>
      ipcRenderer.invoke("reglages:definirParametre", boutiqueId, cle, valeur),
    supprimerParametre: (id: string) => ipcRenderer.invoke("reglages:supprimerParametre", id),
  },
  comptes: {
    listerRoles: (session: unknown) => ipcRenderer.invoke("comptes:listerRoles", session),
    modifierRole: (session: unknown, id: string, permissions: unknown) =>
      ipcRenderer.invoke("comptes:modifierRole", session, id, permissions),
    listerUtilisateurs: (session: unknown) => ipcRenderer.invoke("comptes:listerUtilisateurs", session),
    creerUtilisateur: (session: unknown, params: unknown) =>
      ipcRenderer.invoke("comptes:creerUtilisateur", session, params),
    modifierUtilisateur: (session: unknown, id: number, champs: unknown) =>
      ipcRenderer.invoke("comptes:modifierUtilisateur", session, id, champs),
    supprimerUtilisateur: (session: unknown, id: number) =>
      ipcRenderer.invoke("comptes:supprimerUtilisateur", session, id),
  },
  paiements: {
    initier: (params: unknown) => ipcRenderer.invoke("paiements:initier", params),
    obtenirTransaction: (paiementId: string) => ipcRenderer.invoke("paiements:obtenirTransaction", paiementId),
  },
  notifications: {
    lister: (boutiqueId: string, filtres?: unknown) => ipcRenderer.invoke("notifications:lister", boutiqueId, filtres),
    genererAlertesRupture: (boutiqueId: string) =>
      ipcRenderer.invoke("notifications:genererAlertesRupture", boutiqueId),
    compterNonLues: (boutiqueId: string, depotId?: string) =>
      ipcRenderer.invoke("notifications:compterNonLues", boutiqueId, depotId),
    marquerLues: (boutiqueId: string, depotId?: string) =>
      ipcRenderer.invoke("notifications:marquerLues", boutiqueId, depotId),
  },
  messages: {
    lister: (boutiqueId: string, filtres?: unknown) => ipcRenderer.invoke("messages:lister", boutiqueId, filtres),
    genererRappelsCredit: (boutiqueId: string) => ipcRenderer.invoke("messages:genererRappelsCredit", boutiqueId),
    genererTicketWhatsapp: (venteId: string) => ipcRenderer.invoke("messages:genererTicketWhatsapp", venteId),
    envoyer: (id: string) => ipcRenderer.invoke("messages:envoyer", id),
  },
  tresorerie: {
    solde: (depotId: string, jusqua?: string) => ipcRenderer.invoke("tresorerie:solde", depotId, jusqua),
    listerMouvements: (depotId: string, limite?: number) =>
      ipcRenderer.invoke("tresorerie:listerMouvements", depotId, limite),
    listerDepenses: (depotId: string, limite?: number) =>
      ipcRenderer.invoke("tresorerie:listerDepenses", depotId, limite),
    enregistrerDepense: (
      depotId: string,
      categorie: string,
      montant: number,
      description?: string,
      utilisateurId?: string | null,
    ) => ipcRenderer.invoke("tresorerie:enregistrerDepense", depotId, categorie, montant, description, utilisateurId),
    effectuerRetrait: (depotId: string, montant: number, motif?: string, utilisateurId?: string | null) =>
      ipcRenderer.invoke("tresorerie:effectuerRetrait", depotId, montant, motif, utilisateurId),
    enregistrerApport: (depotId: string, montant: number, motif?: string, utilisateurId?: string | null) =>
      ipcRenderer.invoke("tresorerie:enregistrerApport", depotId, montant, motif, utilisateurId),
    ajusterCaisse: (depotId: string, montantSigne: number, motif: string, utilisateurId?: string | null) =>
      ipcRenderer.invoke("tresorerie:ajusterCaisse", depotId, montantSigne, motif, utilisateurId),
    soldeMobileMoneyDisponible: (boutiqueId: string, utilisateurSourceId: string, operateur: string) =>
      ipcRenderer.invoke("tresorerie:soldeMobileMoneyDisponible", boutiqueId, utilisateurSourceId, operateur),
    effectuerTransfert: (params: unknown) => ipcRenderer.invoke("tresorerie:effectuerTransfert", params),
    listerTransferts: (depotId: string, limite?: number) =>
      ipcRenderer.invoke("tresorerie:listerTransferts", depotId, limite),
    listerClotures: (depotId: string, limite?: number) =>
      ipcRenderer.invoke("tresorerie:listerClotures", depotId, limite),
    cloturer: (depotId: string, soldeCompte: number, utilisateurId?: string | null) =>
      ipcRenderer.invoke("tresorerie:cloturer", depotId, soldeCompte, utilisateurId),
  },
  sync: {
    executer: (session: unknown) => ipcRenderer.invoke("sync:executer", session),
    etat: () => ipcRenderer.invoke("sync:etat"),
  },
  systeme: {
    /** Clic sur le popup système d'alerte de rupture : demande d'aller sur la page Notifications. */
    onNaviguerNotifications: (callback: () => void) => {
      const ecouteur = () => callback();
      ipcRenderer.on("navigation:notifications", ecouteur);
      return () => ipcRenderer.removeListener("navigation:notifications", ecouteur);
    },
    exporterPdf: (nomFichierDefaut: string) => ipcRenderer.invoke("systeme:exporterPdf", nomFichierDefaut),
    ouvrirExterne: (url: string) => ipcRenderer.invoke("systeme:ouvrirExterne", url),
    version: () => ipcRenderer.invoke("systeme:version"),
  },
});
