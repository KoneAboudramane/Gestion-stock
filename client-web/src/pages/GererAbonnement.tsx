import { useEffect, useState } from "react";

import {
  obtenirBoutiqueInstallee,
  soumettreAbonnement,
  type AbonnementBoutique,
  type ChampsAbonnement,
} from "../services/abonnementAdmin";

const LIBELLES_FORMULE: Record<string, string> = {
  essentiel: "Essentiel",
  pro: "Pro",
};

// Ce que chaque formule inclut, en entier (voir comptes/views.py::UtilisateurViewSet,
// stock/views.py::DepotViewSet, comptabilite/views.py::_RapportComptableView
// pour les limites réellement appliquées côté serveur ; le reste — synchro,
// thème, format ticket... — est disponible pour les deux, sans distinction).
const FONCTIONNALITES_FORMULE: Record<string, string[]> = {
  essentiel: [
    "Catalogue, stock, ventes, clients, achats, fournisseurs",
    "1 dépôt",
    "Patron + 1 utilisateur",
    "Rapports de base (CA, bénéfices, top produits)",
    "Comptabilité : aperçu local uniquement",
    "Synchronisation cloud activable sur demande",
  ],
  pro: [
    "Tout Essentiel, plus :",
    "Dépôts illimités + transferts de stock entre dépôts",
    "Utilisateurs illimités",
    "Comptabilité : livre officiel SYSCOHADA (Journal, Grand livre, Balance, Bilan)",
    "Rapports avancés et export",
  ],
};

function formaterDateExpiration(iso: string | null): string {
  if (!iso) return "Illimité";
  return new Date(iso).toLocaleDateString("fr-FR");
}

/**
 * Port navigateur de client-electron/src/pages/GererAbonnement.tsx. Carte
 * "Gérer abonnement" de l'Espace Admin (voir AccesCreationBoutique.tsx) :
 * agit sur la boutique déjà installée sur ce poste. Même patron vue/édition
 * que Réglages > Informations boutique : on affiche d'abord l'état actuel,
 * "Modifier" bascule sur le formulaire — pensé pour le cas où l'exploitant
 * est chez le commerçant sans internet, la modification s'applique toujours
 * en local immédiatement, et se synchronise avec le serveur dès que possible
 * (tout de suite si le réseau répond, sinon voir Réglages > Synchronisation
 * pour la pousser plus tard). Réutilise les identifiants déjà saisis pour
 * franchir le verrou admin — jamais redemandés ici.
 *
 * `masquerSynchro` : utilisé juste après une création hors-ligne (voir
 * Inscription.tsx) — "Données en ligne" n'a aucun effet tant que la boutique
 * n'a pas été "activée en ligne" (elle n'existe pas encore côté serveur),
 * donc pas de sens de le proposer à ce moment-là. `demarrerEnEdition` évite
 * un clic "Modifier" superflu dans ce même contexte.
 */
