import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { AbonnementBoutique, AbonnementEnAttente, ChampsAbonnement, EtatReseau, EtatReseauAdmin } from "../api/client";

/**
 * Espace Admin → « 📶 Réseau de la boutique » : activer ou désactiver le réseau
 * (appareils reliés sans internet), traiter les demandes de la boutique et voir où
 * en est cet appareil (poste principal et ses caisses, ou caisse branchée).
 * L'activation passe par AppliquerAbonnementView (reseau_autorise) : sans internet,
 * elle s'applique sur ce poste et part au serveur au retour de la connexion.
 * Copie conforme : client-web/src/components/ModaleReseauAdmin.tsx (seul `appels` diffère).
 */

/** Accès aux données (seule partie qui diffère entre le bureau et le web). */
const appels = {
  boutique: (): Promise<AbonnementBoutique | null> => api.admin.boutiqueLocale(),
  etatAppareil: (): Promise<EtatReseau | null> => api.reseau.etat(),
  enAttente: (): Promise<AbonnementEnAttente | null> => api.admin.abonnementEnAttente(),
  etatServeur: async (username: string, password: string, boutiqueId: string, action?: "refuser"): Promise<EtatReseauAdmin | null> => {
    const r = await api.admin.etatReseau(username, password, boutiqueId, action);
    return r.succes ? r.resultat : null;
  },
  soumettre: async (
    username: string,
    password: string,
    boutiqueId: string,
    boutiqueNom: string,
    champs: ChampsAbonnement,
  ): Promise<"synchronise" | "horsLigne"> => {
    const r = await api.admin.soumettreAbonnement(username, password, boutiqueId, boutiqueNom, champs);
    if (!r.succes) throw new Error(r.message);
    return r.resultat.statut;
  },
  motAppareil: "ordinateur",
  cetAppareil: "cet ordinateur",
  cetAppareilMaj: "Cet ordinateur",
};

type Rubrique = "apercu" | "demandes" | "appareil" | "aide";

