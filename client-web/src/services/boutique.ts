import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, maintenant, obtenirLigne } from "../db/helpers";
import type { BoutiqueLocale } from "../db/schema";
import { dateDuJourSure, essaiEnCours, formuleEffective } from "./abonnement";

/**
 * Port navigateur de client-electron/electron/services/reglages.ts (profil
 * boutique uniquement — comptes.Boutique est un ModeleBase déjà synchronisé,
 * traitement 100% local comme le reste du client). Le logo (ImageField,
 * upload multipart, local uniquement côté Electron) n'est pas géré ici,
 * comme documenté dans Reglages.tsx : hors périmètre.
 */

export class ErreurBoutique extends Error {}

/** Lecture locale (IndexedDB) brute des infos boutique — utilisé par FactureVente.tsx. */
export async function obtenirBoutiqueLocale(boutiqueId: string): Promise<BoutiqueLocale | undefined> {
  const db = await ouvrirBaseDeDonnees();
  return db.get("boutiques", boutiqueId);
}

export interface BoutiqueDetail {
  id: string;
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
  /** Abonnement (formule Essentiel/Pro et échéance), affiché dans Informations boutique. */
  formule: string;
  dateExpirationAbonnement: string | null;
  /** Fin de l'essai gratuit en cours (`formule` est alors celle de l'essai), sinon null. */
  essaiFin: string | null;
  /** Carte « 📱 Appli mobile » de Réglages, activée par l'administrateur. */
  appliMobileAutorisee: boolean;
}

export async function obtenirBoutique(boutiqueId: string): Promise<BoutiqueDetail | undefined> {
  const boutique = await obtenirLigne("boutiques", boutiqueId);
  if (!boutique) return undefined;
  return {
    id: boutique.id,
    nom: boutique.nom,
    adresse: boutique.adresse,
    telephone: boutique.telephone,
    email: boutique.email,
    devise: boutique.devise,
    formule: formuleEffective(boutique, dateDuJourSure()),
    dateExpirationAbonnement: boutique.date_expiration_abonnement ?? null,
    essaiFin: boutique.essai_formule && essaiEnCours(boutique.essai_fin, dateDuJourSure()) ? boutique.essai_fin ?? null : null,
    appliMobileAutorisee: boutique.appli_mobile_autorisee === 1,
  };
}

export async function modifierBoutique(
  id: string,
  champs: Partial<{ nom: string; adresse: string; telephone: string; email: string; devise: string }>,
): Promise<void> {
  const boutique = await obtenirLigne("boutiques", id);
  if (!boutique) throw new ErreurBoutique("Boutique introuvable.");
  await ecrireLigne("boutiques", {
    ...boutique,
    nom: champs.nom ?? boutique.nom,
    adresse: champs.adresse ?? boutique.adresse,
    telephone: champs.telephone ?? boutique.telephone,
    email: champs.email ?? boutique.email,
    devise: champs.devise ?? boutique.devise,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

// --- Logo de la boutique ---
// Comme au bureau (table locale boutique_logo) : gardé sur l'appareil seulement,
// jamais synchronisé (les images ne passent pas par la synchro).

const PREFIXE_CLE_LOGO = "gestion-stock:logo:";
/** Côté le plus long du logo enregistré : assez pour un ticket A4, léger pour le stockage du navigateur. */
const TAILLE_MAX_LOGO = 400;

export function obtenirLogoBoutique(boutiqueId: string): string {
  return localStorage.getItem(PREFIXE_CLE_LOGO + boutiqueId) ?? "";
}

export function definirLogoBoutique(boutiqueId: string, logo: string): void {
  if (logo) localStorage.setItem(PREFIXE_CLE_LOGO + boutiqueId, logo);
  else localStorage.removeItem(PREFIXE_CLE_LOGO + boutiqueId);
}

/**
 * Image choisie → image réduite (TAILLE_MAX_LOGO px au plus), en PNG pour garder
 * la transparence. Une photo de téléphone (plusieurs Mo) ne tiendrait pas dans
 * le stockage du navigateur.
 */
export function preparerLogo(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => rejeter(new ErreurBoutique("Image illisible."));
    lecteur.onload = () => {
      const image = new Image();
      image.onerror = () => rejeter(new ErreurBoutique("Ce fichier n'est pas une image."));
      image.onload = () => {
        const echelle = Math.min(1, TAILLE_MAX_LOGO / Math.max(image.width, image.height));
        const toile = document.createElement("canvas");
        toile.width = Math.max(1, Math.round(image.width * echelle));
        toile.height = Math.max(1, Math.round(image.height * echelle));
        toile.getContext("2d")?.drawImage(image, 0, 0, toile.width, toile.height);
        resoudre(toile.toDataURL("image/png"));
      };
      image.src = String(lecteur.result);
    };
    lecteur.readAsDataURL(fichier);
  });
}