export default function GererAbonnement({
  onFermer,
  username,
  password,
  masquerSynchro = false,
  demarrerEnEdition = false,
}: {
  onFermer: () => void;
  username: string;
  password: string;
  masquerSynchro?: boolean;
  demarrerEnEdition?: boolean;
}) {
  const [boutique, setBoutique] = useState<AbonnementBoutique | null | undefined>(undefined);
  const [modeEdition, setModeEdition] = useState(demarrerEnEdition);
  const [formule, setFormule] = useState("essentiel");
  const [illimite, setIllimite] = useState(true);
  const [dateExpiration, setDateExpiration] = useState("");
  const [synchroAutorisee, setSynchroAutorisee] = useState(false);
  const [nature, setNature] = useState<"paiement" | "offert" | "ajustement">("paiement");
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    obtenirBoutiqueInstallee().then((b) => {
      setBoutique(b);
      if (b && demarrerEnEdition) {
        setFormule(b.formule);
        setIllimite(!b.dateExpirationAbonnement);
        setDateExpiration(b.dateExpirationAbonnement ? b.dateExpirationAbonnement.slice(0, 10) : "");
        setSynchroAutorisee(b.synchroAutorisee);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function demarrerEdition() {
    if (!boutique) return;
    setFormule(boutique.formule);
    setIllimite(!boutique.dateExpirationAbonnement);
    setDateExpiration(boutique.dateExpirationAbonnement ? boutique.dateExpirationAbonnement.slice(0, 10) : "");
    setSynchroAutorisee(boutique.synchroAutorisee);
    setNature("paiement");
    setMontant("");
    setMode("");
    setReference("");
    setErreur(null);
    setModeEdition(true);
  }

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!boutique) return;
    setErreur(null);
    setEnCours(true);
    try {
      const nouvelleDate = illimite || !dateExpiration ? null : new Date(`${dateExpiration}T23:59:59`).toISOString();
      // La période change : elle est inscrite au registre, avec le paiement reçu.
      const periodeModifiee =
        formule !== boutique.formule ||
        (nouvelleDate?.slice(0, 10) ?? null) !== (boutique.dateExpirationAbonnement?.slice(0, 10) ?? null);
      if (periodeModifiee && nature === "paiement" && !(Number(montant) > 0)) {
        setErreur("Indiquez le montant reçu, ou choisissez « Offert » ou « Correction de date ».");
        return;
      }
      const champs: ChampsAbonnement = {
        formule,
        dateExpirationAbonnement: nouvelleDate,
        ...(masquerSynchro ? {} : { synchroAutorisee }),
        ...(periodeModifiee
          ? { nature, ...(nature === "paiement" ? { montant: Number(montant), mode, reference: reference.trim() } : {}) }
          : {}),
      };
      const resultat = await soumettreAbonnement(username, password, boutique.boutiqueId, boutique.boutiqueNom, champs);
      setBoutique({
        ...boutique,
        formule: champs.formule!,
        dateExpirationAbonnement: champs.dateExpirationAbonnement ?? null,
        synchroAutorisee: champs.synchroAutorisee ?? boutique.synchroAutorisee,
      });
      setMessage(
        resultat.statut === "synchronise"
          ? "Abonnement mis à jour et synchronisé avec le serveur."
          : "Pas de connexion : la modification s'applique déjà sur ce poste, elle sera transmise au serveur depuis Réglages > Synchronisation dès que la connexion reviendra.",
      );
      setModeEdition(false);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  }

  if (boutique === undefined || boutique === null) {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <div className="modale-entete">
            <h3>Gérer abonnement 💳</h3>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            <p className="sous-titre">
              {boutique === undefined ? "Chargement…" : "Aucune boutique n'est encore installée sur ce poste."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!modeEdition) {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <div className="modale-entete entete-fixe">
            <h3>Gérer abonnement 💳</h3>
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" onClick={demarrerEdition}>
                Modifier
              </button>
              <button type="button" className="lien bouton-retour" onClick={onFermer}>
                ← Retour
              </button>
            </div>
          </div>
          <div className="modale-corps">
            <div className="formulaire-catalogue formulaire-pleine-largeur-modale">
              {message && <p className="note-aide">{message}</p>}
              <p className="sous-titre">{boutique.boutiqueNom}</p>
              <div className="grille-champs">
                <div>
                  <p className="note-aide">Formule</p>
                  <p>{LIBELLES_FORMULE[boutique.formule] ?? boutique.formule}</p>
                </div>
                <div>
                  <p className="note-aide">Expiration de l'abonnement</p>
                  <p>{formaterDateExpiration(boutique.dateExpirationAbonnement)}</p>
                </div>
                {!masquerSynchro && (
                  <div>
                    <p className="note-aide">Données en ligne</p>
                    <p>{boutique.synchroAutorisee ? "Activée" : "Désactivée"}</p>
                  </div>
                )}
              </div>
              <div className="grille-champs">
                {(["essentiel", "pro"] as const).map((cle) => (
                  <div key={cle}>
                    <p className="note-aide">{LIBELLES_FORMULE[cle]}</p>
                    <ul className="liste-fonctionnalites-formule">
                      {FONCTIONNALITES_FORMULE[cle].map((ligne) => (
                        <li key={ligne}>{ligne}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete entete-fixe">
          <h3>Gérer abonnement 💳</h3>
          <div className="actions-formulaire">
            <button type="button" onClick={() => setModeEdition(false)}>
              Annuler
            </button>
            <button type="submit" form="form-abonnement" className="bouton-primaire" disabled={enCours}>
              {enCours ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
        </div>
        <div className="modale-corps">
          <form id="form-abonnement" onSubmit={soumettre} className="formulaire-catalogue formulaire-pleine-largeur-modale">
            <p className="sous-titre">{boutique.boutiqueNom}</p>
            {erreur && <div className="message-erreur">{erreur}</div>}
            <label>
              Formule
              <select value={formule} onChange={(e) => setFormule(e.target.value)}>
                <option value="essentiel">Essentiel</option>
                <option value="pro">Pro</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={illimite} onChange={(e) => setIllimite(e.target.checked)} />{" "}
              Abonnement illimité (pas de date d'expiration)
            </label>
            {!illimite && (
              <label>
                Date d'expiration de l'abonnement
                <input
                  type="date"
                  value={dateExpiration}
                  onChange={(e) => setDateExpiration(e.target.value)}
                  required
                />
              </label>
            )}
            <fieldset className="paiement-abonnement">
              <legend>Inscrit au registre des abonnements si la formule ou la date change</legend>
              <label>
                Nature
                <select value={nature} onChange={(e) => setNature(e.target.value as typeof nature)}>
                  <option value="paiement">Paiement reçu</option>
                  <option value="offert">Offert (geste commercial)</option>
                  <option value="ajustement">Correction de date</option>
                </select>
              </label>
              {nature === "paiement" && (
                <>
                  <label>
                    Montant reçu
                    <input type="number" min={0} step="any" value={montant} onChange={(e) => setMontant(e.target.value)} />
                  </label>
                  <label>
                    Payé par
                    <select value={mode} onChange={(e) => setMode(e.target.value)}>
                      <option value="">—</option>
                      <option value="wave">Wave</option>
                      <option value="orange_money">Orange Money</option>
                      <option value="mtn">MTN Mobile Money</option>
                      <option value="moov">Moov Money</option>
                      <option value="especes">Espèces</option>
                      <option value="banque">Banque</option>
                      <option value="autre">Autre</option>
                    </select>
                  </label>
                  <label>
                    Référence de la transaction
                    <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex. MP2410…" />
                  </label>
                </>
              )}
            </fieldset>
            {!masquerSynchro && (
              <label>
                <input
                  type="checkbox"
                  checked={synchroAutorisee}
                  onChange={(e) => setSynchroAutorisee(e.target.checked)}
                />{" "}
                Données en ligne (synchronisation activée)
              </label>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
