import { useEffect, useState } from "react";

import { api } from "../api";
import type { NotificationResume, Session } from "../api";

/**
 * Port simplifié de client-electron/src/pages/Notifications.tsx : alertes de
 * rupture de stock, en ligne uniquement (voir notifications.ts). Non repris
 * ici : les boutons "Voir dans le Stock"/"Commander" du détail — ils
 * naviguent vers d'autres onglets avec un état pré-rempli côté Electron,
 * un mécanisme de navigation croisée que client-web n'a pas encore ; et
 * "marquer comme lue" (pas de cloche de notifications dans l'en-tête ici,
 * et le modèle serveur n'a pas de champ de lecture).
 */
function DetailNotification({ notification, onRetour }: { notification: NotificationResume; onRetour: () => void }) {
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
    </div>
  );
}

export default function Notifications({ session }: { session: Session }) {
  const [notificationsListe, setNotificationsListe] = useState<NotificationResume[]>([]);
  const [notificationSelectionneeId, setNotificationSelectionneeId] = useState<string | null>(null);

  // Un caissier verrouillé sur un dépôt (Réglages) ne voit que les
  // notifications de celui-ci. Patron/Gérant (pas de dépôt assigné) voient tout.
  const depotIdEffectif = session.depotId ?? undefined;

  async function rafraichir() {
    const resultat = await api.notifications.lister(depotIdEffectif);
    if (resultat.succes) setNotificationsListe(resultat.resultat);
  }

  // Le système détecte lui-même les ruptures de stock à chaque ouverture de
  // la page — pas de bouton "Générer" manuel.
  useEffect(() => {
    (async () => {
      await api.notifications.genererAlertesRupture();
      await rafraichir();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotIdEffectif]);

  const notificationSelectionnee = notificationsListe.find((n) => n.id === notificationSelectionneeId);
  if (notificationSelectionnee) {
    return (
      <div className="page-produits">
        <DetailNotification notification={notificationSelectionnee} onRetour={() => setNotificationSelectionneeId(null)} />
      </div>
    );
  }

  return (
    <div className="page-produits">
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
