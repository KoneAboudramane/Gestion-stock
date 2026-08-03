import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";

/**
 * Miroir de catalogue/services.py (Django, Étape 2) : un produit simple a
 * toujours au moins une variante par défaut (CLAUDE.md règle 5). Écrit contre
 * la base locale (architecture « local d'abord ») ; la synchro (Étape 10)
 * pousse ensuite ces lignes au serveur, sans code supplémentaire ici.
 */

export class ErreurProduit extends Error {}

function versEntier(valeur: boolean | number | undefined, defaut: number): number {
  if (valeur === undefined) return defaut;
  return typeof valeur === "boolean" ? (valeur ? 1 : 0) : valeur;
}

// --- Produits ---

export interface ProduitResume {
  id: string;
  nom: string;
  categorieNom: string | null;
  actif: number;
  prixVente: number | null;
  prixAchat: number | null;
  dateCreation: string;
  enStock: number;
}

export function listerProduits(boutiqueId: string, terme = ""): ProduitResume[] {
  const motif = `%${terme}%`;
  return tousLesResultats<ProduitResume>(
    `SELECT p.id as id, p.nom as nom, c.nom as categorieNom, p.actif as actif,
            v.prix_vente as prixVente, v.prix_achat as prixAchat, p.date_creation as dateCreation,
            CASE WHEN EXISTS (
              SELECT 1 FROM stocks s
              JOIN variantes v2 ON v2.id = s.variante_id
              WHERE v2.produit_id = p.id AND v2.supprime = 0 AND s.quantite > 0
            ) THEN 1 ELSE 0 END as enStock
     FROM produits p
     LEFT JOIN categories c ON c.id = p.categorie_id
     LEFT JOIN variantes v ON v.produit_id = p.id AND v.supprime = 0
     WHERE p.boutique_id = ? AND p.supprime = 0 AND p.nom LIKE ?
     GROUP BY p.id
     ORDER BY p.nom
     LIMIT 200`,
    [boutiqueId, motif],
  );
}

export interface VarianteDetail {
  id: string;
  reference: string;
  codeBarres: string;
  prixAchat: number;
  prixVente: number;
  seuilAlerte: number;
  actif: number;
  valeurs: string[];
}

export interface ProduitDetail {
  id: string;
  nom: string;
  categorieId: string | null;
  uniteId: string | null;
  description: string;
  actif: number;
  variantes: VarianteDetail[];
}

export function obtenirProduit(id: string): ProduitDetail | undefined {
  const produit = unResultat<Omit<ProduitDetail, "variantes">>(
    "SELECT id, nom, categorie_id as categorieId, unite_id as uniteId, description, actif FROM produits WHERE id = ? AND supprime = 0",
    [id],
  );
  if (!produit) return undefined;

  const variantesBrutes = tousLesResultats<Omit<VarianteDetail, "valeurs">>(
    `SELECT id, reference, code_barres as codeBarres, prix_achat as prixAchat, prix_vente as prixVente,
            seuil_alerte as seuilAlerte, actif
     FROM variantes WHERE produit_id = ? AND supprime = 0 ORDER BY date_creation`,
    [id],
  );

  const variantes = variantesBrutes.map((v) => ({
    ...v,
    valeurs: tousLesResultats<{ libelle: string }>(
      `SELECT a.nom || ': ' || va.valeur as libelle
       FROM variante_valeurs vv
       JOIN valeurs_attribut va ON va.id = vv.valeur_attribut_id
       JOIN attributs a ON a.id = va.attribut_id
       WHERE vv.variante_id = ? AND vv.supprime = 0`,
      [v.id],
    ).map((r) => r.libelle),
  }));

  return { ...produit, variantes };
}

export interface ParametresProduit {
  boutiqueId: string;
  nom: string;
  categorieId?: string | null;
  uniteId?: string | null;
  description?: string;
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
}

export function creerProduit(params: ParametresProduit): { produitId: string; varianteId: string } {
  const {
    boutiqueId,
    nom,
    categorieId = null,
    uniteId = null,
    description = "",
    reference = "",
    codeBarres = "",
    prixAchat = 0,
    prixVente = 0,
    seuilAlerte = 0,
  } = params;

  if (!nom.trim()) throw new ErreurProduit("Le nom du produit est requis.");

  const resultat = dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const produitId = randomUUID();
    executer(
      `INSERT INTO produits (id, boutique_id, nom, categorie_id, unite_id, description, actif, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [produitId, boutiqueId, nom, categorieId, uniteId, description, maintenant, maintenant],
    );

    const varianteId = randomUUID();
    executer(
      `INSERT INTO variantes
         (id, produit_id, reference, code_barres, prix_achat, prix_vente, seuil_alerte, actif, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [varianteId, produitId, reference, codeBarres, prixAchat, prixVente, seuilAlerte, maintenant, maintenant],
    );

    return { produitId, varianteId };
  });

  sauvegarder();
  return resultat;
}

