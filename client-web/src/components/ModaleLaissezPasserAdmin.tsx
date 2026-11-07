import { useState } from "react";

import { genererLaissezPasser, type LaissezPasserGenere } from "../services/laissezPasser";

/**
 * Espace Admin de l'appli → « 🎫 Laissez-passer » (docs/plan_laissez_passer_admin.md) :
 * générer, AVEC internet, un laissez-passer qui ouvrira l'Espace Admin d'un appareil
 * SANS internet. Le serveur le fabrique et le signe (aucune clé dans l'appli) ; mêmes
 * règles que sur le site d'administration (droit « Laissez-passer », journal).
 * Copie conforme : client-electron/src/components/ModaleLaissezPasserAdmin.tsx.
 */

const DUREES: { valeur: number | null; libelle: string }[] = [
  { valeur: 1, libelle: "1 jour" },
  { valeur: 7, libelle: "7 jours" },
  { valeur: 15, libelle: "15 jours" },
  { valeur: 30, libelle: "30 jours" },
  { valeur: 90, libelle: "90 jours" },
  { valeur: null, libelle: "Illimité" },
];

function dateCourte(iso: string | null): string {
  return iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR") : "";
}

export default function ModaleLaissezPasserAdmin({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [duree, setDuree] = useState<number | null>(15);
  const [genere, setGenere] = useState<LaissezPasserGenere | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [copie, setCopie] = useState(false);

  async function generer() {
    setErreur(null);
    setEnCours(true);
    try {
      setGenere(await genererLaissezPasser(username, password, duree));
      setCopie(false);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Génération impossible.");
    } finally {
      setEnCours(false);
    }
  }

  async function copier() {
    if (!genere) return;
    try {
      await navigator.clipboard.writeText(genere.code);
      setCopie(true);
    } catch {
      setErreur("Copie impossible : sélectionnez le code à la main.");
    }
  }

  function envoyerWhatsapp() {
    if (!genere) return;
    const texte = `Laissez-passer Gestion Stock (Espace Admin sans internet)${genere.illimite ? "" : ` — valable jusqu'au ${dateCourte(genere.date_fin)}`} :\n${genere.code}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texte)}`, "_blank", "noopener");
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-laissez-passer-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>🎫 Laissez-passer</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps contenu-reseau">
          <p className="note-aide">
            Pour ouvrir l'Espace Admin d'un appareil <strong>qui n'a jamais vu internet</strong> (installation en zone sans
            réseau). Générez-le ici <strong>avec internet</strong>, avant de partir. Sur place : ⚙ Espace Admin → cochez « 🎫
            J'ai un laissez-passer », collez le code, puis tapez votre identifiant et votre mot de passe. Le code seul ne
            suffit pas ; il cesse de marcher si vous changez de mot de passe, et il peut être révoqué sur le site
            d'administration.
          </p>
          <div className="formulaire-catalogue">
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
              <p className="note-aide">
                ⚠️ Illimité : il servira sur tous vos appareils neufs, aussi longtemps que vous voulez. Gardez-le en lieu sûr ; il
                reste protégé par votre mot de passe.
              </p>
            )}
            {erreur && <div className="message-erreur">{erreur}</div>}
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" disabled={enCours} onClick={generer}>
                {enCours ? "Génération…" : genere ? "Générer un autre" : "Générer le laissez-passer"}
              </button>
            </div>
          </div>
          {genere && (
            <div className="bloc-reseau">
              <h4>Votre laissez-passer</h4>
              <p className="note-aide">
                <strong>Copiez-le maintenant</strong> : il n'est montré qu'une fois.{" "}
                {genere.illimite ? "Sans date de fin." : `Valable jusqu'au ${dateCourte(genere.date_fin)}.`} N° {genere.numero}.
              </p>
              <textarea className="champ-code-activation" rows={5} readOnly value={genere.code} onFocus={(e) => e.target.select()} />
              <div className="actions-formulaire">
                <button type="button" className="bouton-primaire" onClick={copier}>
                  {copie ? "✓ Copié" : "Copier le code"}
                </button>
                <button type="button" onClick={envoyerWhatsapp}>
                  💬 Envoyer par WhatsApp
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
