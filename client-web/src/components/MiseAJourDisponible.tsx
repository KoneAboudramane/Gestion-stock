import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * iOS/Safari en mode PWA installée ne revérifie pas le service worker à
 * chaque ouverture comme le ferait un navigateur desktop : sans ce bandeau,
 * un utilisateur peut rester bloqué sur une ancienne version malgré un
 * déploiement réussi, sans aucun signe qu'une mise à jour existe. Le
 * bandeau ne s'affiche que quand un nouveau service worker est prêt
 * (needRefresh) ; le clic recharge et laisse ce nouveau service worker
 * prendre la main.
 */
export default function MiseAJourDisponible() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="bandeau-mise-a-jour">
      <span>Nouvelle version disponible.</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        Recharger
      </button>
    </div>
  );
}