export function modifierProduit(
  id: string,
  champs: Partial<{
    nom: string;
    categorieId: string | null;
    uniteId: string | null;
    description: string;
    actif: boolean;
  }>,
): void {
  const mapping: Record<string, string> = {
    nom: "nom",
    categorieId: "categorie_id",
    uniteId: "unite_id",
    description: "description",
    actif: "actif",
  };
  const colonnes: string[] = [];
  const valeurs: unknown[] = [];
  for (const [cle, valeur] of Object.entries(champs)) {
    if (valeur === undefined) continue;
    colonnes.push(`${mapping[cle]} = ?`);
    valeurs.push(typeof valeur === "boolean" ? (valeur ? 1 : 0) : valeur);
  }
  if (colonnes.length === 0) return;

  const maintenant = new Date().toISOString();
  colonnes.push("date_modification = ?", "synchronise = 0");
  valeurs.push(maintenant);
  executer(`UPDATE produits SET ${colonnes.join(", ")} WHERE id = ?`, [...valeurs, id]);
  sauvegarder();
}

export function supprimerProduit(id: string): void {
  const maintenant = new Date().toISOString();
  dansUneTransaction(() => {
    executer("UPDATE produits SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?", [
      maintenant,
      id,
    ]);
    executer(
      "UPDATE variantes SET supprime = 1, synchronise = 0, date_modification = ? WHERE produit_id = ? AND supprime = 0",
      [maintenant, id],
    );
  });
  sauvegarder();
}

// --- Variantes ---

function remplacerValeursVariante(varianteId: string, valeurAttributIds: string[], maintenant: string): void {
  // Soft delete des anciennes lignes : un DELETE SQL les ferait disparaître
  // localement sans jamais informer le serveur si elles étaient déjà
  // synchronisées (même raisonnement que tout le reste du client — Étape 10).
  executer(
    "UPDATE variante_valeurs SET supprime = 1, synchronise = 0, date_modification = ? WHERE variante_id = ? AND supprime = 0",
    [maintenant, varianteId],
  );
  for (const valeurAttributId of valeurAttributIds) {
    executer(
      `INSERT INTO variante_valeurs (id, variante_id, valeur_attribut_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), varianteId, valeurAttributId, maintenant, maintenant],
    );
  }
}

export interface ParametresVarianteEntree {
  produitId: string;
  reference?: string;
  codeBarres?: string;
  prixAchat?: number;
  prixVente?: number;
  seuilAlerte?: number;
  valeurAttributIds?: string[];
}

export function creerVariante(params: ParametresVarianteEntree): string {
  const {
    produitId,
    reference = "",
    codeBarres = "",
    prixAchat = 0,
    prixVente = 0,
    seuilAlerte = 0,
    valeurAttributIds = [],
  } = params;

  const varianteId = dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const id = randomUUID();
    executer(
      `INSERT INTO variantes
         (id, produit_id, reference, code_barres, prix_achat, prix_vente, seuil_alerte, actif, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, produitId, reference, codeBarres, prixAchat, prixVente, seuilAlerte, maintenant, maintenant],
    );
    remplacerValeursVariante(id, valeurAttributIds, maintenant);
    return id;
  });

  sauvegarder();
  return varianteId;
}

export function modifierVariante(
  id: string,
  champs: Partial<{
    reference: string;
    codeBarres: string;
    prixAchat: number;
    prixVente: number;
    seuilAlerte: number;
    actif: boolean;
    valeurAttributIds: string[];
  }>,
): void {
  const { valeurAttributIds, ...reste } = champs;
  const mapping: Record<string, string> = {
    reference: "reference",
    codeBarres: "code_barres",
    prixAchat: "prix_achat",
    prixVente: "prix_vente",
    seuilAlerte: "seuil_alerte",
    actif: "actif",
  };
  const colonnes: string[] = [];
  const valeurs: unknown[] = [];
  for (const [cle, valeur] of Object.entries(reste)) {
    if (valeur === undefined) continue;
    colonnes.push(`${mapping[cle]} = ?`);
    valeurs.push(versEntier(valeur as boolean | number, 0));
  }

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    if (colonnes.length > 0) {
      colonnes.push("date_modification = ?", "synchronise = 0");
      valeurs.push(maintenant);
      executer(`UPDATE variantes SET ${colonnes.join(", ")} WHERE id = ?`, [...valeurs, id]);
    }
    if (valeurAttributIds !== undefined) {
      remplacerValeursVariante(id, valeurAttributIds, maintenant);
    }
  });

  sauvegarder();
}

