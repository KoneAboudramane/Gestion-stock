import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type { LigneAchatInitiale, NotificationResume, Session, TypeNotification } from "../api/client";
import FiltrePeriodeHistorique from "../components/FiltrePeriodeHistorique";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";

/** Présentation et suite logique de chaque type d'alerte. */
const INFOS_TYPE: Record<TypeNotification, { titre: string; icone: string; retard: boolean; actions: { libelle: string; cible: string }[] }> = {
  alerte_rupture: { titre: "Rupture de stock", icone: "📦", retard: false, actions: [{ libelle: "Voir dans le Stock", cible: "stock:rupture" }] },
  alerte_dormants: {
    titre: "Produits dormants",
    icone: "😴",
    retard: false,
    actions: [{ libelle: "Voir les produits dormants", cible: "rapports:dormants" }],
  },
  fin_destockage: { titre: "Fin de déstockage", icone: "🏷️", retard: false, actions: [{ libelle: "Voir les déstockages", cible: "rapports:destockages" }] },
  echeance_proche: { titre: "Échéance fournisseur proche", icone: "🚚", retard: false, actions: [{ libelle: "Ouvrir Achats → Dettes", cible: "achats" }] },
  echeance_retard: { titre: "Échéance fournisseur en retard", icone: "🚚", retard: true, actions: [{ libelle: "Ouvrir Achats → Dettes", cible: "achats" }] },
  credit_proche: { titre: "Échéance de crédit client proche", icone: "💳", retard: false, actions: [{ libelle: "Ouvrir les crédits clients", cible: "clients:credits" }] },
  credit_retard: { titre: "Crédit client en retard", icone: "💳", retard: true, actions: [{ libelle: "Ouvrir les crédits clients", cible: "clients:credits" }] },
  commande_proche: { titre: "Livraison de commande proche", icone: "📋", retard: false, actions: [{ libelle: "Ouvrir les commandes clients", cible: "clients:commandes" }] },
  commande_retard: { titre: "Commande client en retard", icone: "📋", retard: true, actions: [{ libelle: "Ouvrir les commandes clients", cible: "clients:commandes" }] },
  abonnement_proche: { titre: "Fin d'abonnement proche", icone: "⭐", retard: false, actions: [{ libelle: "Voir l'abonnement", cible: "abonnement" }] },
  abonnement_expire: { titre: "Abonnement expiré", icone: "⭐", retard: true, actions: [{ libelle: "Voir l'abonnement", cible: "abonnement" }] },
};

const CATEGORIES: { cle: string; label: string; icone: string; types: TypeNotification[] | null }[] = [
  { cle: "toutes", label: "Toutes", icone: "🔔", types: null },
  { cle: "rupture", label: "Ruptures de stock", icone: "📦", types: ["alerte_rupture"] },
  { cle: "echeances", label: "Échéances fournisseurs", icone: "🚚", types: ["echeance_proche", "echeance_retard"] },
  { cle: "credits", label: "Crédits clients", icone: "💳", types: ["credit_proche", "credit_retard"] },
  { cle: "commandes", label: "Commandes clients", icone: "📋", types: ["commande_proche", "commande_retard"] },
  { cle: "abonnement", label: "Abonnement", icone: "⭐", types: ["abonnement_proche", "abonnement_expire"] },
  { cle: "destockage", label: "Déstockages", icone: "🏷️", types: ["fin_destockage"] },
  { cle: "dormants", label: "Produits dormants", icone: "😴", types: ["alerte_dormants"] },
];

function infosType(type: string) {
  return INFOS_TYPE[type as TypeNotification] ?? { titre: "Notification", icone: "🔔", retard: false, actions: [] };
}

