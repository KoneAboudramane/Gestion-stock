/**
 * Rubriques du site. `droit` : clé de administration/droits.py nécessaire pour
 * voir la rubrique (null : tout administrateur). Le serveur revérifie toujours.
 */
export interface Rubrique {
  id: string;
  libelle: string;
  icone: string;
  droit: string | null;
  groupe: "suivi" | "boutiques" | "argent" | "principal";
  lot: number;
}

export const RUBRIQUES: Rubrique[] = [
  { id: "tableau-de-bord", libelle: "Tableau de bord", icone: "📊", droit: null, groupe: "suivi", lot: 3 },
  { id: "boutiques", libelle: "Boutiques", icone: "🏪", droit: "boutiques", groupe: "boutiques", lot: 3 },
  { id: "inscriptions", libelle: "Inscriptions", icone: "📝", droit: "inscriptions", groupe: "boutiques", lot: 3 },
  { id: "creer-boutique", libelle: "Créer une boutique", icone: "➕", droit: "creer_boutique", groupe: "boutiques", lot: 3 },
  { id: "comptes", libelle: "Comptes et mots de passe", icone: "🔑", droit: "comptes", groupe: "boutiques", lot: 4 },
  { id: "paiements", libelle: "Paiements", icone: "💳", droit: "paiements", groupe: "argent", lot: 4 },
  { id: "demandes-reseau", libelle: "Demandes de réseau", icone: "🖧", droit: "demandes_reseau", groupe: "argent", lot: 4 },
  { id: "signalements", libelle: "Signalements", icone: "⚠️", droit: "signalements", groupe: "argent", lot: 4 },
  { id: "laissez-passer", libelle: "Laissez-passer", icone: "🎫", droit: "laissez_passer", groupe: "boutiques", lot: 6 },
  { id: "administrateurs", libelle: "Administrateurs", icone: "🛡️", droit: "admins", groupe: "principal", lot: 5 },
  { id: "reglages", libelle: "Réglages de la plateforme", icone: "⚙️", droit: "reglages_plateforme", groupe: "principal", lot: 5 },
  { id: "journal", libelle: "Journal des actions", icone: "📜", droit: "journal", groupe: "principal", lot: 5 },
];

export const GROUPES: Record<Rubrique["groupe"], string> = {
  suivi: "Suivi",
  boutiques: "Boutiques",
  argent: "Abonnements et demandes",
  principal: "Administrateur principal",
};

export function rubriquesVisibles(droits: string[]): Rubrique[] {
  return RUBRIQUES.filter((r) => r.droit === null || droits.includes(r.droit));
}
