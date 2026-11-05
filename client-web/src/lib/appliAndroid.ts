import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/** Vrai dans l'appli Android/iOS (Capacitor), faux dans le navigateur. */
export const estAppliMobile = Capacitor.isNativePlatform();

/**
 * Bouton « retour » d'Android, dans l'ordre naturel :
 * 1. une fenêtre (modale) est ouverte → on la ferme, comme un clic sur son fond grisé ;
 * 2. sinon on revient à la page précédente (Shell.tsx navigue avec l'historique) ;
 * 3. sinon (page d'accueil) l'appli passe en arrière-plan, sans se fermer ni perdre la caisse en cours.
 */
export function activerBoutonRetourAndroid(): void {
  if (!estAppliMobile) return;
  void App.addListener("backButton", ({ canGoBack }) => {
    const fonds = document.querySelectorAll<HTMLElement>(".fond-modale");
    const dernier = fonds[fonds.length - 1];
    if (dernier) {
      // Les modales se ferment sur un clic dont la cible est le fond lui-même.
      dernier.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return;
    }
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
}
