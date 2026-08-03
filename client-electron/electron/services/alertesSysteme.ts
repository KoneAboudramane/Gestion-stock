import { Notification as NotificationSysteme } from "electron";

import { unResultat } from "../db/helpers";
import { obtenirFenetrePrincipale } from "../main";
import { genererAlertesRupture, listerNotifications } from "./notifications";

/**
 * Signale à l'utilisateur (popup système, comme n'importe quelle appli
 * desktop) qu'une action vient de faire apparaître une nouvelle rupture de
 * stock sur SON dépôt — appelée juste après une vente/un mouvement/un
 * transfert qui fait baisser le stock. Ne fait rien d'autre : la détection
 * "au chargement de la page Notifications" (genererAlertesRupture) reste en
 * place comme filet de sécurité.
 *
 * Non testée unitairement (touche `electron.Notification`/la fenêtre
 * principale, indisponibles hors du process principal) — même principe que
 * les autres wrappers fins de ce dossier (ex. abonnement.ts::rafraichirDatePlafond).
 */
export function signalerNouvellesAlertesRupture(depotId: string): void {
  const depot = unResultat<{ boutique_id: string }>("SELECT boutique_id FROM depots WHERE id = ?", [depotId]);
  if (!depot) return;

  const idsCrees = genererAlertesRupture(depot.boutique_id);
  if (idsCrees.length === 0) return;

  // genererAlertesRupture scanne toute la boutique : on ne signale ici que ce
  // qui concerne le dépôt de l'action qui vient d'avoir lieu, pas d'éventuelles
  // ruptures détectées ailleurs par la même occasion.
  const nouvellesPourCeDepot = listerNotifications(depot.boutique_id, { depotId }).filter((n) =>
    idsCrees.includes(n.id),
  );
  if (nouvellesPourCeDepot.length === 0) return;

  if (!NotificationSysteme.isSupported()) return;

  const titre =
    nouvellesPourCeDepot.length === 1
      ? "Alerte de rupture de stock"
      : `${nouvellesPourCeDepot.length} alertes de rupture de stock`;
  const corps = nouvellesPourCeDepot.map((n) => n.message).join("\n");

  const notification = new NotificationSysteme({ title: titre, body: corps });
  notification.on("click", () => {
    const fenetre = obtenirFenetrePrincipale();
    if (!fenetre) return;
    fenetre.show();
    fenetre.focus();
    fenetre.webContents.send("navigation:notifications");
  });
  notification.show();
}
