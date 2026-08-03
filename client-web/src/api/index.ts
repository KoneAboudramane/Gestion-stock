import * as authFns from "./auth";
import * as comptesFns from "./comptes";
import * as rapportsFns from "./rapports";
import * as stockFns from "./stock";
import * as boutiqueFns from "./boutique";

/** Point d'entrée unique des appels API, dans le même esprit que `window.api` côté Electron. */
export const api = {
  auth: authFns,
  comptes: comptesFns,
  rapports: rapportsFns,
  stock: { lister: stockFns.listerStock },
  depots: { lister: stockFns.listerDepots },
  reglages: { obtenirBoutique: boutiqueFns.obtenirBoutique },
};

export * from "./auth";
export * from "./comptes";
export * from "./rapports";
export * from "./stock";
export * from "./boutique";
export * from "./transport";