function dateCourte(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

function dateHeure(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";
}

/** « il y a 3 min » pour une activité récente, sinon la date. */
function depuis(iso: string | null | undefined): string {
  if (!iso) return "jamais";
  const secondes = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secondes < 60) return "à l'instant";
  if (secondes < 3600) return `il y a ${Math.round(secondes / 60)} min`;
  if (secondes < 86_400) return `il y a ${Math.round(secondes / 3600)} h`;
  return dateHeure(iso);
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
  const [reseau, setReseau] = useState<EtatReseau | null>(null);
  const [enAttente, setEnAttente] = useState<AbonnementEnAttente | null>(null);
  const [rubrique, setRubrique] = useState<Rubrique>("apercu");
  const [aConfirmer, setAConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function charger(action?: "refuser") {
    const b = await appels.boutique();
    setBoutique(b);
    setReseau(await appels.etatAppareil().catch(() => null));
    setEnAttente(await appels.enAttente());
    if (!b) return;
    const r = await appels.etatServeur(username, password, b.boutiqueId, action).catch(() => null);
    setServeur(r);
    setHorsLigne(!r);
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aller(r: Rubrique) {
    setErreur(null);
    setMessage(null);
    setAConfirmer(false);
    setRubrique(r);
  }

  async function changer(activer: boolean) {
    if (!boutique) return;
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      const statut = await appels.soumettre(username, password, boutique.boutiqueId, boutique.boutiqueNom, {
        reseauAutorise: activer,
      });
      setMessage(
        statut === "synchronise"
          ? `${activer ? "✅ Réseau activé" : "Réseau désactivé"} (sur ce poste et sur le serveur).`
          : `${activer ? "✅ Réseau activé" : "Réseau désactivé"} sur ce poste. Pas de connexion : le serveur sera prévenu au retour d'internet (Réglages → Synchronisation).`,
      );
      setAConfirmer(false);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Échec de la modification.");
    } finally {
      setEnCours(false);
    }
  }

  async function refuser() {
    setErreur(null);
    setEnCours(true);
    await charger("refuser");
    setEnCours(false);
    setMessage("Demande refusée.");
  }

  async function actualiserAppareil() {
    setReseau(await appels.etatAppareil().catch(() => null));
  }

  // Le serveur fait foi s'il répond ; sinon, le réglage du poste.
  const active = serveur ? serveur.reseau_autorise : !!boutique?.reseauAutorise;
  const demande = serveur?.demandes.find((d) => d.statut === "en_attente") ?? null;
  const ecartPoste = !!(serveur && boutique && serveur.reseau_autorise !== boutique.reseauAutorise);
  const changementEnAttente = enAttente?.champs.reseauAutorise !== undefined;

  const roleCourt = !reseau
    ? "—"
    : reseau.role === "principal"
      ? `🖥️ poste principal`
      : reseau.role === "caisse"
        ? "📶 caisse branchée"
        : `💻 ${appels.motAppareil} seul`;

  const accord = horsLigne
    ? { ton: "neutre", titre: "Sans connexion au serveur", texte: "Les demandes ne peuvent pas être lues. Activer ou désactiver reste possible : appliqué sur ce poste tout de suite, transmis au serveur au retour d'internet." }
    : changementEnAttente
      ? { ton: "attention", titre: "Changement en attente", texte: "Un changement fait sans internet attend d'être envoyé au serveur (Réglages → Synchronisation)." }
      : ecartPoste
        ? {
            ton: "attention",
            titre: "Pas encore à jour sur ce poste",
            texte: `Le serveur dit « ${serveur!.reseau_autorise ? "activé" : "non activé"} » : le poste le recevra à la prochaine vérification (Réseau de la boutique → « Vérifier l'activation »).`,
          }
        : { ton: "ok", titre: "Serveur et poste", texte: "✅ Le serveur et ce poste sont d'accord." };

  const blocDemande = demande && !active && (
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
  );

  function carteInterrupteur() {
    return (
      <div className={`carte-option-admin${active ? " carte-option-admin--active" : ""}`}>
        <div className="entete-option-admin">
          <span className="icone-option-admin">📶</span>
          <div className="textes-option-admin">
            <strong>Réseau de la boutique</strong>
            <span className={`badge-lp ${active ? "badge-lp--actif" : ""}`}>{active ? "✅ Activé" : "🔒 Non activé"}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label="Réseau de la boutique"
            className={`interrupteur-option${active ? " interrupteur-option--actif" : ""}`}
            disabled={enCours}
            onClick={() => setAConfirmer(!aConfirmer)}
          >
            <span className="curseur-interrupteur-option" />
          </button>
        </div>
        <p className="note-aide">
          {active
            ? "Les ordinateurs et téléphones de la boutique peuvent se relier sans internet : un poste principal, des caisses."
            : "La boutique ne peut pas relier ses appareils : chacun travaille seul."}
        </p>
        {aConfirmer && (
          <div className="confirmation-option-admin">
            <p>
              {active
                ? "Désactiver le réseau ? Le poste principal arrête son serveur dans la minute : les caisses continuent de vendre seules, sans voir les ventes des autres postes. Rien n'est perdu ; réactivé, tout reprend."
                : `Activer le réseau de « ${boutique?.boutiqueNom} » ? Elle pourra faire d'un appareil le poste principal et y brancher ses caisses.`}
            </p>
            <div className="actions-formulaire">
              <button
                type="button"
                className={active ? "bouton-danger" : "bouton-primaire"}
                disabled={enCours}
                onClick={() => changer(!active)}
              >
                {enCours ? "Enregistrement…" : active ? "Désactiver" : "Activer"}
              </button>
              <button type="button" className="lien" onClick={() => setAConfirmer(false)}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function rubriqueAppareil() {
    if (!reseau) {
      return <p className="note-aide">État du réseau de {appels.cetAppareil} indisponible.</p>;
    }
    if (reseau.role === "principal") {
      const relies = reseau.appareils.filter((a) => a.relie).length;
      return (
        <>
          <div className={`carte-etat-serveur carte-etat-serveur--${reseau.enMarche && !reseau.enPause ? "marche" : "arrete"}`}>
            <div className="entete-vue-ensemble">
              <span className="icone-vue-ensemble">🖥️</span>
              <div>
                <strong className="etat-serveur-titre">Poste principal « {reseau.nomPoste} »</strong>
                <span className="sous-info ligne-detail-article">
                  Serveur {reseau.enPause ? "en pause" : reseau.enMarche ? "en marche" : "arrêté"}
                  {reseau.demarreLe ? ` depuis ${depuis(reseau.demarreLe)}` : ""} · {relies}/{reseau.appareils.length} caisse(s)
                  reliée(s) · {reseau.postesMax} postes au plus
                </span>
              </div>
            </div>
          </div>
          {reseau.erreur && <div className="message-erreur">{reseau.erreur}</div>}
          <dl className="infos-option-admin">
            <dt>Adresse(s) sur le réseau</dt>
            <dd>{reseau.adresses.length ? reseau.adresses.map((a) => `${a}${reseau.port ? `:${reseau.port}` : ""}`).join(" · ") : "—"}</dd>
            <dt>Code de branchement</dt>
            <dd>{reseau.code ? `${reseau.code.valeur} (jusqu'à ${dateHeure(reseau.code.expire)})` : "aucun en cours"}</dd>
            <dt>Recherche automatique</dt>
            <dd>{reseau.annonceActive ? "les caisses le trouvent avec « Rechercher »" : "désactivée"}</dd>
            <dt>Requêtes reçues</dt>
            <dd>{reseau.requetesRecues}</dd>
            <dt>Envoi en ligne</dt>
            <dd>
              {reseau.internet
                ? `dernier envoi ${depuis(reseau.internet.derniereSynchro)} · ${reseau.internet.enAttente} en attente`
                : "—"}
            </dd>
          </dl>
          <h4>Caisses branchées</h4>
          {reseau.appareils.length === 0 ? (
            <p className="note-aide">Aucune caisse branchée pour l'instant.</p>
          ) : (
            <div className="zone-tableau-scroll zone-appareils-reseau">
              <table className="tableau-catalogue carte-mobile tableau-appareils-reseau">
                <thead>
                  <tr>
                    <th>Caisse</th>
                    <th>État</th>
                    <th>Dernière activité</th>
                    <th>Branchée le</th>
                  </tr>
                </thead>
                <tbody>
                  {reseau.appareils.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Caisse">{a.nom}</td>
                      <td data-label="État">
                        <span className={`pastille-etat-reseau${a.relie ? " pastille-etat-reseau--relie" : ""}`}>
                          {a.relie ? "🟢 reliée" : "⚪ hors ligne"}
                        </span>
                      </td>
                      <td data-label="Dernière activité" className="nowrap">
                        {depuis(a.derniereConnexion)}
                      </td>
                      <td data-label="Branchée le" className="nowrap">
                        {dateCourte(a.dateBranchement)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      );
    }
    if (reseau.role === "caisse" && reseau.caisse) {
      const c = reseau.caisse;
      return (
        <>
          <div className={`carte-etat-serveur carte-etat-serveur--${c.relie ? "marche" : "arrete"}`}>
            <div className="entete-vue-ensemble">
              <span className="icone-vue-ensemble">📶</span>
              <div>
                <strong className="etat-serveur-titre">Caisse branchée sur « {c.nomPostePrincipal} »</strong>
                <span className="sous-info ligne-detail-article">{c.relie ? "🟢 reliée au poste principal" : "⚪ poste principal injoignable"}</span>
              </div>
            </div>
          </div>
          {c.erreur && <div className="message-erreur">{c.erreur}</div>}
          <dl className="infos-option-admin">
            <dt>Adresse du poste principal</dt>
            <dd>{c.adresse}</dd>
            <dt>Dernier échange</dt>
            <dd>{depuis(c.derniereSynchro)}</dd>
            <dt>Pas encore envoyé au poste principal</dt>
            <dd>{c.enAttente} ligne(s)</dd>
            <dt>Envoi en ligne du poste principal</dt>
            <dd>
              {c.internetPrincipal
                ? `dernier envoi ${depuis(c.internetPrincipal.derniereSynchro)} · ${c.internetPrincipal.enAttente} en attente`
                : "—"}
            </dd>
          </dl>
        </>
      );
    }
    return (
      <div className="carte-etat-serveur carte-etat-serveur--neutre">
        <div className="entete-vue-ensemble">
          <span className="icone-vue-ensemble">💻</span>
          <div>
            <strong className="etat-serveur-titre">{appels.cetAppareilMaj} travaille seul</strong>
            <span className="sous-info ligne-detail-article">
              {active
                ? "Pour en faire le poste principal ou le brancher comme caisse : Réglages → Informations boutique → Réseau de la boutique."
                : "Activez d'abord le réseau de la boutique."}
            </span>
          </div>
        </div>
      </div>
    );
  }

  function contenu() {
    if (!boutique) return null;
    switch (rubrique) {
      case "demandes":
        return (
          <>
            <h4 className="titre-rubrique-reseau">📨 Demandes de la boutique</h4>
            {blocDemande}
            {serveur && serveur.demandes.length > 0 ? (
              <div className="zone-tableau-scroll zone-appareils-reseau">
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
                        <td data-label="Date" className="nowrap">
                          {dateCourte(d.date)}
                        </td>
                        <td data-label="Demandé par">{d.demandeur || "—"}</td>
                        <td data-label="Note">{d.note || "—"}</td>
                        <td data-label="Statut">
                          <span className={`pastille-etat-reseau${d.statut === "acceptee" ? " pastille-etat-reseau--relie" : ""}`}>
                            {d.statut_libelle}
                          </span>
                        </td>
                        <td data-label="Traitée le" className="nowrap">
                          {dateCourte(d.date_traitement)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="note-aide">{horsLigne ? "Indisponible sans connexion au serveur." : "Aucune demande pour l'instant."}</p>
            )}
          </>
        );
      case "appareil":
        return (
          <>
            <div className="entete-rubrique-appareil">
              <h4 className="titre-rubrique-reseau">💻 {appels.cetAppareilMaj}</h4>
              <button type="button" className="lien" onClick={actualiserAppareil}>
                ⟳ Actualiser
              </button>
            </div>
            {rubriqueAppareil()}
          </>
        );
      case "aide":
        return (
          <>
            <h4 className="titre-rubrique-reseau">❓ À savoir</h4>
            <ul className="verifications-reseau">
              <li className="verif-info">
                Activé : dans la boutique, Réglages → Informations boutique → Réseau de la boutique permet de faire d'un appareil
                le poste principal et d'y brancher les caisses (15 postes au plus).
              </li>
              <li className="verif-info">
                Désactivé : le poste principal arrête son serveur dans la minute qui suit ; les caisses continuent de vendre
                seules, sans rien perdre. Réactivé, il redémarre de lui-même.
              </li>
              <li className="verif-info">La boutique peut demander l'activation depuis l'appli : la demande arrive dans « 📨 Demandes ».</li>
              <li className="verif-info">Le même réglage existe sur le site d'administration et dans l'admin Django.</li>
            </ul>
          </>
        );
      default:
        return (
          <>
            <h4 className="titre-rubrique-reseau">🧭 Vue d'ensemble</h4>
            <div className={`prochaine-etape prochaine-etape--${accord.ton}`}>
              <div>
                <span className="libelle-prochaine-etape">{accord.titre}</span>
                <p>{accord.texte}</p>
              </div>
              {horsLigne && (
                <button type="button" disabled={enCours} onClick={() => charger()}>
                  ⟳ Réessayer
                </button>
              )}
            </div>
            {blocDemande}
            {carteInterrupteur()}
            <div className="grille-cartes-reseau">
              <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller("appareil")}>
                <span className="titre-carte-reseau">💻 {appels.cetAppareilMaj}</span>
                <strong>{roleCourt}</strong>
                {reseau?.role === "principal" && (
                  <span className="sous-info">
                    {reseau.appareils.filter((a) => a.relie).length}/{reseau.appareils.length} caisse(s) reliée(s) · serveur{" "}
                    {reseau.enPause ? "en pause" : reseau.enMarche ? "en marche" : "arrêté"}
                  </span>
                )}
                {reseau?.role === "caisse" && reseau.caisse && (
                  <span className="sous-info">{reseau.caisse.relie ? "🟢 reliée" : "⚪ poste principal injoignable"}</span>
                )}
              </button>
              <div className="carte-info-reseau">
                <span className="titre-carte-reseau">🌐 Envoi en ligne</span>
                <strong>{boutique.synchroAutorisee ? "Autorisé" : "🔒 100 % local"}</strong>
                <span className="sous-info">réglé dans « ⚙️ Options de la boutique »</span>
              </div>
              <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller("demandes")}>
                <span className="titre-carte-reseau">📨 Demandes</span>
                <strong>{horsLigne ? "—" : demande ? "1 en attente" : "aucune en attente"}</strong>
                <span className="sous-info">{serveur ? `${serveur.demandes.length} au total` : "serveur injoignable"}</span>
              </button>
            </div>
          </>
        );
    }
  }

  const rubriques: { cle: Rubrique; label: string; compteur?: string }[] = [
    { cle: "apercu", label: "🧭 Vue d'ensemble" },
    { cle: "demandes", label: "📨 Demandes", compteur: demande ? "1" : undefined },
    { cle: "appareil", label: `💻 ${appels.cetAppareilMaj}` },
    { cle: "aide", label: "❓ À savoir" },
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>📶 Réseau de la boutique{boutique ? ` — ${boutique.boutiqueNom}` : ""}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          {boutique === undefined ? (
            <p className="sous-titre">Chargement…</p>
          ) : boutique === null ? (
            <div className="message-erreur">Aucune boutique sur {appels.cetAppareil} : connectez-vous d'abord une fois.</div>
          ) : (
            <div className="disposition-parametres">
              <nav className="barre-laterale-parametres barre-laterale-reseau">
                <div className={`role-reseau role-reseau--${active ? "ok" : "alerte"}`}>
                  <span className="sous-info">Réseau</span>
                  <strong>{active ? "✅ activé" : "🔒 non activé"}</strong>
                  <span className="sous-info">{roleCourt}</span>
                </div>
                {rubriques.map((r) => (
                  <button
                    key={r.cle}
                    type="button"
                    className={`item-nav-parametres${rubrique === r.cle ? " actif" : ""}`}
                    onClick={() => aller(r.cle)}
                  >
                    {r.label}
                    {r.compteur && <span className="compteur-nav-reseau">{r.compteur}</span>}
                  </button>
                ))}
              </nav>
              <div className="contenu-parametres contenu-reseau">
                {erreur && <div className="message-erreur">{erreur}</div>}
                {message && <div className="message-succes">{message}</div>}
                {contenu()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
