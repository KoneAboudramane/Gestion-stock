import { useState } from "react";

import { api } from "../api";
import { Chargement, Erreur } from "../composants/Commun";
import { date, dateHeure } from "../format";
import { useChargement } from "../useChargement";

/**
 * Laissez-passer admin (docs/plan_laissez_passer_admin.md, lot B) : un code
 * signé qui ouvre l'Espace Admin d'un appareil SANS internet (installation en
 * zone sans réseau), avec le mot de passe de l'admin. Généré ici avec internet,
 * avant de partir ; le code n'est montré qu'une fois.
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

const DUREES: { valeur: number | null; libelle: string }[] = [
  { valeur: 1, libelle: "1 jour" },
  { valeur: 7, libelle: "7 jours" },
  { valeur: 15, libelle: "15 jours" },
  { valeur: 30, libelle: "30 jours" },
  { valeur: 90, libelle: "90 jours" },
  { valeur: null, libelle: "Illimité" },
];

const BADGE_ETAT: Record<LaissezPasserLigne["etat"], string> = {
  actif: "badge badge-vert",
  expire: "badge badge-gris",
  revoque: "badge badge-rouge",
  mot_de_passe_change: "badge badge-orange",
  compte_desactive: "badge badge-rouge",
};

export default function LaissezPasser() {
  const [duree, setDuree] = useState<number | null>(15);
  const [motDePasse, setMotDePasse] = useState("");
  const [nouveau, setNouveau] = useState<(LaissezPasserLigne & { code: string }) | null>(null);
  const [copie, setCopie] = useState(false);
  const [erreurAction, setErreurAction] = useState("");
  const [enCours, setEnCours] = useState(false);
  const { donnees, erreur, enCours: chargement, recharger } = useChargement(
    () => api<{ laissez_passer: LaissezPasserLigne[] }>("/admin/laissez-passer/"),
    [],
  );

  async function generer(evenement: React.FormEvent) {
    evenement.preventDefault();
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
    if (!window.confirm(`Révoquer le laissez-passer n° ${lp.numero} ? Les appareils qui l'ont utilisé perdront l'accès admin à leur retour sur internet.`)) return;
    setErreurAction("");
    try {
      await api(`/admin/laissez-passer/${lp.id}/revoquer/`, { method: "POST" });
      recharger();
    } catch (e) {
      setErreurAction((e as Error).message);
    }
  }

  async function copier() {
    if (!nouveau) return;
    await navigator.clipboard.writeText(nouveau.code);
    setCopie(true);
  }

  function partagerWhatsapp() {
    if (!nouveau) return;
    const texte = `Laissez-passer Gestion Stock (Espace Admin sans internet)${nouveau.illimite ? "" : ` — valable jusqu'au ${date(nouveau.date_fin)}`} :\n${nouveau.code}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texte)}`, "_blank", "noopener");
  }

  return (
    <div className="pile">
      <p className="aide">
        Pour installer ou dépanner une boutique dans une <strong>zone sans réseau</strong>, sur un appareil qui n'a
        jamais vu internet. Générez le laissez-passer <strong>avant de partir</strong>. Sur place : ⚙ Espace Admin →
        « 🎫 Laissez-passer » → collez le code et tapez votre identifiant et votre mot de passe. Le code seul ne suffit
        pas ; il cesse de marcher si vous changez de mot de passe, et vous pouvez le révoquer ici.
      </p>

      <section className="carte">
        <h3>🎫 Nouveau laissez-passer</h3>
        <form className="formulaire" onSubmit={generer}>
          <label>
            Durée
            <select value={duree === null ? "illimite" : String(duree)} onChange={(e) => setDuree(e.target.value === "illimite" ? null : Number(e.target.value))}>
              {DUREES.map((d) => (
                <option key={d.libelle} value={d.valeur === null ? "illimite" : String(d.valeur)}>
                  {d.libelle}
                </option>
              ))}
            </select>
          </label>
          {duree === null && (
            <p className="aide">
              ⚠️ Illimité : gardez-le en lieu sûr. Il reste protégé par votre mot de passe, et vous pouvez le révoquer.
            </p>
          )}
          <label>
            Votre mot de passe (confirmation)
            <input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="current-password" required />
          </label>
          {erreurAction && <Erreur message={erreurAction} />}
          <div className="actions actions-gauche">
            <button type="submit" className="bouton-principal" disabled={enCours || !motDePasse}>
              {enCours ? "Génération…" : "Générer le laissez-passer"}
            </button>
          </div>
        </form>
        {nouveau && (
          <div className="bloc-code">
            <p className="aide">
              <strong>Copiez-le maintenant</strong> : il n'est montré qu'une fois.{" "}
              {nouveau.illimite ? "Sans date de fin." : `Valable jusqu'au ${date(nouveau.date_fin)}.`}
            </p>
            <code className="code-activation">{nouveau.code}</code>
            <div className="actions actions-gauche">
              <button type="button" className="bouton-principal" onClick={copier}>
                {copie ? "✓ Copié" : "Copier le code"}
              </button>
              <button type="button" className="bouton-secondaire" onClick={partagerWhatsapp}>
                💬 Envoyer par WhatsApp
              </button>
              <button type="button" className="bouton-secondaire" onClick={() => window.print()}>
                🖨️ Imprimer
              </button>
            </div>
          </div>
        )}
      </section>

      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {chargement && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            {donnees.laissez_passer.length === 0 ? (
              <p className="vide">Aucun laissez-passer pour l'instant.</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Numéro</th>
                      <th>Administrateur</th>
                      <th>Créé le</th>
                      <th>Valable jusqu'au</th>
                      <th>État</th>
                      <th>Utilisations</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.laissez_passer.map((lp) => (
                      <tr key={lp.id}>
                        <td>
                          <code>{lp.numero}</code>
                        </td>
                        <td>{lp.admin}</td>
                        <td>{dateHeure(lp.date_creation)}</td>
                        <td>{lp.illimite ? "Illimité" : date(lp.date_fin)}</td>
                        <td>
                          <span className={BADGE_ETAT[lp.etat]}>{lp.etat_libelle}</span>
                        </td>
                        <td>
                          {lp.utilisations}
                          {lp.derniere_utilisation && <span className="aide"> · dernière {dateHeure(lp.derniere_utilisation)}</span>}
                        </td>
                        <td>
                          {lp.etat === "actif" && (
                            <button type="button" className="bouton-secondaire" onClick={() => revoquer(lp)}>
                              Révoquer
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      )}
    </div>
  );
}
