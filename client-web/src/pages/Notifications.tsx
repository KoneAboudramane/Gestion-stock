import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import {
  genererAlertesRupture,
  listerNotifications,
  marquerNotificationsLues,
  type NotificationResume,
} from "../services/notifications";

/**
 * Port de client-electron/src/pages/Notifications.tsx : alertes de rupture de
 * stock, local d'abord (IndexedDB, voir services/notifications.ts). Non repris
 * ici : le bouton "Commander" du détail — lié au flux d'entrée groupée pour
 * boutique sans fournisseur, exclu du périmètre (voir Stock.tsx/Achats.tsx) ;
 * et "marquer comme lue" (pas de cloche de notifications dans l'en-tête ici).
 */
function DetailNotification({
  notification,
  onRetour,
  onNaviguer,
}: {
  notification: NotificationResume;
  onRetour: () => void;
  onNaviguer?: (cible: string) => void;
}) {
  return (
    <div className="detail-produit">
      <div className="entete-detail">
        <h3>Alerte de rupture</h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour à la liste
        </button>
      </div>
      <p>
        {notification.depotNom ?? "Dépôt inconnu"} · {new Date(notification.dateCreation).toLocaleString("fr-FR")}
      </p>
      <p>{notification.message}</p>
      {onNaviguer && (
        <div className="actions-formulaire">
          <button type="button" onClick={() => onNaviguer("stock:rupture")}>
            Voir dans le Stock
          </button>
        </div>
      )}
    </div>
  );
}

const CERCLES_FOND = [
  { taille: 90, couleur: "var(--cercle-1)", duree: 26, delai: -4, depart: ["-15vw", "10vh"], arrivee: ["115vw", "60vh"] },
  { taille: 60, couleur: "var(--cercle-2)", duree: 22, delai: -15, depart: ["115vw", "70vh"], arrivee: ["-15vw", "15vh"] },
  { taille: 120, couleur: "var(--cercle-3)", duree: 32, delai: -9, depart: ["20vw", "115vh"], arrivee: ["75vw", "-20vh"] },
  { taille: 50, couleur: "var(--cercle-4)", duree: 24, delai: -2, depart: ["70vw", "-15vh"], arrivee: ["15vw", "115vh"] },
  { taille: 75, couleur: "var(--cercle-5)", duree: 28, delai: -20, depart: ["-15vw", "90vh"], arrivee: ["110vw", "20vh"] },
  { taille: 100, couleur: "var(--cercle-6)", duree: 30, delai: -12, depart: ["110vw", "25vh"], arrivee: ["-15vw", "85vh"] },
  { taille: 40, couleur: "var(--cercle-1)", duree: 20, delai: -7, depart: ["40vw", "-15vh"], arrivee: ["85vw", "115vh"] },
  { taille: 65, couleur: "var(--cercle-3)", duree: 25, delai: -16, depart: ["105vw", "45vh"], arrivee: ["-10vw", "55vh"] },
  { taille: 85, couleur: "var(--cercle-4)", duree: 34, delai: -5, depart: ["85vw", "110vh"], arrivee: ["10vw", "-15vh"] },
  { taille: 55, couleur: "var(--cercle-6)", duree: 23, delai: -10, depart: ["-10vw", "35vh"], arrivee: ["105vw", "90vh"] },
] as const;

export default function Notifications({
  session,
  onNaviguer,
  onLues,
}: {
  session: Session;
  onNaviguer?: (cible: string) => void;
  onLues?: () => void;
}) {
  const [notificationsListe, setNotificationsListe] = useState<NotificationResume[]>([]);
  const [notificationSelectionneeId, setNotificationSelectionneeId] = useState<string | null>(null);

  // Un caissier verrouillé sur un dépôt (Réglages) ne voit que les
  // notifications de celui-ci. Patron/Gérant (pas de dépôt assigné) voient tout.
  const depotIdEffectif = session.depotId ?? undefined;

  async function rafraichir() {
    setNotificationsListe(await listerNotifications(session.boutiqueId, { depotId: depotIdEffectif }));
  }

  // Le système détecte lui-même les ruptures de stock à chaque ouverture de
  // la page — pas de bouton "Générer" manuel.
  useEffect(() => {
    (async () => {
      await genererAlertesRupture(session.boutiqueId);
      await rafraichir();
      await marquerNotificationsLues(session.boutiqueId, depotIdEffectif);
      onLues?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotIdEffectif]);

  const notificationSelectionnee = notificationsListe.find((n) => n.id === notificationSelectionneeId);
  if (notificationSelectionnee) {
    return (
      <div className="page-produits">
        <DetailNotification
          notification={notificationSelectionnee}
          onRetour={() => setNotificationSelectionneeId(null)}
          onNaviguer={onNaviguer}
        />
      </div>
    );
  }

  return (
    <div className="page-produits page-accueil">
      {CERCLES_FOND.map((c, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="cercle-fond"
          style={
            {
              width: c.taille,
              height: c.taille,
              background: c.couleur,
              animationDuration: `${c.duree}s`,
              animationDelay: `${c.delai}s`,
              "--depart-x": c.depart[0],
              "--depart-y": c.depart[1],
              "--arrivee-x": c.arrivee[0],
              "--arrivee-y": c.arrivee[1],
            } as CSSProperties
          }
        />
      ))}
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Dépôt</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {notificationsListe.map((n, index) => (
              <tr key={n.id} onClick={() => setNotificationSelectionneeId(n.id)}>
                <td>{index + 1}</td>
                <td>{new Date(n.dateCreation).toLocaleString("fr-FR")}</td>
                <td>{n.depotNom ?? ""}</td>
                <td>{n.message}</td>
              </tr>
            ))}
            {notificationsListe.length === 0 && (
              <tr>
                <td colSpan={4} className="liste-vide">
                  Aucune notification.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
