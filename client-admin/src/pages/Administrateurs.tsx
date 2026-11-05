import { type FormEvent, useState } from "react";

import { api, type DroitCatalogue, ErreurApi, type Moi } from "../api";
import { Chargement, Erreur, Modale } from "../composants/Commun";
import { dateHeure, motDePasseProvisoire } from "../format";
import type { Administrateur } from "../types";
import { useChargement } from "../useChargement";

/** Noms courts des droits pour les badges du tableau (le libellé complet est en info-bulle). */
const COURT: Record<string, string> = {
  boutiques: "Boutiques",
  inscriptions: "Inscriptions",
  creer_boutique: "Créer boutique",
  paiements: "Paiements",
  demandes_reseau: "Réseau",
  signalements: "Signalements",
  comptes: "Comptes",
};

interface Liste {
  catalogue_droits: DroitCatalogue[];
  administrateurs: Administrateur[];
}

export default function Administrateurs({ moi }: { moi: Moi }) {
  const { donnees, setDonnees, erreur, enCours, recharger } = useChargement(() => api<Liste>("/admin/administrateurs/"));
  const [ouvert, setOuvert] = useState<Administrateur | "nouveau" | null>(null);

  function remplacer(a: Administrateur) {
    setDonnees((d) => {
      if (!d) return d;
      const existe = d.administrateurs.some((x) => x.id === a.id);
      return {
        ...d,
        administrateurs: existe ? d.administrateurs.map((x) => (x.id === a.id ? a : x)) : [...d.administrateurs, a],
      };
    });
  }

  if (erreur) return <Erreur message={erreur} reessayer={recharger} />;
  if (enCours || !donnees) return <Chargement />;
  const libelle = (cle: string) => donnees.catalogue_droits.find((d) => d.cle === cle)?.libelle ?? cle;

  return (
    <div className="pile">
      <div className="barre-filtres">
        <p className="aide" style={{ flex: 1 }}>
          Vous cochez pour chaque administrateur ce qu'il peut faire. Gérer les administrateurs, les réglages de la
          plateforme et le journal vous restent réservés.
        </p>
        <button type="button" className="bouton-principal" onClick={() => setOuvert("nouveau")}>
          ➕ Nouvel administrateur
        </button>
      </div>
      <section className="carte carte-tableau">
        <div className="defilement-tableau">
          <table className="tableau">
            <thead>
              <tr>
                <th>Administrateur</th>
                <th>Droits</th>
                <th>Double vérification</th>
                <th>Dernière connexion</th>
              </tr>
            </thead>
            <tbody>
              {donnees.administrateurs.map((a) => (
                <tr key={a.id} className={`ligne-cliquable${a.actif ? "" : " ligne-inactive"}`} onClick={() => setOuvert(a)}>
                  <td>
                    <strong>{a.nom || a.username}</strong>
                    {a.id === moi.id && " (vous)"}
                    <small className="sous-ligne">
                      {a.username}
                      {a.superuser ? " · administrateur principal" : ""}
                      {!a.actif ? " · désactivé" : ""}
                    </small>
                  </td>
                  <td>
                    {a.superuser ? (
                      <span className="badge badge-bleu">Tous les droits</span>
                    ) : a.droits.length === 0 ? (
                      <span className="discret">Aucun</span>
                    ) : (
                      <span className="liste-badges">
                        {a.droits.map((d) => (
                          <span key={d} className="badge badge-gris" title={libelle(d)}>
                            {COURT[d] ?? d}
                          </span>
                        ))}
                      </span>
                    )}
                    {a.droits_herites && <small className="sous-ligne">Droits d'avant (jamais réglés)</small>}
                  </td>
                  <td>
                    {a.double_verification_exigee ? (
                      a.double_verification_active ? (
                        <span className="badge badge-vert">🔒 Active</span>
                      ) : (
                        <span className="badge badge-orange">Exigée, à configurer</span>
                      )
                    ) : (
                      <span className="discret">Non exigée</span>
                    )}
                  </td>
                  <td>{dateHeure(a.derniere_connexion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {ouvert && (
        <FicheAdmin
          admin={ouvert === "nouveau" ? null : ouvert}
          moi={moi}
          catalogue={donnees.catalogue_droits}
          surFermer={() => setOuvert(null)}
          surEnregistre={(a) => {
            remplacer(a);
            setOuvert(a);
          }}
        />
      )}
    </div>
  );
}

function FicheAdmin({
  admin,
  moi,
  catalogue,
  surFermer,
  surEnregistre,
}: {
  admin: Administrateur | null;
  moi: Moi;
  catalogue: DroitCatalogue[];
  surFermer: () => void;
  surEnregistre: (a: Administrateur) => void;
}) {
  const nouveau = admin === null;
  const soiMeme = admin?.id === moi.id;
  const [f, setF] = useState({
    username: "",
    first_name: admin?.first_name ?? "",
    last_name: admin?.last_name ?? "",
    email: admin?.email ?? "",
    telephone: admin?.telephone ?? "",
    password: motDePasseProvisoire(),
    droits: admin?.droits ?? [],
    double_verification_exigee: admin?.double_verification_exigee ?? true,
  });
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [remis, setRemis] = useState<{ identifiant: string; motDePasse: string } | null>(null);

  async function envoyer(corps: Record<string, unknown>, message?: string) {
    if (message && !window.confirm(message)) return null;
    setEnCours(true);
    setErreur("");
    setErreurs({});
    try {
      const a = await api<Administrateur>(nouveau ? "/admin/administrateurs/" : `/admin/administrateurs/${admin!.id}/`, {
        method: nouveau ? "POST" : "PATCH",
        body: JSON.stringify(corps),
      });
      surEnregistre(a);
      return a;
    } catch (err) {
      const champs = err instanceof ErreurApi ? err.champs : {};
      setErreurs(champs);
      setErreur(Object.keys(champs).length ? "Corrigez les champs signalés en rouge." : (err as Error).message);
      return null;
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    const commun = {
      first_name: f.first_name,
      last_name: f.last_name,
      email: f.email,
      telephone: f.telephone,
      double_verification_exigee: f.double_verification_exigee,
      ...(admin?.superuser ? {} : { droits: f.droits }),
    };
    if (nouveau) {
      const a = await envoyer({ ...commun, username: f.username.trim(), password: f.password });
      if (a) setRemis({ identifiant: a.username, motDePasse: f.password });
      return;
    }
    const activeSurSoi = soiMeme && f.double_verification_exigee && !admin!.double_verification_exigee;
    const a = await envoyer(
      soiMeme ? { ...commun, droits: undefined } : commun,
      activeSurSoi
        ? "Activer la double vérification pour vous-même ? Vous serez déconnecté et devrez scanner un QR code avec votre téléphone."
        : undefined,
    );
    // Le serveur coupe la session qui n'est pas passée par le code : on recharge pour se reconnecter.
    if (a && activeSurSoi) window.location.reload();
  }

  async function nouveauMotDePasse() {
    const mdp = motDePasseProvisoire();
    const a = await envoyer(
      { nouveau_mot_de_passe: mdp },
      `Donner un mot de passe provisoire à ${admin!.username} ? Son mot de passe actuel ne marchera plus.`,
    );
    if (a) setRemis({ identifiant: a.username, motDePasse: mdp });
  }

  const basculerDroit = (cle: string) =>
    setF((x) => ({ ...x, droits: x.droits.includes(cle) ? x.droits.filter((d) => d !== cle) : [...x.droits, cle] }));

  const champ = (cle: "first_name" | "last_name" | "email" | "telephone", libelle: string, type = "text") => (
    <label>
      {libelle}
      <input type={type} value={f[cle]} onChange={(e) => setF((x) => ({ ...x, [cle]: e.target.value }))} />
      {erreurs[cle] && <small className="erreur-champ">{erreurs[cle]}</small>}
    </label>
  );

  return (
    <Modale titre={nouveau ? "Nouvel administrateur" : `${admin!.nom || admin!.username}${soiMeme ? " (vous)" : ""}`} surFermer={surFermer}>
      {remis ? (
        <section className="carte carte-succes">
          <h2>✅ {nouveau ? "Administrateur créé" : "Mot de passe provisoire donné"}</h2>
          <p>Transmettez-lui ces identifiants. Il choisira son propre mot de passe à sa première connexion.</p>
          <dl className="infos identifiants-remis">
            <div className="info">
              <dt>Identifiant</dt>
              <dd>
                <code>{remis.identifiant}</code>
              </dd>
            </div>
            <div className="info">
              <dt>Mot de passe</dt>
              <dd>
                <code>{remis.motDePasse}</code>
              </dd>
            </div>
          </dl>
          <div className="actions">
            <button type="button" className="bouton-principal" onClick={() => (nouveau ? surFermer() : setRemis(null))}>
              {nouveau ? "Fermer" : "Retour à la fiche"}
            </button>
          </div>
        </section>
      ) : (
        <form className="pile formulaire" onSubmit={enregistrer}>
          <section className="carte">
            <h3>Identité</h3>
            <div className="grille-champs">
              {nouveau && (
                <label>
                  Identifiant de connexion<span className="requis"> *</span>
                  <input
                    value={f.username}
                    onChange={(e) => setF((x) => ({ ...x, username: e.target.value.replace(/\s/g, "") }))}
                    required
                    autoComplete="off"
                  />
                  {erreurs.username && <small className="erreur-champ">{erreurs.username}</small>}
                </label>
              )}
              {champ("first_name", "Prénom")}
              {champ("last_name", "Nom")}
              {champ("email", "E-mail", "email")}
              {champ("telephone", "Téléphone", "tel")}
              {nouveau && (
                <label>
                  Mot de passe provisoire
                  <span className="champ-avec-bouton">
                    <input value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} required />
                    <button type="button" className="bouton-secondaire" onClick={() => setF((x) => ({ ...x, password: motDePasseProvisoire() }))}>
                      Générer
                    </button>
                  </span>
                  {erreurs.password && <small className="erreur-champ">{erreurs.password}</small>}
                </label>
              )}
            </div>
          </section>

          <section className="carte">
            <h3>Droits</h3>
            {admin?.superuser ? (
              <p className="aide">Administrateur principal : il a tous les droits.</p>
            ) : (
              <>
                {admin?.droits_herites && (
                  <p className="aide">
                    Ce compte a été créé avant les droits : il a tout ce qui n'est pas réservé. Décochez ce qu'il ne doit
                    pas faire.
                  </p>
                )}
                <div className="cases-droits">
                  {catalogue.map((d) => (
                    <label key={d.cle} className="interrupteur">
                      <input type="checkbox" checked={f.droits.includes(d.cle)} onChange={() => basculerDroit(d.cle)} />
                      {d.libelle}
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="carte">
            <h3>Double vérification</h3>
            <label className="interrupteur">
              <input
                type="checkbox"
                checked={f.double_verification_exigee}
                onChange={(e) => setF((x) => ({ ...x, double_verification_exigee: e.target.checked }))}
              />
              Exiger un code de l'appli d'authentification à chaque connexion au site
            </label>
            <p className="aide">
              {nouveau
                ? "Il scannera un QR code avec son téléphone à sa première connexion."
                : admin!.double_verification_active
                  ? "Configurée sur son téléphone."
                  : admin!.double_verification_exigee
                    ? "Pas encore configurée : il scannera le QR code à sa prochaine connexion."
                    : "Le mot de passe suffit pour se connecter."}{" "}
              L'Espace Admin de l'appli de bureau reste sans code (dépannage hors ligne).
            </p>
            {!nouveau && admin!.double_verification_active && (
              <button
                type="button"
                className="bouton-secondaire"
                disabled={enCours}
                onClick={() =>
                  envoyer(
                    { reinitialiser_double_verification: true },
                    `Téléphone perdu ou changé ? ${admin!.username} devra scanner un nouveau QR code à sa prochaine connexion.`,
                  )
                }
              >
                📱 Réinitialiser (nouveau téléphone)
              </button>
            )}
          </section>

          {erreur && <Erreur message={erreur} />}
          <div className="actions">
            {!nouveau && !soiMeme && !admin!.superuser && (
              <>
                <button
                  type="button"
                  className="bouton-danger"
                  disabled={enCours}
                  onClick={() =>
                    envoyer(
                      { actif: !admin!.actif },
                      admin!.actif
                        ? `Désactiver ${admin!.username} ? Il ne pourra plus se connecter. Sur un poste de bureau sans internet, l'Espace Admin ne le saura qu'au retour de la connexion.`
                        : `Réactiver ${admin!.username} ?`,
                    )
                  }
                >
                  {admin!.actif ? "Désactiver" : "Réactiver"}
                </button>
                {admin!.actif && (
                  <button type="button" className="bouton-secondaire" disabled={enCours} onClick={nouveauMotDePasse}>
                    🔑 Mot de passe provisoire
                  </button>
                )}
              </>
            )}
            <button type="submit" className="bouton-principal" disabled={enCours || (!nouveau && !admin!.actif)}>
              {enCours ? "Enregistrement…" : nouveau ? "Créer l'administrateur" : "Enregistrer"}
            </button>
          </div>
        </form>
      )}
    </Modale>
  );
}
