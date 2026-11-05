import { api } from "../api";
import { BadgeAbonnement, Chargement, Erreur } from "../composants/Commun";
import { date } from "../format";
import type { TableauDeBord as Donnees } from "../types";
import { useChargement } from "../useChargement";

const A_TRAITER = [
  { cle: "inscriptions", libelle: "Inscriptions à valider", icone: "📝", lien: "#/inscriptions" },
  { cle: "paiements", libelle: "Paiements à vérifier", icone: "💳", lien: "#/paiements" },
  { cle: "demandes_reseau", libelle: "Demandes de réseau", icone: "🖧", lien: "#/demandes-reseau" },
  { cle: "signalements", libelle: "Signalements", icone: "⚠️", lien: "#/signalements" },
] as const;

const ABONNEMENTS = [
  { cle: "ok", libelle: "À jour", classe: "chiffre-vert" },
  { cle: "bientot", libelle: "Finissent dans 7 jours", classe: "chiffre-orange" },
  { cle: "grace", libelle: "En délai de grâce", classe: "chiffre-rouge" },
  { cle: "bloque", libelle: "Ventes bloquées", classe: "chiffre-rouge" },
  { cle: "illimite", libelle: "Sans limite", classe: "" },
] as const;

export default function TableauDeBord() {
  const { donnees, erreur, enCours, recharger } = useChargement(() => api<Donnees>("/admin/tableau-de-bord/"));

  if (erreur) return <Erreur message={erreur} reessayer={recharger} />;
  if (enCours || !donnees) return <Chargement />;
  const { boutiques, abonnements, a_traiter, a_surveiller } = donnees;
  const taches = A_TRAITER.filter((t) => a_traiter[t.cle] !== undefined);

  return (
    <div className="pile">
      {taches.length > 0 && (
        <section>
          <h2 className="titre-section">À traiter</h2>
          <div className="grille-tuiles">
            {taches.map((t) => {
              const n = a_traiter[t.cle] ?? 0;
              return (
                <a key={t.cle} href={t.lien} className={`tuile${n > 0 ? " tuile-alerte" : ""}`}>
                  <span className="tuile-icone" aria-hidden>
                    {t.icone}
                  </span>
                  <strong className="tuile-chiffre">{n}</strong>
                  <span>{t.libelle}</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="titre-section">Boutiques</h2>
        <div className="grille-tuiles">
          <div className="tuile">
            <strong className="tuile-chiffre">{boutiques.actives}</strong>
            <span>actives sur {boutiques.total}</span>
          </div>
          <div className="tuile">
            <strong className="tuile-chiffre">{boutiques.nouvelles_ce_mois}</strong>
            <span>nouvelles ce mois-ci</span>
          </div>
          <div className="tuile">
            <strong className="tuile-chiffre">{boutiques.synchro_activee}</strong>
            <span>avec la synchronisation en ligne</span>
          </div>
          <div className={`tuile${boutiques.sans_sauvegarde_recente > 0 ? " tuile-alerte" : ""}`}>
            <strong className="tuile-chiffre">{boutiques.sans_sauvegarde_recente}</strong>
            <span>sans sauvegarde depuis 7 jours</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="titre-section">Abonnements des boutiques actives</h2>
        <div className="grille-tuiles">
          {ABONNEMENTS.map((a) => (
            <div key={a.cle} className="tuile">
              <strong className={`tuile-chiffre ${a.classe}`}>{abonnements[a.cle]}</strong>
              <span>{a.libelle}</span>
            </div>
          ))}
        </div>
      </section>

      {a_surveiller.length > 0 && (
        <section className="carte">
          <h2 className="titre-section">Abonnements à relancer</h2>
          <table className="tableau">
            <thead>
              <tr>
                <th>Boutique</th>
                <th>Patron</th>
                <th>Téléphone</th>
                <th>Fin</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {a_surveiller.map((b) => (
                <tr key={b.id} className="ligne-cliquable" onClick={() => (window.location.hash = `#/boutiques/${b.id}`)}>
                  <td>
                    <strong>{b.nom}</strong>
                  </td>
                  <td>{b.patron?.nom || b.patron?.username || "—"}</td>
                  <td>{b.patron?.telephone || b.telephone || "—"}</td>
                  <td>{date(b.date_expiration_abonnement)}</td>
                  <td>
                    <BadgeAbonnement etat={b.abonnement} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
