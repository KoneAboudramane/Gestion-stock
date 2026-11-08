import { useState, type ReactNode } from "react";

/**
 * Fiche des accès d'un compte (Espace Admin → Créer une boutique, Réinitialiser
 * mot de passe) : identifiant et mot de passe en grand, à copier un par un ou
 * ensemble, à envoyer par WhatsApp ou à imprimer. Garde la structure
 * `.fiches-recuperation .fiche-recuperation` : l'impression « impression-fiche »
 * ne sort qu'elle. Même fichier dans client-electron et client-web.
 */
export default function FicheAcces({
  titre,
  details,
  identifiant,
  motDePasse,
  provisoire,
  texteAPartager,
  telephone,
  onWhatsapp,
  onImprimer,
  actionPrincipale,
}: {
  titre: string;
  /** Lignes d'information au-dessus des accès (boutique, patron, abonnement…). */
  details: { libelle: string; valeur: ReactNode }[];
  identifiant: string;
  motDePasse: string;
  provisoire: boolean;
  /** Texte complet copié ou envoyé par WhatsApp. */
  texteAPartager: string;
  telephone?: string;
  onWhatsapp: (texte: string, telephone: string) => void;
  onImprimer: () => void;
  actionPrincipale?: ReactNode;
}) {
  const [copie, setCopie] = useState<"tout" | "identifiant" | "motDePasse" | null>(null);

  async function copier(quoi: "tout" | "identifiant" | "motDePasse") {
    const texte = quoi === "tout" ? texteAPartager : quoi === "identifiant" ? identifiant : motDePasse;
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(quoi);
      setTimeout(() => setCopie(null), 2000);
    } catch {
      // presse-papiers indisponible : le texte reste sélectionnable à l'écran
    }
  }

  return (
    <>
      <div className="fiches-recuperation">
        <div className="fiche-recuperation fiche-acces">
          <h3>{titre}</h3>
          {details.length > 0 && (
            <dl className="details-fiche-acces">
              {details.map((d) => (
                <div key={d.libelle}>
                  <dt>{d.libelle}</dt>
                  <dd>{d.valeur}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="acces-fiche-acces">
            <div className="ligne-acces">
              <span className="libelle-acces">Identifiant</span>
              <code className="valeur-acces">{identifiant}</code>
              <button type="button" className="lien bouton-copier-acces" onClick={() => copier("identifiant")}>
                {copie === "identifiant" ? "✓" : "📋"}
              </button>
            </div>
            <div className="ligne-acces">
              <span className="libelle-acces">Mot de passe{provisoire ? " provisoire" : ""}</span>
              <code className="valeur-acces">{motDePasse}</code>
              <button type="button" className="lien bouton-copier-acces" onClick={() => copier("motDePasse")}>
                {copie === "motDePasse" ? "✓" : "📋"}
              </button>
            </div>
          </div>
          <p className="note-fiche-acces">
            {provisoire
              ? "À la première connexion, l'application demandera de choisir son propre mot de passe."
              : "Gardez ce mot de passe pour vous ; ne le communiquez à personne."}
          </p>
        </div>
      </div>
      <div className="actions-fiche-acces">
        <button type="button" className="bouton-primaire" onClick={() => copier("tout")}>
          {copie === "tout" ? "✓ Copié" : "📋 Tout copier"}
        </button>
        <button type="button" onClick={() => onWhatsapp(texteAPartager, telephone ?? "")}>
          💬 WhatsApp{telephone ? ` (${telephone})` : ""}
        </button>
        <button type="button" onClick={onImprimer}>
          🖨️ Imprimer
        </button>
        {actionPrincipale}
      </div>
    </>
  );
}