/** « il y a 5 min », « il y a 2 h », « hier », puis la date. */
function dateRelative(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  if (jours === 1) return "hier";
  if (jours < 7) return `il y a ${jours} jours`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

function EnteteModale({ titre, onFermer }: { titre: string; onFermer: () => void }) {
  return (
    <div className="modale-entete">
      <h3>{titre}</h3>
      <button type="button" className="lien bouton-retour" onClick={onFermer}>
        ← Retour
      </button>
    </div>
  );
}

function DetailNotification({
  notification,
  onFermer,
  onNaviguer,
  onCommander,
}: {
  notification: NotificationResume;
  onFermer: () => void;
  onNaviguer?: (cible: string) => void;
  onCommander?: (lignes: LigneAchatInitiale[]) => void;
}) {
  const infos = infosType(notification.type);
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
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-confirmation modale-detail-notification" onClick={(e) => e.stopPropagation()}>
        <h3>
          {infos.icone} {infos.titre}
        </h3>
        <p className="sous-info">
          {notification.depotNom ?? "Tous les dépôts"} · {new Date(notification.dateCreation).toLocaleString("fr-FR")}
        </p>
        <p className={infos.retard ? "texte-erreur" : undefined}>{notification.message}</p>
        <div className="actions-formulaire">
          <button type="button" onClick={onFermer}>
            Fermer
          </button>
          {onNaviguer &&
            infos.actions.map((a) => (
              <button key={a.cible} type="button" onClick={() => onNaviguer(a.cible)}>
                {a.libelle} →
              </button>
            ))}
          {onCommander && ligneStock && (
            <button type="button" className="bouton-primaire" onClick={() => onCommander([ligneStock])}>
              🛒 Commander
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModaleListeNotifications({
  titre,
  notifications,
  onOuvrir,
  onFermer,
}: {
  titre: string;
  notifications: NotificationResume[];
  onOuvrir: (n: NotificationResume) => void;
  onFermer: () => void;
}) {
  const [periode, setPeriode] = useState<PeriodeHistorique>("tout");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [depot, setDepot] = useState("");
  const [terme, setTerme] = useState("");
  const depots = [...new Set(notifications.map((n) => n.depotNom ?? ""))].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));
  const cle = terme.trim().toLowerCase();
  const filtrees = notifications.filter(
    (n) =>
      dansPeriode(n.dateCreation, bornesPeriode(periode, debutPerso, finPerso)) &&
      (!depot || n.depotNom === depot) &&
      (!cle || n.message.toLowerCase().includes(cle)),
  );
  const nouvelles = filtrees.filter((n) => !n.lu).length;
  const enRetard = filtrees.filter((n) => infosType(n.type).retard).length;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={titre} onFermer={onFermer} />
        <div className="modale-corps">
          <div className="tuiles-fiche">
            <div className="tuile-fiche">
              <span className="sous-info">🔔 Notifications</span>
              <strong>{filtrees.length}</strong>
            </div>
            <div className={`tuile-fiche${nouvelles > 0 ? " tuile-fiche--attention" : ""}`}>
              <span className="sous-info">✨ Nouvelles depuis votre dernière visite</span>
              <strong>{nouvelles}</strong>
            </div>
            <div className={`tuile-fiche${enRetard > 0 ? " tuile-fiche--alerte" : ""}`}>
              <span className="sous-info">⏰ En retard</span>
              <strong>{enRetard}</strong>
            </div>
          </div>
          <div className="barre-actions barre-filtres-historique">
            <FiltrePeriodeHistorique
              periode={periode}
              setPeriode={setPeriode}
              debutPerso={debutPerso}
              setDebutPerso={setDebutPerso}
              finPerso={finPerso}
              setFinPerso={setFinPerso}
            />
            {depots.length > 1 && (
              <select value={depot} onChange={(e) => setDepot(e.target.value)}>
                <option value="">Tous les dépôts</option>
                {depots.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            <input type="search" placeholder="Rechercher dans les messages…" value={terme} onChange={(e) => setTerme(e.target.value)} />
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Dépôt</th>
                  <th>Quand</th>
                </tr>
              </thead>
              <tbody>
                {filtrees.map((n) => {
                  const infos = infosType(n.type);
                  return (
                    <tr key={n.id} onClick={() => onOuvrir(n)} className={n.lu ? undefined : "ligne-non-lue"} title="Voir le détail">
                      <td className="nowrap">
                        <span className={infos.retard ? "badge-annulee" : "badge-brouillon"}>
                          {infos.icone} {infos.titre}
                        </span>
                      </td>
                      <td>
                        {!n.lu && <span className="badge-commandee">Nouveau</span>} {n.message}
                      </td>
                      <td>{n.depotNom ?? "—"}</td>
                      <td className="nowrap" title={new Date(n.dateCreation).toLocaleString("fr-FR")}>
                        {dateRelative(n.dateCreation)}
                      </td>
                    </tr>
                  );
                })}
                {filtrees.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide">
                      {notifications.length === 0 ? "Aucune notification : tout va bien 👍" : "Aucune notification pour ces filtres."}
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, filtrees.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
  const [categorieOuverte, setCategorieOuverte] = useState<string | null>(null);
  const [notificationOuverte, setNotificationOuverte] = useState<NotificationResume | null>(null);

  // Un caissier verrouillé sur un dépôt (Réglages) ne doit voir que les
  // notifications de celui-ci. Patron/Gérant (pas de dépôt assigné) voient tout.
  const depotIdEffectif = session.depotId ?? undefined;

  // Le système détecte lui-même les ruptures à chaque ouverture de la page. La
  // liste est lue AVANT de tout marquer comme lu : le badge « Nouveau » montre
  // ce qui n'avait pas encore été vu, puis la cloche s'éteint.
  useEffect(() => {
    (async () => {
      await api.notifications.genererAlertesRupture(session.boutiqueId);
      setNotificationsListe(await api.notifications.lister(session.boutiqueId, { depotId: depotIdEffectif }));
      await api.notifications.marquerLues(session.boutiqueId, depotIdEffectif);
      onLues?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, depotIdEffectif]);

  const deLaCategorie = (cle: string) => {
    const categorie = CATEGORIES.find((c) => c.cle === cle);
    return notificationsListe.filter((n) => !categorie?.types || categorie.types.includes(n.type));
  };
  const categorie = CATEGORIES.find((c) => c.cle === categorieOuverte);

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
      <div className="grille-documents-comptables">
        {CATEGORIES.map((c) => {
          const liste = deLaCategorie(c.cle);
          const nouvelles = liste.filter((n) => !n.lu).length;
          return (
            <button key={c.cle} type="button" className="carte-document-comptable" onClick={() => setCategorieOuverte(c.cle)}>
              <span className="icone-document-comptable">{c.icone}</span>
              {c.label}
              <span className={`compteur-carte${nouvelles > 0 ? " compteur-carte--nouveau" : ""}`} title={`${nouvelles} nouvelle(s)`}>
                {liste.length}
              </span>
            </button>
          );
        })}
      </div>
      {categorie && (
        <ModaleListeNotifications
          titre={categorie.cle === "toutes" ? "Notifications" : categorie.label}
          notifications={deLaCategorie(categorie.cle)}
          onOuvrir={setNotificationOuverte}
          onFermer={() => setCategorieOuverte(null)}
        />
      )}
      {notificationOuverte && (
        <DetailNotification
          notification={notificationOuverte}
          onFermer={() => setNotificationOuverte(null)}
          onNaviguer={onNaviguer} onCommander={onCommander}
        />
      )}
    </div>
  );
}
