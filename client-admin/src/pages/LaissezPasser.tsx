import { createPortal } from "react-dom";
import { useState } from "react";

import { api } from "../api";
import OngletsRubriques from "../composants/OngletsRubriques";
import { Chargement, Erreur } from "../composants/Commun";
import { date, dateHeure } from "../format";
import { useChargement } from "../useChargement";

/**
 * Laissez-passer admin (docs/plan_laissez_passer_admin.md), au même design que
 * la modale « 🎫 Laissez-passer » de l'Espace Admin du bureau : Générer (durées en
 * cartes, grand encadré du code), Laissez-passer (liste, révocation), Comment s'en
 * servir. Sur le site, le mot de passe de l'admin est redemandé pour générer.
 */

interface LaissezPasserLigne {
  id: string;
  numero: string;
  admin: string;
  date_creation: string;
  date_fin: string | null;
  illimite: boolean;
  etat: "actif" | "expire" | "revoque" | "mot_de_passe_change" | "compte_desactive";
  etat_libelle: string;
  utilisations: number;
  derniere_utilisation: string | null;
  date_revocation: string | null;
}

type Rubrique = "generer" | "liste" | "aide";

const DUREES: { valeur: number | null; libelle: string }[] = [
  { valeur: 1, libelle: "1 jour" },
  { valeur: 7, libelle: "7 jours" },
  { valeur: 15, libelle: "15 jours" },
  { valeur: 30, libelle: "30 jours" },
  { valeur: 90, libelle: "90 jours" },
  { valeur: null, libelle: "Illimité" },
];

const CLASSE_ETAT: Record<LaissezPasserLigne["etat"], string> = {
  actif: "badge-lp badge-lp--actif",
  expire: "badge-lp",
  revoque: "badge-lp badge-lp--alerte",
  mot_de_passe_change: "badge-lp",
  compte_desactive: "badge-lp badge-lp--alerte",
};

function finDans(jours: number): string {
  const fin = new Date();
  fin.setDate(fin.getDate() + jours);
  return fin.toISOString();
}

