import { useState } from "react";

import { api } from "../api";
import CodeActivation from "../composants/CodeActivation";
import { BadgeAbonnement, Chargement, Erreur, Info, Modale } from "../composants/Commun";
import { date, dateHeure, depuis, montant } from "../format";
import type { FicheBoutique as Fiche, ResumeBoutique } from "../types";
import { useChargement } from "../useChargement";

interface Props {
  id: string;
  surFermer: () => void;
  surModifiee: (b: ResumeBoutique) => void;
}

export default function FicheBoutique({ id, surFermer, surModifiee }: Props) {
  const { donnees: fiche, setDonnees, erreur, enCours, recharger } = useChargement(
    () => api<Fiche>(`/admin/boutiques/${id}/`),
    [id],
  );
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreurAction, setErreurAction] = useState("");

  async function modifier(champs: Partial<Pick<Fiche, "synchro_autorisee">>, confirmation: string) {
    if (!window.confirm(confirmation)) return;
    setEnregistrement(true);
    setErreurAction("");
    try {
      const nouvelle = await api<Fiche>(`/admin/boutiques/${id}/`, { method: "PATCH", body: JSON.stringify(champs) });
      setDonnees(nouvelle);
      surModifiee(nouvelle);
    } catch (e) {
      setErreurAction((e as Error).message);
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <Modale titre={fiche?.nom ?? "Boutique"} surFermer={surFermer}>
      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {enCours && !fiche && <Chargement />}
      {fiche && (
        <div className="pile">
          <p className="note-confidentialite">
            🔒 Informations de compte seulement : les ventes, le stock et les clients de la boutique restent privés.
          </p>

          <div className="deux-colonnes">
            <section className="carte">
              <h3>Boutique</h3>
              <dl className="infos">
                <Info libelle="Téléphone">{fiche.telephone}</Info>
                <Info libelle="E-mail">{fiche.email}</Info>
                <Info libelle="Adresse">{fiche.adresse}</Info>
                <Info libelle="Devise">{fiche.devise}</Info>
                <Info libelle="Créée le">{date(fiche.date_creation)}</Info>
              </dl>
            </section>
            <section className="carte">
              <h3>Patron</h3>
              {fiche.patron ? (
                <dl className="infos">
                  <Info libelle="Nom">{fiche.patron.nom}</Info>
                  <Info libelle="Identifiant">{fiche.patron.username}</Info>
                  <Info libelle="Téléphone">{fiche.patron.telephone}</Info>
                  <Info libelle="E-mail">{fiche.patron.email}</Info>
                </dl>
              ) : (
                <p className="vide">Aucun compte Patron.</p>
              )}
            </section>
          </div>

          <section className="carte">
            <h3>Abonnement et accès</h3>
            <dl className="infos infos-ligne">
              <Info libelle="Formule">{fiche.formule_libelle}</Info>
              <Info libelle="Fin">{date(fiche.date_expiration_abonnement)}</Info>
              <Info libelle="État">
                <BadgeAbonnement etat={fiche.abonnement} actif={fiche.actif} />
              </Info>
              <Info libelle="Réseau de la boutique">
                {fiche.reseau_autorise ? "Activé" : "Non activé"}
                {fiche.demandes_reseau_en_attente > 0 && " · demande en attente"}
              </Info>
              <Info libelle="Dernière sauvegarde">{depuis(fiche.date_derniere_sauvegarde)}</Info>
            </dl>
            {erreurAction && <Erreur message={erreurAction} />}
            <div className="actions">
              <label className="interrupteur">
                <input
                  type="checkbox"
                  checked={fiche.synchro_autorisee}
                  disabled={enregistrement}
                  onChange={(e) =>
                    modifier(
                      { synchro_autorisee: e.target.checked },
                      e.target.checked
                        ? `Activer la synchronisation en ligne pour « ${fiche.nom} » ? Ses données seront envoyées au serveur.`
                        : `Désactiver la synchronisation en ligne pour « ${fiche.nom} » ? L'appli continue de fonctionner sur ses postes.`,
                    )
                  }
                />
                Synchronisation en ligne
              </label>
            </div>
          </section>

          <section className="carte">
            <h3>Utilisateurs ({fiche.utilisateurs.length})</h3>
            <table className="tableau">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Identifiant</th>
                  <th>Rôle</th>
                  <th>Téléphone</th>
                  <th>Dernière connexion en ligne</th>
                </tr>
              </thead>
              <tbody>
                {fiche.utilisateurs.map((u) => (
                  <tr key={u.username} className={u.actif ? "" : "ligne-inactive"}>
                    <td>{u.nom || "—"}</td>
                    <td>{u.username}</td>
                    <td>{u.role || "—"}</td>
                    <td>{u.telephone || "—"}</td>
                    <td>{u.actif ? dateHeure(u.derniere_connexion) : "Compte désactivé"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="carte">
            <h3>Postes synchronisés ({fiche.postes.length})</h3>
            {fiche.postes.length === 0 ? (
              <p className="vide">
                {fiche.synchro_autorisee ? "Aucun poste n'a encore synchronisé." : "Synchronisation en ligne désactivée."}
              </p>
            ) : (
              <ul className="liste-simple">
                {fiche.postes.map((p) => (
                  <li key={p.appareil}>
                    <strong>{p.appareil}</strong> — dernière synchro {dateHeure(p.derniere_synchro)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Le registre n'est renvoyé qu'aux admins qui ont le droit « paiements ». */}
          {fiche.registre_abonnement && fiche.date_expiration_abonnement && (
            <section className="carte">
              <h3>Code d'activation hors ligne</h3>
              <CodeActivation boutiqueId={fiche.id} nom={fiche.nom} />
            </section>
          )}

          {fiche.registre_abonnement && (
            <section className="carte">
              <h3>Registre de l'abonnement</h3>
              {fiche.registre_abonnement.length === 0 ? (
                <p className="vide">Aucune ligne.</p>
              ) : (
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Nature</th>
                      <th>Formule</th>
                      <th>Période</th>
                      <th className="nombre">Montant</th>
                      <th>Paiement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fiche.registre_abonnement.map((p, i) => (
                      <tr key={i}>
                        <td>{date(p.date)}</td>
                        <td>{p.nature_libelle}</td>
                        <td>{p.formule_libelle}</td>
                        <td>
                          {date(p.date_debut)} → {p.date_fin ? date(p.date_fin) : "sans limite"}
                        </td>
                        <td className="nombre">{Number(p.montant) ? montant(p.montant) : "—"}</td>
                        <td>{[p.mode_libelle, p.reference].filter(Boolean).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>
      )}
    </Modale>
  );
}
