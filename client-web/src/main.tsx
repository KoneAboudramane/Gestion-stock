import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import BoutonAgrandirModales from "./components/BoutonAgrandirModales";
import { SessionProvider } from "./contexts/SessionContext";
import { activerBoutonRetourAndroid } from "./lib/appliAndroid";
import { initialiserTheme } from "./lib/theme";
import { demarrerBoucleCaisse } from "./services/reseau";
import { lancerPostePrincipal } from "./services/reseauPrincipal";
import { lancerSauvegardePlanifiee } from "./services/sauvegarde";
import "./index.css";
import "../../partage/styles/admin.css";

initialiserTheme();
activerBoutonRetourAndroid();
// Réseau de la boutique : le poste principal rouvre son serveur, une caisse branchée
// reprend ses échanges toutes les 4 s (rien ne se passe sur un appareil seul).
lancerPostePrincipal();
demarrerBoucleCaisse();
// Sauvegarde chiffrée (appli mobile) : vérifiée au démarrage, toutes les 5 min et en passant en arrière-plan.
lancerSauvegardePlanifiee();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionProvider>
      <App />
      <BoutonAgrandirModales />
    </SessionProvider>
  </React.StrictMode>,
);