export default function LaissezPasser() {
  const [rubrique, setRubrique] = useState<Rubrique>("generer");
  const [duree, setDuree] = useState<number | null>(15);
  const [motDePasse, setMotDePasse] = useState("");
  const [nouveau, setNouveau] = useState<(LaissezPasserLigne & { code: string }) | null>(null);
  const [copie, setCopie] = useState(false);
  const [aRevoquer, setARevoquer] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const { donnees, erreur, enCours: chargement, recharger } = useChargement(
    () => api<{ laissez_passer: LaissezPasserLigne[] }>("/admin/laissez-passer/"),
    [],
  );
  const liste = donnees?.laissez_passer ?? null;
  const actifs = liste?.filter((lp) => lp.etat === "actif").length ?? null;
  const plusieursAdmins = !!liste && new Set(liste.map((lp) => lp.admin)).size > 1;

  function aller(r: Rubrique) {
    setErreurAction("");
    setMessage("");
    setRubrique(r);
  }

  async function generer() {
    setErreurAction("");
    setEnCours(true);
    try {
      const r = await api<LaissezPasserLigne & { code: string }>("/admin/laissez-passer/", {
        method: "POST",
        body: JSON.stringify({ duree_jours: duree === null ? "illimite" : duree, mot_de_passe: motDePasse }),
      });
      setNouveau(r);
      setCopie(false);
      setMotDePasse("");
      recharger();
    } catch (e) {
      setErreurAction((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  async function revoquer(lp: LaissezPasserLigne) {
    setErreurAction("");
    setEnCours(true);
    try {
      await api(`/admin/laissez-passer/${lp.id}/revoquer/`, { method: "POST" });
      setMessage(`Laissez-passer n° ${lp.numero} révoqué : l'appareil qui l'utilise perdra l'accès admin à son retour sur internet.`);
      setARevoquer(null);
      recharger();
    } catch (e) {
      setErreurAction((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  async function copier() {
    if (!nouveau) return;
    try {
      await navigator.clipboard.writeText(nouveau.code);
      setCopie(true);
    } catch {
      setErreurAction("Copie impossible : sélectionnez le code à la main.");
    }
  }

  function partagerWhatsapp() {
    if (!nouveau) return;
    const texte = `Laissez-passer Gestion Stock (Espace Admin sans internet)${nouveau.illimite ? "" : ` — valable jusqu'au ${date(nouveau.date_fin)}`} :\n${nouveau.code}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texte)}`, "_blank", "noopener");
  }

  function imprimer() {
    document.body.classList.add("impression-laissez-passer");
    window.print();
    document.body.classList.remove("impression-laissez-passer");
  }

  function contenu() {
    if (rubrique === "aide") {
      return (
        <>
          <h4 className="titre-rubrique-reseau">❓ Comment s'en servir</h4>
          <ol className="etapes-aide-lp">
            <li>
              <strong>Avant de partir, avec internet</strong> : générez le laissez-passer ici et copiez-le (ou envoyez-le vous
              par WhatsApp, ou imprimez-le).
            </li>
            <li>
              <strong>Sur place, sans internet</strong>, sur l'appareil neuf : ⚙ Espace Admin → cochez « 🎫 J'ai un
              laissez-passer » et collez le code.
            </li>
            <li>Tapez votre identifiant et votre mot de passe administrateur : le code seul ne suffit pas.</li>
          </ol>
          <p className="note-aide">
            Il cesse de marcher si vous changez de mot de passe, à sa date de fin, ou si vous le révoquez (ici ou depuis
            l'Espace Admin du bureau).
          </p>
        </>
      );
    }
    if (rubrique === "liste") {
      return (
        <>
          <h4 className="titre-rubrique-reseau">📋 Laissez-passer</h4>
          <p className="note-aide">
            Le code n'est gardé nulle part : seuls le numéro et l'état sont listés. Révoquer coupe l'accès admin de l'appareil
            qui l'utilise, dès son retour sur internet.
          </p>
          {erreur && <Erreur message={erreur} reessayer={recharger} />}
          {chargement && !liste ? (
            <Chargement />
          ) : !liste || liste.length === 0 ? (
            <p className="vide">Aucun laissez-passer pour l'instant.</p>
          ) : (
            <div className="defilement-tableau">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>N°</th>
                    {plusieursAdmins && <th>Administrateur</th>}
                    <th>Créé le</th>
                    <th>Valable jusqu'au</th>
                    <th>État</th>
                    <th>Utilisations</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {liste.map((lp) => (
                    <tr key={lp.id}>
                      <td className="code-numero-lp">{lp.numero}</td>
                      {plusieursAdmins && <td>{lp.admin}</td>}
                      <td>{dateHeure(lp.date_creation)}</td>
                      <td>{lp.illimite ? "illimité" : date(lp.date_fin)}</td>
                      <td>
                        <span className={CLASSE_ETAT[lp.etat]}>{lp.etat_libelle}</span>
                      </td>
                      <td>
                        {lp.utilisations}
                        {lp.derniere_utilisation && <small className="sous-ligne">dernière {dateHeure(lp.derniere_utilisation)}</small>}
                      </td>
                      <td>
                        {lp.etat === "actif" &&
                          (aRevoquer === lp.id ? (
                            <span className="actions-ligne-lp">
                              <button type="button" className="bouton-danger" disabled={enCours} onClick={() => revoquer(lp)}>
                                Confirmer
                              </button>
                              <button type="button" className="lien" onClick={() => setARevoquer(null)}>
                                Annuler
                              </button>
                            </span>
                          ) : (
                            <button type="button" className="lien" onClick={() => setARevoquer(lp.id)}>
                              ⛔ Révoquer
                            </button>
                          ))}
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
    return (
      <>
        <h4 className="titre-rubrique-reseau">🎫 Générer un laissez-passer</h4>
        <p className="note-aide">
          Il ouvre l'Espace Admin d'un appareil <strong>qui n'a jamais vu internet</strong> (zone sans réseau). Générez-le
          avant de partir.{" "}
          <button type="button" className="lien" onClick={() => aller("aide")}>
            Comment s'en servir ?
          </button>
        </p>
        <div className="etape-reseau">
          <span className="numero-etape-reseau">1</span>
          <div className="champ-etape-reseau">
            <strong>Durée</strong>
            <div className="grille-durees-abonnement">
              {DUREES.map((d) => (
                <button
                  key={d.libelle}
                  type="button"
                  className={`carte-duree-abonnement${duree === d.valeur ? " choisi" : ""}`}
                  onClick={() => setDuree(d.valeur)}
                >
                  <strong>{d.libelle}</strong>
                  <span className="sous-info">{d.valeur === null ? "sans date de fin" : `jusqu'au ${date(finDans(d.valeur))}`}</span>
                </button>
              ))}
            </div>
            {duree === null && (
              <span className="note-aide">
                ⚠️ Illimité : il servira sur tous vos appareils neufs. Gardez-le en lieu sûr ; il reste protégé par votre mot
                de passe, et vous pouvez le révoquer.
              </span>
            )}
          </div>
        </div>
        <div className="etape-reseau">
          <span className="numero-etape-reseau">2</span>
          <div className="champ-etape-reseau champs-sauvegarde">
            <strong>Votre mot de passe (confirmation)</strong>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && motDePasse && generer()}
              autoComplete="current-password"
            />
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" disabled={enCours || !motDePasse} onClick={generer}>
                {enCours ? "Génération…" : nouveau ? "🎫 Générer un autre" : "🎫 Générer le laissez-passer"}
              </button>
            </div>
          </div>
        </div>
        {nouveau && (
          <div className="bloc-code-lp">
            <div className="entete-code-lp">
              <strong>Votre laissez-passer · n° {nouveau.numero}</strong>
              <span>{nouveau.illimite ? "Sans date de fin" : `Valable jusqu'au ${date(nouveau.date_fin)}`}</span>
            </div>
            <p className="alerte-code-lp">⚠️ Montré une seule fois : copiez-le maintenant, il n'est gardé nulle part.</p>
            <textarea className="code-lp" rows={4} readOnly value={nouveau.code} onFocus={(e) => e.target.select()} />
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" onClick={copier}>
                {copie ? "✓ Copié" : "📋 Copier le code"}
              </button>
              <button type="button" onClick={partagerWhatsapp}>
                💬 WhatsApp
              </button>
              <button type="button" onClick={imprimer}>
                🖨 Imprimer
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="ecran-admin-commun page-onglets">
      <OngletsRubriques
        etiquette="Laissez-passer"
        etat={actifs === null ? "…" : `${actifs} actif(s)`}
        details={[liste ? `${liste.length} au total` : null]}
        rubriques={[
          { cle: "generer" as const, label: "🎫 Générer" },
          { cle: "liste" as const, label: "📋 Laissez-passer", compteur: actifs ?? undefined },
          { cle: "aide" as const, label: "❓ Comment s'en servir" },
        ]}
        active={rubrique}
        onChoisir={aller}
      />
      <div className="contenu-onglet contenu-reseau">
        {erreurAction && <Erreur message={erreurAction} />}
        {message && <div className="message-succes">{message}</div>}
        {contenu()}
      </div>
      {nouveau &&
        createPortal(
          <div className="zone-impression-laissez-passer">
            <h1>Laissez-passer Gestion Stock</h1>
            <p>
              Espace Admin sans internet · n° {nouveau.numero} ·{" "}
              {nouveau.illimite ? "sans date de fin" : `valable jusqu'au ${date(nouveau.date_fin)}`}
            </p>
            <pre>{nouveau.code}</pre>
            <p className="pied-lp">
              À garder en lieu sûr. Le code seul ne suffit pas : identifiant et mot de passe administrateur demandés.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
