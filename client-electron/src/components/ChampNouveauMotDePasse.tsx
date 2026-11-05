import { useState } from "react";

import { genererMotDePasse, soliditeMotDePasse } from "../lib/motDePasse";

/**
 * Nouveau mot de passe tapé deux fois, avec 👁, « 🎲 Générer », barre de
 * solidité et règles. Un mot de passe généré est affiché en clair et n'a pas
 * besoin d'être retapé.
 */
export default function ChampNouveauMotDePasse({
  valeur,
  confirmation,
  onChange,
  identifiant = "",
  generable = true,
}: {
  valeur: string;
  confirmation: string;
  onChange: (valeur: string, confirmation: string) => void;
  identifiant?: string;
  generable?: boolean;
}) {
  const [afficher, setAfficher] = useState(false);
  const [genere, setGenere] = useState(false);
  const solidite = soliditeMotDePasse(valeur, identifiant);

  return (
    <div className="champ-nouveau-mot-de-passe">
      <label>
        Nouveau mot de passe
        <div className="champ-mot-de-passe">
          <input
            type={afficher ? "text" : "password"}
            value={valeur}
            autoComplete="new-password"
            onChange={(e) => {
              setGenere(false);
              onChange(e.target.value, confirmation);
            }}
          />
          <button
            type="button"
            className="bouton-afficher-mot-de-passe"
            onClick={() => setAfficher((v) => !v)}
            aria-label={afficher ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            tabIndex={-1}
          >
            {afficher ? "🙈" : "👁"}
          </button>
        </div>
      </label>
      {generable && (
        <div>
          <button
            type="button"
            onClick={() => {
              const nouveau = genererMotDePasse();
              setGenere(true);
              setAfficher(true);
              onChange(nouveau, nouveau);
            }}
          >
            🎲 Générer un mot de passe
          </button>
        </div>
      )}
      {valeur && (
        <div className="solidite-mot-de-passe">
          <div className={`barre-solidite barre-solidite--${solidite.score}`}>
            <span style={{ width: `${solidite.score * 25}%` }} />
          </div>
          <span className="sous-info">{solidite.libelle}</span>
        </div>
      )}
      <ul className="verifications-reseau regles-mot-de-passe">
        {["8 caractères au moins", "pas seulement des chiffres", "ne pas contenir l'identifiant"].map((regle) => (
          <li key={regle} className={valeur && !solidite.manques.includes(regle) ? "verif-ok" : "verif-info"}>
            {regle}
          </li>
        ))}
      </ul>
      {!genere && (
        <label>
          Retaper le mot de passe
          <input
            type={afficher ? "text" : "password"}
            value={confirmation}
            autoComplete="new-password"
            onChange={(e) => onChange(valeur, e.target.value)}
          />
          {confirmation && confirmation !== valeur && <span className="texte-erreur">Les deux ne sont pas identiques.</span>}
        </label>
      )}
    </div>
  );
}
