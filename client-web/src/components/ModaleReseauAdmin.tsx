import { useEffect, useState } from "react";

import {
  etatReseauAdmin,
  lireAbonnementEnAttente,
  obtenirBoutiqueInstallee,
  soumettreAbonnement,
  type AbonnementBoutique,
  type AbonnementEnAttente,
  type EtatReseauAdmin,
} from "../services/abonnementAdmin";
import ModaleConfirmation from "./ModaleConfirmation";

// Port navigateur de client-electron/src/components/ModaleReseauAdmin.tsx (sans
// la partie « cet ordinateur » : le navigateur ne fait pas partie du réseau).
// Espace Admin → Réseau de la boutique : son propre espace pour activer ou
// désactiver le réseau (ordinateurs reliés sans internet), traiter les demandes
// de la boutique et voir où en est cet ordinateur. L'activation passe par
// AppliquerAbonnementView (reseau_autorise) : sans internet, elle s'applique sur
// ce poste et part au serveur au retour de la connexion.

function dateCourte(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

export default function ModaleReseauAdmin({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [boutique, setBoutique] = useState<AbonnementBoutique | null | undefined>(undefined);
  const [serveur, setServeur] = useState<EtatReseauAdmin | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [enAttente, setEnAttente] = useState<AbonnementEnAttente | null>(null);
  const [confirmerDesactivation, setConfirmerDesactivation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function charger(action?: "refuser") {
    const b = await obtenirBoutiqueInstallee();
    setBoutique(b);
    setEnAttente(lireAbonnementEnAttente());
    if (!b) return;
    try {
      setServeur(await etatReseauAdmin(username, password, b.boutiqueId, action));
      setHorsLigne(false);
    } catch {
      setServeur(null);
      setHorsLigne(true);
    }
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changer(activer: boolean) {
    if (!boutique) return;
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    let statut: "synchronise" | "horsLigne";
    try {
      statut = (await soumettreAbonnement(username, password, boutique.boutiqueId, boutique.boutiqueNom, { reseauAutorise: activer }))
        .statut;
    } catch (e) {
      setEnCours(false);
      setConfirmerDesactivation(false);
      return setErreur(e instanceof Error ? e.message : "Échec de la modification.");
    }
    setEnCours(false);
    setConfirmerDesactivation(false);
    setMessage(
      statut === "synchronise"
        ? activer
          ? "✅ Réseau activé (sur ce poste et sur le serveur)."
          : "Réseau désactivé (sur ce poste et sur le serveur)."
        : `${activer ? "✅ Réseau activé" : "Réseau désactivé"} sur ce poste. Pas de connexion : le serveur sera prévenu au retour d'internet (à la prochaine ouverture en ligne de l'Espace Admin).`,
    );
    await charger();
  }

  async function refuser() {
    setErreur(null);
    setEnCours(true);
    await charger("refuser");
    setEnCours(false);
    setMessage("Demande refusée.");
  }

  // Le serveur fait foi s'il répond ; sinon, le réglage du poste.
  const active = serveur ? serveur.reseau_autorise : !!boutique?.reseauAutorise;
  const demande = serveur?.demandes.find((d) => d.statut === "en_attente") ?? null;
  const ecartPoste = serveur && boutique && serveur.reseau_autorise !== boutique.reseauAutorise;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-reseau-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>📶 Réseau de la boutique{boutique ? ` — ${boutique.boutiqueNom}` : ""}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps contenu-reseau">
          {boutique === null && (
            <div className="message-erreur">Aucune boutique sur cet ordinateur : connectez-vous d'abord une fois.</div>
          )}
          {erreur && <div className="message-erreur">{erreur}</div>}
          {message && <div className="message-succes">{message}</div>}

          {boutique && (
            <>
              <div className={`carte-etat-serveur carte-etat-serveur--${active ? "marche" : "neutre"}`}>
                <div className="entete-vue-ensemble">
                  <span className="icone-vue-ensemble">{active ? "✅" : "🔒"}</span>
                  <div>
                    <strong className="etat-serveur-titre">{active ? "Réseau activé" : "Réseau non activé"}</strong>
                    <span className="sous-info ligne-detail-article">
                      {active
                        ? "Les ordinateurs de la boutique peuvent se relier sans internet (un poste principal, des caisses)."
                        : "La boutique ne peut pas relier ses ordinateurs : chacun travaille seul."}
                    </span>
                  </div>
                </div>
                {active ? (
                  <button type="button" className="bouton-danger" disabled={enCours} onClick={() => setConfirmerDesactivation(true)}>
                    Désactiver le réseau
                  </button>
                ) : (
                  <button type="button" className="bouton-primaire" disabled={enCours} onClick={() => changer(true)}>
                    {enCours ? "Activation…" : "✅ Activer le réseau"}
                  </button>
                )}
              </div>

              {demande && !active && (
                <div className="prochaine-etape prochaine-etape--attention">
                  <div>
                    <span className="libelle-prochaine-etape">📨 Demande de la boutique</span>
                    <p>
                      Le {dateCourte(demande.date)}
                      {demande.demandeur ? ` par ${demande.demandeur}` : ""}
                      {demande.note ? ` : « ${demande.note} »` : ""}.
                    </p>
                  </div>
                  <div className="actions-code-reseau">
                    <button type="button" className="bouton-primaire" disabled={enCours} onClick={() => changer(true)}>
                      Accepter et activer
                    </button>
                    <button type="button" disabled={enCours} onClick={refuser}>
                      Refuser
                    </button>
                  </div>
                </div>
              )}
              {horsLigne && (
                <div className="prochaine-etape prochaine-etape--neutre">
                  <div>
                    <span className="libelle-prochaine-etape">Sans connexion au serveur</span>
                    <p>
                      Les demandes de la boutique ne peuvent pas être lues. Vous pouvez quand même activer ou désactiver le
                      réseau : c'est appliqué sur ce poste tout de suite, et transmis au serveur au retour d'internet.
                    </p>
                  </div>
                  <button type="button" disabled={enCours} onClick={() => charger()}>
                    ⟳ Réessayer
                  </button>
                </div>
              )}
              {ecartPoste && (
                <div className="prochaine-etape prochaine-etape--attention">
                  <div>
                    <span className="libelle-prochaine-etape">Pas encore à jour sur ce poste</span>
                    <p>
                      Le serveur dit « {serveur!.reseau_autorise ? "activé" : "non activé"} », ce poste n'a pas encore reçu le
                      changement : il arrive à la prochaine vérification (dans la boutique : Réseau de la boutique → «
                      Vérifier l'activation »).
                    </p>
                  </div>
                </div>
              )}

              <div className="grille-cartes-reseau">
                <div className="carte-info-reseau">
                  <span className="titre-carte-reseau">🌐 Envoi en ligne</span>
                  <strong>{boutique.synchroAutorisee ? "Autorisé" : "🔒 100 % local"}</strong>
                  <span className="sous-info">réglé dans « Gérer abonnement »</span>
                </div>
                <div className="carte-info-reseau">
                  <span className="titre-carte-reseau">🛰️ Serveur</span>
                  <strong>{horsLigne ? "Injoignable" : serveur ? "Joint" : "…"}</strong>
                  <span className="sous-info">
                    {enAttente?.champs.reseauAutorise !== undefined
                      ? "un changement attend d'être envoyé"
                      : "aucun changement en attente"}
                  </span>
                </div>
              </div>

              <section className="bloc-reseau">
                <h4>Historique des demandes</h4>
                {serveur && serveur.demandes.length > 0 ? (
                  <div className="zone-tableau-scroll">
                    <table className="tableau-catalogue carte-mobile tableau-appareils-reseau">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Demandé par</th>
                          <th>Note</th>
                          <th>Statut</th>
                          <th>Traitée le</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serveur.demandes.map((d) => (
                          <tr key={d.date}>
                            <td data-label="Date" className="nowrap">{dateCourte(d.date)}</td>
                            <td data-label="Demandé par">{d.demandeur || "—"}</td>
                            <td data-label="Note">{d.note || "—"}</td>
                            <td data-label="Statut">
                              <span className={`pastille-etat-reseau${d.statut === "acceptee" ? " pastille-etat-reseau--relie" : ""}`}>
                                {d.statut_libelle}
                              </span>
                            </td>
                            <td data-label="Traitée le" className="nowrap">{dateCourte(d.date_traitement)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="note-aide">{horsLigne ? "Indisponible sans connexion au serveur." : "Aucune demande pour l'instant."}</p>
                )}
              </section>

              <section className="bloc-reseau">
                <h4>À savoir</h4>
                <ul className="verifications-reseau">
                  <li className="verif-info">
                    Activé : dans la boutique, Informations boutique → Réseau de la boutique permet de faire d'un ordinateur le
                    poste principal et d'y brancher les caisses (15 postes au plus).
                  </li>
                  <li className="verif-info">
                    Désactivé : le poste principal arrête son serveur dans la minute qui suit ; les caisses continuent de
                    vendre seules, sans rien perdre. Réactivé, il redémarre de lui-même.
                  </li>
                  <li className="verif-info">Le même réglage existe dans l'admin Django (colonne « Reseau autorise »).</li>
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
      {confirmerDesactivation && (
        <ModaleConfirmation
          titre="Désactiver le réseau de la boutique ?"
          description="Le poste principal arrêtera son serveur dans la minute : les caisses continueront de vendre seules, sans voir les ventes des autres postes. Rien n'est perdu ; réactivé, tout reprend."
          labelConfirmer="Désactiver"
          dangereux
          enCours={enCours}
          onAnnuler={() => setConfirmerDesactivation(false)}
          onConfirmer={() => changer(false)}
        />
      )}
    </div>
  );
}
