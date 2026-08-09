import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { LigneAchatInitiale, NotificationResume, Session } from "../api/client";

function DetailNotification({
  notification,
  onRetour,
  onNaviguer,
  onCommander,
}: {
  notification: NotificationResume;
  onRetour: () => void;
  onNaviguer?: (cible: string) => void;
  onCommander?: (lignes: LigneAchatInitiale[]) => void;
}) {
  const [ligneStock, setLigneStock] = useState<LigneAchatInitiale | null>(null);

  useEffect(() => {
    setLigneStock(null);
    if (notification.referenceType === "stock.Stock" && notification.referenceId) {
      api.stock.obtenirLigne(notification.referenceId).then((ligne) => {
        if (ligne) {
          setLigneStock({
            varianteId: ligne.varianteId,
            produitNom: ligne.produitNom,
            prixAchat: ligne.prixAchat,
            prixVente: ligne.prixVente,
            depotId: ligne.depotId,
            depotNom: ligne.depotNom,
          });
        }
      });
    }
  }, [notification.referenceType, notification.referenceId]);

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
      <div className="actions-formulaire">
        {onNaviguer && (
          <button type="button" onClick={() => onNaviguer("stock:rupture")}>
            Voir dans le Stock
          </button>
        )}
        {onCommander && ligneStock && (
          <button type="button" onClick={() => onCommander([ligneStock])}>
            Commander
          </button>
        )}
      </div>
    </div>
  );
}

export default function Notifications({
  session,
  onLues,
  onNaviguer,
  onCommander,
}: {
  session: Session;
  onLues?: () => void;
  onNaviguer?: (cible: string) => void;
  onCommander?: (lignes: LigneAchatInitiale[]) => void;
}) {
  const [notificationsListe, setNotificationsListe] = useState<NotificationResume[]>([]);
  const [notificationSelectionneeId, setNotificationSelectionneeId] = useState<string | null>(null);

  // Un caissier verrouillé sur un dépôt (Réglages) ne doit voir que les
  // notifications de celui-ci. Patron/Gérant (pas de dépôt assigné) voient tout.
  const depotIdEffectif = session.depotId ?? undefined;

  async function rafraichir() {
    setNotificationsListe(await api.notifications.lister(session.boutiqueId, { depotId: depotIdEffectif }));
  }

  // Le système détecte lui-même les ruptures de stock à chaque ouverture de la
  // page — pas besoin d'un bouton "Générer" manuel. Les consulter ici éteint
  // le badge de la cloche pour ce qui a été effectivement affiché (même dépôt).
  useEffect(() => {
    (async () => {
      await api.notifications.genererAlertesRupture(session.boutiqueId);
      await rafraichir();
      await api.notifications.marquerLues(session.boutiqueId, depotIdEffectif);
      onLues?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, depotIdEffectif]);

  const notificationSelectionnee = notificationsListe.find((n) => n.id === notificationSelectionneeId);
  if (notificationSelectionnee) {
    return (
      <div className="page-produits">
        <DetailNotification
          notification={notificationSelectionnee}
          onRetour={() => setNotificationSelectionneeId(null)}
          onNaviguer={onNaviguer}
          onCommander={onCommander}
        />
      </div>
    );
  }

  return (
    <div className="page-produits">
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date</th>
            <th>Dépôt</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {notificationsListe.map((n) => (
            <tr key={n.id} onClick={() => setNotificationSelectionneeId(n.id)}>
              <td>{new Date(n.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{n.depotNom ?? ""}</td>
              <td>{n.message}</td>
            </tr>
          ))}
          {notificationsListe.length === 0 && (
            <tr>
              <td colSpan={3} className="liste-vide">
                Aucune notification.
              </td>
            </tr>
          )}
          {notificationsListe.length > 0 &&
            Array.from({ length: Math.max(0, 10 - notificationsListe.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
