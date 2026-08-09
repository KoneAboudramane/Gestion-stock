import type { InputHTMLAttributes } from "react";

import { formaterMontant, nettoyerMontantSaisi } from "../lib/formatage";

/**
 * Champ de saisie de montant/prix : affiche une espace tous les 3 chiffres
 * pendant la frappe (ex: taper "12000" affiche "12 000"). La valeur brute
 * (sans espace) transite via value/onChange, comme un input number classique.
 * Un <input type="number"> ne peut pas afficher ce formatage (le navigateur
 * rejette tout caractère non numérique), d'où ce champ texte dédié.
 */
export default function ChampMontant({
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (valeurBrute: string) => void;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={formaterMontant(value)}
      onChange={(e) => onChange(nettoyerMontantSaisi(e.target.value))}
      {...rest}
    />
  );
}