// --- Réglages catalogue : catégories, unités, attributs ---

export interface ReferenceNommee {
  id: string;
  nom: string;
}

function creerReferenceNommee(table: string, boutiqueId: string, colonnesSupp: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  const colonnes = ["id", "boutique_id", ...Object.keys(colonnesSupp), "date_creation", "date_modification"];
  const valeurs = [id, boutiqueId, ...Object.values(colonnesSupp), maintenant, maintenant];
  const placeholders = colonnes.map(() => "?").join(", ");
  executer(`INSERT INTO ${table} (${colonnes.join(", ")}) VALUES (${placeholders})`, valeurs);
  sauvegarder();
  return id;
}

function modifierReferenceNommee(table: string, id: string, champs: Record<string, string | undefined>): void {
  const entrees = Object.entries(champs).filter((entree): entree is [string, string] => entree[1] !== undefined);
  const colonnes = entrees.map(([c]) => c);
  if (colonnes.length === 0) return;
  const maintenant = new Date().toISOString();
  const valeurs = entrees.map(([, v]) => v);
  executer(
    `UPDATE ${table} SET ${colonnes.map((c) => `${c} = ?`).join(", ")}, date_modification = ?, synchronise = 0
     WHERE id = ?`,
    [...valeurs, maintenant, id],
  );
  sauvegarder();
}

function supprimerReferenceNommee(table: string, id: string): void {
  const maintenant = new Date().toISOString();
  executer(`UPDATE ${table} SET supprime = 1, synchronise = 0, date_modification = ? WHERE id = ?`, [
    maintenant,
    id,
  ]);
  sauvegarder();
}

export function listerCategories(boutiqueId: string): ReferenceNommee[] {
  return tousLesResultats<ReferenceNommee>(
    "SELECT id, nom FROM categories WHERE boutique_id = ? AND supprime = 0 ORDER BY nom",
    [boutiqueId],
  );
}

export function creerCategorie(boutiqueId: string, nom: string): string {
  return creerReferenceNommee("categories", boutiqueId, { nom });
}

export function modifierCategorie(id: string, nom: string): void {
  modifierReferenceNommee("categories", id, { nom });
}

export function supprimerCategorie(id: string): void {
  supprimerReferenceNommee("categories", id);
}

export interface UniteResume extends ReferenceNommee {
  abreviation: string;
}

export function listerUnites(boutiqueId: string): UniteResume[] {
  return tousLesResultats<UniteResume>(
    "SELECT id, nom, abreviation FROM unites WHERE boutique_id = ? AND supprime = 0 ORDER BY nom",
    [boutiqueId],
  );
}

export function creerUnite(boutiqueId: string, nom: string, abreviation = ""): string {
  return creerReferenceNommee("unites", boutiqueId, { nom, abreviation });
}

export function modifierUnite(id: string, champs: Partial<{ nom: string; abreviation: string }>): void {
  modifierReferenceNommee("unites", id, champs);
}

export function supprimerUnite(id: string): void {
  supprimerReferenceNommee("unites", id);
}

export function listerAttributs(boutiqueId: string): ReferenceNommee[] {
  return tousLesResultats<ReferenceNommee>(
    "SELECT id, nom FROM attributs WHERE boutique_id = ? AND supprime = 0 ORDER BY nom",
    [boutiqueId],
  );
}

export function creerAttribut(boutiqueId: string, nom: string): string {
  return creerReferenceNommee("attributs", boutiqueId, { nom });
}

export function modifierAttribut(id: string, nom: string): void {
  modifierReferenceNommee("attributs", id, { nom });
}

export function supprimerAttribut(id: string): void {
  supprimerReferenceNommee("attributs", id);
}

export interface ValeurAttributResume {
  id: string;
  valeur: string;
  attributId: string;
}

export function listerValeursAttribut(attributId: string): ValeurAttributResume[] {
  return tousLesResultats<ValeurAttributResume>(
    "SELECT id, valeur, attribut_id as attributId FROM valeurs_attribut WHERE attribut_id = ? AND supprime = 0 ORDER BY valeur",
    [attributId],
  );
}

export function creerValeurAttribut(attributId: string, valeur: string): string {
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    "INSERT INTO valeurs_attribut (id, attribut_id, valeur, date_creation, date_modification) VALUES (?, ?, ?, ?, ?)",
    [id, attributId, valeur, maintenant, maintenant],
  );
  sauvegarder();
  return id;
}
