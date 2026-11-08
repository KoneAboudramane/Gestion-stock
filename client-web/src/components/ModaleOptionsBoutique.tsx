import { useEffect, useState } from "react";

import { BASE_URL } from "../api/transport";
import { etatSauvegarde } from "../services/sauvegarde";
import { etatSynchro } from "../sync";
import {
  detailAbonnementAdmin,
  lireAbonnementEnAttente,
  obtenirBoutiqueInstallee,
  soumettreAbonnement,
  type AbonnementBoutique,
  type AbonnementDetailAdmin,
  type ChampsAbonnement,
} from "../services/abonnementAdmin";
import CarteOption from "./CarteOption";

// Espace Admin → « 🌐 Envoi en ligne » (voir le commentaire du composant plus bas).
// Copie conforme bureau / web : seul `appels` diffère.

/** Accès aux données (seule partie qui diffère entre le bureau et le web). */
const appels = {
  boutique: (): Promise<AbonnementBoutique | null> => obtenirBoutiqueInstallee(),
  detail: async (username: string, password: string, boutiqueId: string): Promise<AbonnementDetailAdmin | null> => {
    const r = await detailAbonnementAdmin(username, password, boutiqueId);
    return r.succes ? r.resultat : null;
  },
  enAttente: async (): Promise<boolean> => !!lireAbonnementEnAttente(),
  soumettre: async (
    username: string,
    password: string,
    boutiqueId: string,
    boutiqueNom: string,
    champs: ChampsAbonnement,
  ): Promise<"synchronise" | "horsLigne"> => (await soumettreAbonnement(username, password, boutiqueId, boutiqueNom, champs)).statut,
  infos: async () => {
    const sauvegarde = await etatSauvegarde().catch(() => null);
    const base = new URL(BASE_URL, window.location.origin).href.replace(/\/api\/?$/, "");
    return { derniereSynchro: etatSynchro().derniereSynchro, sauvegarde, urlApk: `${base}/telecharger/android/` };
  },
};

interface Infos {
  derniereSynchro: string | null;
  sauvegarde: { configuree: boolean; derniereSauvegarde: string | null } | null;
  urlApk: string;
}

function dateHeure(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";
}

function dateCourte(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "";
}

type EtatOptions = NonNullable<AbonnementDetailAdmin["options"]>;

function libelleOption(o: EtatOptions[string]): string {
  switch (o.source) {
    case "pro":
      return "✅ comprise dans Pro";
    case "suit":
      return "✅ liée à l'abonnement";
    case "payee":
      return `✅ prise jusqu'au ${dateCourte(o.fin)}`;
    case "exception":
      return "✅ accordée sans paiement";
    default:
      return "🔒 non prise";
  }
}

/**
 * Espace Admin → « 🌐 Envoi en ligne » : allumer ou couper l'envoi des données de la
 * boutique vers le serveur. Il faut le droit à l'option En ligne (Pro, payée, liée
 * à l'abonnement ou accordée sans paiement) : les options se prennent dans
 * « 💳 Abonnement → 🧩 Options ». Même en Pro, l'envoi reste éteint tant qu'on ne
 * l'allume pas (certains commerçants refusent le cloud).
 */
