/**
 * Unités et attributs que la plupart des commerçants utilisent. Même liste que
 * catalogue/catalogue_par_defaut.py (créés à l'inscription d'une boutique) :
 * ici pour le bouton « Ajouter les unités courantes » des boutiques existantes.
 */
export const UNITES_PAR_DEFAUT: { nom: string; abreviation: string }[] = [
  { nom: "Pièce", abreviation: "pce" },
  { nom: "Carton", abreviation: "ctn" },
  { nom: "Paquet", abreviation: "pqt" },
  { nom: "Sachet", abreviation: "sct" },
  { nom: "Boîte", abreviation: "bte" },
  { nom: "Sac", abreviation: "sac" },
  { nom: "Fardeau", abreviation: "fdo" },
  { nom: "Douzaine", abreviation: "dz" },
  { nom: "Kilo", abreviation: "kg" },
  { nom: "Gramme", abreviation: "g" },
  { nom: "Litre", abreviation: "L" },
  { nom: "Bidon", abreviation: "bid" },
  { nom: "Mètre", abreviation: "m" },
  { nom: "Rouleau", abreviation: "rlx" },
  { nom: "Plaquette", abreviation: "plq" },
];

export const ATTRIBUTS_PAR_DEFAUT: { nom: string; valeurs: string[] }[] = [
  { nom: "Taille", valeurs: ["XS", "S", "M", "L", "XL", "XXL"] },
  { nom: "Couleur", valeurs: ["Noir", "Blanc", "Rouge", "Bleu", "Vert", "Jaune", "Gris", "Marron"] },
  { nom: "Pointure", valeurs: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"] },
  { nom: "Contenance", valeurs: ["25 cl", "33 cl", "50 cl", "1 L", "1,5 L", "5 L"] },
  { nom: "Poids", valeurs: ["250 g", "500 g", "1 kg", "5 kg", "25 kg", "50 kg"] },
];

export function memeNom(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
