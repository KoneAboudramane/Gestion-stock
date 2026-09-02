/**
 * `VITE_DEV_SERVER_URL` est injecté automatiquement par vite-plugin-electron
 * en mode `npm run dev` (absent dans un build packagé) : sert de signal
 * dev/prod pour cibler le backend local par défaut en développement, sans
 * devoir positionner GESTION_STOCK_API_URL à la main à chaque lancement.
 */
export const URL_BASE_API =
  process.env.GESTION_STOCK_API_URL ??
  (process.env.VITE_DEV_SERVER_URL
    ? "http://localhost:8000/api"
    : "http://gestion.stock.sc3trsi4875.universe.wf/api");
