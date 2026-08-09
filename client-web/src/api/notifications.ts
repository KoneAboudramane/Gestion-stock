import { listerDepots } from "./stock";
import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Alertes système internes (rupture de stock) — en ligne uniquement, comme les
 * autres pages back-office (voir Produits.tsx/Clients.tsx). Pas de "marquer
 * comme lue" : le modèle Notification côté serveur n'a pas de champ de lecture
 * (c'est un concept propre à la cloche de l'Electron, absent ici puisque
 * client-web n'a pas de cloche de notifications dans son en-tête).
 */
export interface NotificationResume {
  id: string;
  type: string;
  depotId: string | null;
  depotNom: string | null;
  message: string;
  referenceType: string;
  referenceId: string | null;
  dateCreation: string;
}

interface NotificationBrute {
  id: string;
  type: string;
  depot: string | null;
  message: string;
  reference_type: string;
  reference_id: string | null;
  date_creation: string;
}

async function indexDepots(): Promise<Map<string, string>> {
  const resultat = await listerDepots();
  if (!resultat.succes) return new Map();
  return new Map(resultat.resultat.map((d) => [d.id, d.nom]));
}

export function listerNotifications(depotId?: string): Promise<ResultatEcriture<NotificationResume[]>> {
  return executerEnSecurite(async () => {
    const [reponse, depots] = await Promise.all([apiFetch("/notifications/"), indexDepots()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: NotificationBrute[] = await reponse.json();
    let resumes = brutes.map((b) => ({
      id: b.id,
      type: b.type,
      depotId: b.depot,
      depotNom: b.depot ? (depots.get(b.depot) ?? null) : null,
      message: b.message,
      referenceType: b.reference_type,
      referenceId: b.reference_id,
      dateCreation: b.date_creation,
    }));
    if (depotId) resumes = resumes.filter((n) => n.depotId === depotId);
    return resumes.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
  });
}

// Verrou au niveau du module : React StrictMode double-invoque les effets en
// dev, et deux appels concurrents peuvent tous les deux passer la fenêtre
// anti-doublon côté serveur (vérification puis écriture, non atomique) avant
// que l'un des deux n'ait eu le temps d'écrire — même pattern que sync/index.ts.
let generationEnCours: Promise<ResultatEcriture<void>> | null = null;

export function genererAlertesRupture(): Promise<ResultatEcriture<void>> {
  if (generationEnCours) return generationEnCours;
  generationEnCours = (async () => {
    try {
      return await executerEnSecurite(async () => {
        const reponse = await apiFetch("/notifications/generer-alertes-rupture/", { method: "POST" });
        if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
      });
    } finally {
      generationEnCours = null;
    }
  })();
  return generationEnCours;
}
