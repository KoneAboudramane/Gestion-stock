import { registerPlugin } from "@capacitor/core";

import { estAppliMobile } from "./appliAndroid";

/**
 * Impression et fichiers, partout pareil (docs/plan_mobile_complet.md, lot 1, §4.5).
 * Dans le navigateur : window.print() et lien de téléchargement, comme avant.
 * Dans l'appli Android, où la vue web ignore les deux : module natif OutilsAppli
 * (android/…/OutilsAppliPlugin.java) — service d'impression d'Android (qui propose
 * « Enregistrer en PDF ») et feuille de partage (WhatsApp, Drive, e-mail…).
 */

interface OutilsAppli {
  imprimer(options: { nom: string }): Promise<void>;
  imprimerHtml(options: { html: string; nom: string }): Promise<void>;
  partagerFichier(options: { donnees: string; nom: string; type: string }): Promise<void>;
  etatBatterie(): Promise<{ sansRestriction: boolean }>;
  ouvrirReglagesBatterie(): Promise<void>;
}

const OutilsAppli = registerPlugin<OutilsAppli>("OutilsAppli");

/**
 * Imprime l'écran affiché (ses styles d'impression : ticket, facture, reçu, affiche…).
 * `classePage` : classe posée sur <body> le temps de l'impression (ex.
 * « impression-fiche ») — dans l'appli, gardée jusqu'à la fermeture de la
 * fenêtre d'impression, car Android met la page en forme pendant qu'elle est ouverte.
 */
export async function imprimer(nom = "Document", classePage?: string): Promise<void> {
  if (classePage) document.body.classList.add(classePage);
  try {
    if (estAppliMobile) await OutilsAppli.imprimer({ nom });
    else window.print();
  } catch (e) {
    alerterEchec(e);
  } finally {
    if (classePage) document.body.classList.remove(classePage);
  }
}

/** Imprime une page HTML complète (export PDF d'un tableau). */
export async function imprimerHtml(html: string, nom: string): Promise<void> {
  if (estAppliMobile) {
    await OutilsAppli.imprimerHtml({ html, nom });
    return;
  }
  const fenetre = window.open("", "_blank");
  if (!fenetre) throw new Error("Autorisez les fenêtres pop-up pour exporter en PDF.");
  fenetre.document.write(html);
  fenetre.document.close();
  fenetre.focus();
  fenetre.print();
}

function enBase64(contenu: Blob): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => rejeter(new Error("Fichier illisible."));
    // « data:…;base64,XXXX » → XXXX
    lecteur.onload = () => resoudre(String(lecteur.result).split(",", 2)[1] ?? "");
    lecteur.readAsDataURL(contenu);
  });
}

/** Enregistre un fichier : téléchargement dans le navigateur, partage dans l'appli. */
export async function enregistrerFichier(contenu: Blob, nom: string): Promise<void> {
  if (estAppliMobile) {
    await OutilsAppli.partagerFichier({
      donnees: await enBase64(contenu),
      nom,
      type: contenu.type || "application/octet-stream",
    });
    return;
  }
  const url = URL.createObjectURL(contenu);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Appli exemptée de l'économie de batterie (poste principal) ? null hors appli. */
export async function batterieSansRestriction(): Promise<boolean | null> {
  if (!estAppliMobile) return null;
  try {
    return (await OutilsAppli.etatBatterie()).sansRestriction;
  } catch {
    return null;
  }
}

/** Ouvre le réglage d'Android « Optimisation de la batterie » (choisir « Sans restriction » pour Gestion Stock). */
export function ouvrirReglagesBatterie(): void {
  if (estAppliMobile) void OutilsAppli.ouvrirReglagesBatterie().catch(() => {});
}

function alerterEchec(e: unknown): void {
  // Pas d'alert() (bloquant) : la console suffit, l'utilisateur voit que rien ne s'ouvre.
  console.error(e instanceof Error ? e.message : e);
}