export default function ModaleOptionsBoutique({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [boutique, setBoutique] = useState<AbonnementBoutique | null | undefined>(undefined);
  const [options, setOptions] = useState<EtatOptions | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [enAttente, setEnAttente] = useState(false);
  const [infos, setInfos] = useState<Infos | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function charger() {
    const b = await appels.boutique();
    setBoutique(b);
    appels.infos().then(setInfos).catch(() => {});
    if (!b) return;
    const detail = await appels.detail(username, password, b.boutiqueId).catch(() => null);
    const attente = await appels.enAttente();
    setHorsLigne(!detail);
    setEnAttente(attente);
    setOptions(detail?.options ?? null);
    // Réglé ailleurs (site admin, autre poste) : ce poste s'aligne, sauf modification en attente d'envoi.
    if (!detail || attente || detail.boutique.synchro_autorisee === b.synchroAutorisee) return;
    try {
      await appels.soumettre(username, password, b.boutiqueId, b.boutiqueNom, { synchroAutorisee: detail.boutique.synchro_autorisee });
      setBoutique(await appels.boutique());
    } catch {
      // l'affichage garde l'état du poste
    }
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function basculer(valeur: boolean) {
    if (!boutique) return;
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      const statut = await appels.soumettre(username, password, boutique.boutiqueId, boutique.boutiqueNom, { synchroAutorisee: valeur });
      const texte = valeur ? "Envoi en ligne allumé" : "Boutique passée en 100 % local";
      setMessage(
        statut === "synchronise"
          ? `✅ ${texte} (sur ce poste et sur le serveur).`
          : `✅ ${texte} sur ce poste. Pas de connexion : le serveur sera prévenu au retour d'internet (Réglages → Synchronisation).`,
      );
      setEnAttente(statut !== "synchronise");
      setBoutique(await appels.boutique());
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Échec de la modification.");
    } finally {
      setEnCours(false);
    }
  }

  // Sans connexion, on ne sait pas : on laisse faire (le serveur revérifie à l'envoi).
  const droitEnLigne = options ? options.en_ligne?.droit ?? false : true;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>🌐 Envoi en ligne{boutique ? ` — ${boutique.boutiqueNom}` : ""}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps contenu-reseau">
          {boutique === undefined || boutique === null ? (
            <p className="sous-titre">{boutique === undefined ? "Chargement…" : "Aucune boutique n'est encore installée sur ce poste."}</p>
          ) : (
            <>
              {erreur && <div className="message-erreur">{erreur}</div>}
              {message && <div className="message-succes">{message}</div>}
              <div className={`prochaine-etape prochaine-etape--${horsLigne ? "neutre" : enAttente ? "attention" : "ok"}`}>
                <div>
                  <span className="libelle-prochaine-etape">Serveur et poste</span>
                  <p>
                    {horsLigne
                      ? "🌐 Sans connexion au serveur : un changement s'applique sur ce poste et part au serveur au retour d'internet."
                      : enAttente
                        ? "⏳ Une modification faite sans internet attend d'être envoyée au serveur (Réglages → Synchronisation)."
                        : "✅ Le serveur et ce poste sont d'accord."}
                  </p>
                </div>
                {horsLigne && (
                  <button type="button" disabled={enCours} onClick={() => charger()}>
                    ⟳ Réessayer
                  </button>
                )}
              </div>
              <CarteOption
                icone="🌐"
                titre="Envoi des données en ligne"
                actif={boutique.synchroAutorisee}
                libelleOui="Allumé"
                libelleNon="100 % local"
                detail={
                  !droitEnLigne && !boutique.synchroAutorisee
                    ? "🔒 L'option En ligne n'est pas prise : prenez-la ou offrez-la dans « 💳 Abonnement → 🧩 Options » avant de l'allumer."
                    : boutique.synchroAutorisee
                      ? "Les ventes, le stock et les fiches de la boutique sont envoyés au serveur : sauvegarde en ligne, appli web et mobile à jour."
                      : "Tout reste sur les appareils de la boutique ; seuls le nom et l'abonnement sont en ligne."
                }
                confirmation={(v) =>
                  v
                    ? `Allumer l'envoi en ligne pour « ${boutique.boutiqueNom} » ? Ses ventes, son stock et ses fiches seront envoyés au serveur.`
                    : `Passer « ${boutique.boutiqueNom} » en 100 % local ? Les données restent sur ses appareils ; pensez à la sauvegarde.`
                }
                enCours={enCours || (!droitEnLigne && !boutique.synchroAutorisee)}
                onBasculer={basculer}
              />
              <dl className="infos-option-admin">
                <dt>Dernière synchronisation de ce poste</dt>
                <dd>{boutique.synchroAutorisee ? dateHeure(infos?.derniereSynchro) : "— (100 % local)"}</dd>
                <dt>Dernière sauvegarde</dt>
                <dd>{infos?.sauvegarde?.configuree ? dateHeure(infos.sauvegarde.derniereSauvegarde) : "non paramétrée"}</dd>
              </dl>
              {!boutique.synchroAutorisee && !infos?.sauvegarde?.configuree && (
                <p className="message-erreur">
                  ⚠️ 100 % local et sans sauvegarde : si l'appareil tombe en panne, les données sont perdues. Paramétrez la
                  sauvegarde (carte 💾 Sauvegarde).
                </p>
              )}
              {options && (
                <section className="carte-profil">
                  <h4>🧩 Options de la boutique</h4>
                  <ul className="liste-options-abonnement">
                    {(["en_ligne", "reseau", "mobile"] as const)
                      .filter((cle) => options[cle])
                      .map((cle) => (
                        <li key={cle} className={options[cle].droit ? "option-prise" : "option-non-prise"}>
                          <strong>{options[cle].libelle}</strong>
                          <span>{libelleOption(options[cle])}</span>
                        </li>
                      ))}
                  </ul>
                  <p className="note-aide">Prendre, offrir ou retirer une option : « 💳 Abonnement → 🧩 Options ».</p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
