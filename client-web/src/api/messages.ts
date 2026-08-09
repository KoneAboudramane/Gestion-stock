import { listerDepots } from "./stock";
import { ErreurApi, apiFetch, executerEnSecurite, extraireMessageErreur, type ResultatEcriture } from "./transport";

/**
 * Messages sortants (rappel de crédit, ticket WhatsApp) — en ligne uniquement.
 * Note : contrairement à client-electron (qui génère un `ticket_whatsapp` en
 * local à chaque vente), une vente créée hors-ligne dans client-web n'a pas
 * d'équivalent qui écrit ce message — l'envoi du ticket au client reste
 * possible directement depuis la facture (bouton WhatsApp), seul le suivi/
 * historique ici ne verra pas ces tickets. Les rappels de crédit, eux,
 * fonctionnent pleinement (générés côté serveur, comme en Electron).
 */
export type TypeMessage = "rappel_credit" | "ticket_whatsapp";
export type CanalMessage = "sms" | "whatsapp" | "interne";
export type StatutMessage = "en_attente" | "envoyee" | "echouee";

export interface MessageResume {
  id: string;
  type: TypeMessage;
  depotId: string | null;
  depotNom: string | null;
  utilisateurId: string | null;
  canal: CanalMessage;
  destinataire: string;
  message: string;
  referenceType: string;
  referenceId: string | null;
  statut: StatutMessage;
  dateEnvoi: string | null;
  dateCreation: string;
}

interface MessageBrute {
  id: string;
  type: TypeMessage;
  depot: string | null;
  utilisateur: string | null;
  canal: CanalMessage;
  destinataire: string;
  message: string;
  reference_type: string;
  reference_id: string | null;
  statut: StatutMessage;
  date_envoi: string | null;
  date_creation: string;
}

async function indexDepots(): Promise<Map<string, string>> {
  const resultat = await listerDepots();
  if (!resultat.succes) return new Map();
  return new Map(resultat.resultat.map((d) => [d.id, d.nom]));
}

export interface FiltresMessages {
  depotId?: string;
  utilisateurId?: string;
}

export function listerMessages(filtres: FiltresMessages = {}): Promise<ResultatEcriture<MessageResume[]>> {
  return executerEnSecurite(async () => {
    const [reponse, depots] = await Promise.all([apiFetch("/messages/"), indexDepots()]);
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const brutes: MessageBrute[] = await reponse.json();
    let resumes = brutes.map((b) => ({
      id: b.id,
      type: b.type,
      depotId: b.depot,
      depotNom: b.depot ? (depots.get(b.depot) ?? null) : null,
      utilisateurId: b.utilisateur,
      canal: b.canal,
      destinataire: b.destinataire,
      message: b.message,
      referenceType: b.reference_type,
      referenceId: b.reference_id,
      statut: b.statut,
      dateEnvoi: b.date_envoi,
      dateCreation: b.date_creation,
    }));
    if (filtres.depotId) resumes = resumes.filter((m) => m.depotId === filtres.depotId);
    if (filtres.utilisateurId) resumes = resumes.filter((m) => m.utilisateurId === filtres.utilisateurId);
    return resumes.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
  });
}

// Verrou au niveau du module : même pattern que notifications.ts (React
// StrictMode double-invoque les effets en dev, ce qui peut créer des rappels
// en double malgré la fenêtre anti-doublon côté serveur).
let generationEnCours: Promise<ResultatEcriture<void>> | null = null;

export function genererRappelsCredit(): Promise<ResultatEcriture<void>> {
  if (generationEnCours) return generationEnCours;
  generationEnCours = (async () => {
    try {
      return await executerEnSecurite(async () => {
        const reponse = await apiFetch("/messages/generer-rappels-credit/", { method: "POST" });
        if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
      });
    } finally {
      generationEnCours = null;
    }
  })();
  return generationEnCours;
}

export function envoyerMessage(id: string): Promise<ResultatEcriture<void>> {
  return executerEnSecurite(async () => {
    const reponse = await apiFetch(`/messages/${id}/envoyer/`, { method: "POST" });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  });
}
