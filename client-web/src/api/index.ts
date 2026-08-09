import * as achatsFns from "./achats";
import * as authFns from "./auth";
import * as catalogueFns from "./catalogue";
import * as clientsFns from "./clients";
import * as comptesFns from "./comptes";
import * as configurationFns from "./configuration";
import * as fournisseursFns from "./fournisseurs";
import * as messagesFns from "./messages";
import * as notificationsFns from "./notifications";
import * as rapportsFns from "./rapports";
import * as stockFns from "./stock";
import * as boutiqueFns from "./boutique";
import * as ventesFns from "./ventes";
import * as syncFns from "../sync";

/** Point d'entrée unique des appels API, dans le même esprit que `window.api` côté Electron. */
export const api = {
  auth: authFns,
  comptes: comptesFns,
  rapports: rapportsFns,
  stock: { lister: stockFns.listerStock },
  depots: {
    lister: stockFns.listerDepots,
    creer: stockFns.creerDepot,
    modifier: stockFns.modifierDepot,
    supprimer: stockFns.supprimerDepot,
  },
  reglages: {
    obtenirBoutique: boutiqueFns.obtenirBoutique,
    modifierBoutique: boutiqueFns.modifierBoutique,
    listerParametres: configurationFns.listerParametres,
    definirParametre: configurationFns.definirParametre,
    supprimerParametre: configurationFns.supprimerParametre,
  },
  sync: { executer: syncFns.synchroniser, etat: syncFns.etatSynchro },
  categories: {
    lister: catalogueFns.listerCategories,
    creer: catalogueFns.creerCategorie,
    modifier: catalogueFns.modifierCategorie,
    supprimer: catalogueFns.supprimerCategorie,
  },
  unites: {
    lister: catalogueFns.listerUnites,
    creer: catalogueFns.creerUnite,
    modifier: catalogueFns.modifierUnite,
    supprimer: catalogueFns.supprimerUnite,
  },
  attributs: {
    lister: catalogueFns.listerAttributs,
    creer: catalogueFns.creerAttribut,
    modifier: catalogueFns.modifierAttribut,
    supprimer: catalogueFns.supprimerAttribut,
  },
  produits: {
    lister: catalogueFns.listerProduits,
    obtenir: catalogueFns.obtenirProduit,
    creer: catalogueFns.creerProduit,
    modifier: catalogueFns.modifierProduit,
    supprimer: catalogueFns.supprimerProduit,
  },
  variantes: { modifier: catalogueFns.modifierVariante },
  mouvements: { creer: catalogueFns.creerMouvementEntree },
  clients: {
    lister: clientsFns.listerClients,
    creer: clientsFns.creerClient,
    modifier: clientsFns.modifierClient,
    supprimer: clientsFns.supprimerClient,
  },
  credits: {
    lister: clientsFns.listerCredits,
    obtenir: clientsFns.obtenirCredit,
    rembourser: clientsFns.rembourserCredit,
  },
  ventes: { lister: ventesFns.listerVentes, annuler: ventesFns.annulerVente },
  commandes: {
    lister: achatsFns.listerCommandes,
    obtenir: achatsFns.obtenirCommande,
    creer: achatsFns.creerCommande,
    modifier: achatsFns.modifierCommande,
    receptionner: achatsFns.receptionnerCommande,
  },
  variantesAchat: { rechercher: achatsFns.rechercherVariantes },
  fournisseurs: {
    lister: fournisseursFns.listerFournisseurs,
    creer: fournisseursFns.creerFournisseur,
  },
  dettes: {
    lister: fournisseursFns.listerDettes,
    payer: fournisseursFns.payerDette,
  },
  messages: {
    lister: messagesFns.listerMessages,
    genererRappelsCredit: messagesFns.genererRappelsCredit,
    envoyer: messagesFns.envoyerMessage,
  },
  notifications: {
    lister: notificationsFns.listerNotifications,
    genererAlertesRupture: notificationsFns.genererAlertesRupture,
  },
};

export * from "./achats";
export * from "./auth";
export * from "./catalogue";
export * from "./clients";
export * from "./comptes";
export * from "./configuration";
export * from "./fournisseurs";
export * from "./messages";
export * from "./notifications";
export * from "./rapports";
export * from "./stock";
export * from "./boutique";
export * from "./ventes";
export * from "./transport";
