import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant, normaliserTelephone, telephoneValide } from "../lib/formatage";
import { MODES_REGLEMENT, libelleStatutVente } from "../lib/libelles";
import {
  creerClient,
  ErreurClient,
  listerClientsDetail,
  listerCredits,
  modifierClient,
  obtenirClient,
  obtenirCredit,
  rembourserCredit,
  supprimerClient,
  type ClientDetailResume as ClientResume,
  type CreditDetail,
  type CreditResume,
  type StatutCredit,
} from "../services/clients";
import { listerDepotsDetail, type DepotResume } from "../services/stock";
import { listerVentesLocales, type VenteResumeLocale as VenteResume } from "../services/ventes";
import { DetailVente } from "./Ventes";

/**
 * Port de client-electron/src/pages/Clients.tsx : gestion des clients et du
 * carnet de crédit, local d'abord (IndexedDB, voir services/clients.ts),
 * comme le reste de l'application.
 *
 * Édition des infos client depuis le détail d'un crédit (2026-08-22, parité
 * Electron) : DetailCredit peut être atteint directement depuis le carnet
 * global (OngletCredits), sans passer par la fiche client — il a donc besoin
 * de son propre bloc "Informations" éditable (enregistrerInfosClient),
 * distinct de celui de DetailClient.
 *
 * Ouverture du détail d'une vente depuis l'historique des achats d'un client
 * (2026-08-22, parité Electron) : DetailVente est maintenant exporté depuis
 * Ventes.tsx et réutilisé ici, comme côté Electron.
 */

function libelleStatutCredit(statut: StatutCredit): string {
  return statut === "solde" ? "Soldé" : "En cours";
}

function DetailCredit({ creditId, session, onRetour }: { creditId: string; session: Session; onRetour: () => void }) {
  const peutGerer = !!session.permissions.gerer_clients;
  const devise = useDevise();
  const [credit, setCredit] = useState<CreditDetail | null>(null);
  const [infoClient, setInfoClient] = useState<ClientResume | null>(null);
  const [modifierInfos, setModifierInfos] = useState(false);
  const [nomClient, setNomClient] = useState("");
  const [telephoneClient, setTelephoneClient] = useState("");
  const [adresseClient, setAdresseClient] = useState("");
  const [erreurInfos, setErreurInfos] = useState<string | null>(null);
  const [enCoursInfos, setEnCoursInfos] = useState(false);
  const [afficherModalRembourser, setAfficherModalRembourser] = useState(false);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState(MODES_REGLEMENT[0].valeur);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    const resultat = await obtenirCredit(creditId);
    if (resultat) setCredit(resultat);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditId]);

  useEffect(() => {
    if (!session.depotId) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!credit) return;
    obtenirClient(credit.clientId).then((c) => {
      if (!c) return;
      setInfoClient(c);
      setNomClient(c.nom);
      setTelephoneClient(c.telephone);
      setAdresseClient(c.adresse);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credit?.clientId]);

  async function enregistrerInfosClient() {
    if (!infoClient) return;
    setErreurInfos(null);
    if (!nomClient.trim()) {
      setErreurInfos("Le nom est requis.");
      return;
    }
    if (telephoneClient.trim() && !telephoneValide(telephoneClient)) {
      setErreurInfos("Téléphone au format international requis, ex. +2250712345678.");
      return;
    }
    setEnCoursInfos(true);
    try {
      await modifierClient(infoClient.id, { nom: nomClient.trim(), telephone: telephoneClient, adresse: adresseClient });
      setInfoClient({ ...infoClient, nom: nomClient.trim(), telephone: telephoneClient, adresse: adresseClient });
      setModifierInfos(false);
    } catch (e) {
      setErreurInfos(e instanceof ErreurClient ? e.message : "Erreur inattendue.");
    } finally {
      setEnCoursInfos(false);
    }
  }

  async function rembourser(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await rembourserCredit(creditId, Number(montant) || 0, mode, depotId || null, session.utilisateurId);
      setMontant("");
      setMode(MODES_REGLEMENT[0].valeur);
      setAfficherModalRembourser(false);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurClient ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  if (!credit) return <p>Chargement…</p>;
  const solde = credit.statut === "solde" ? 0 : credit.solde;

  return (
    <>
      <div className="modale-entete">
        <h3>
          Crédit de {credit.clientNom}{" "}
          <span className={credit.statut === "solde" ? "badge-payee" : "badge-credit"}>{libelleStatutCredit(credit.statut)}</span>
        </h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour
        </button>
      </div>
      <div className="modale-corps">
        {infoClient && (
          <>
            <h4>Informations</h4>
            {erreurInfos && <div className="message-erreur">{erreurInfos}</div>}
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Téléphone</th>
                    <th>Adresse</th>
                    {peutGerer && <th />}
                  </tr>
                </thead>
                <tbody>
                  {modifierInfos ? (
                    <tr className="ligne-edition">
                      <td>
                        <input value={nomClient} onChange={(e) => setNomClient(e.target.value)} autoFocus />
                      </td>
                      <td>
                        <input
                          value={telephoneClient}
                          onChange={(e) => setTelephoneClient(normaliserTelephone(e.target.value))}
                          placeholder="+2250712345678"
                        />
                        <span className="aide-format-telephone">Indicatif + numéro, ex. 2250712345678</span>
                      </td>
                      <td>
                        <input value={adresseClient} onChange={(e) => setAdresseClient(e.target.value)} />
                      </td>
                      <td>
                        <span className="actions-ligne">
                          <button type="button" onClick={enregistrerInfosClient} disabled={enCoursInfos}>
                            {enCoursInfos ? "Enregistrement…" : "Enregistrer"}
                          </button>
                          <button type="button" className="lien" onClick={() => setModifierInfos(false)}>
                            Annuler
                          </button>
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td>{infoClient.nom || ""}</td>
                      <td>{infoClient.telephone || ""}</td>
                      <td>{infoClient.adresse || ""}</td>
                      {peutGerer && (
                        <td>
                          <button type="button" onClick={() => setModifierInfos(true)}>
                            Modifier
                          </button>
                        </td>
                      )}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="grille-champs">
          <div>
            <p className="note-aide">Date d'achat</p>
            <p>{new Date(credit.dateCreation).toLocaleString("fr-FR")}</p>
          </div>
          <div>
            <p className="note-aide">Vente</p>
            <p>{credit.venteNumero ?? ""}</p>
          </div>
        </div>

        <div className="totaux">
          <div>
            Montant : {formaterMontant(credit.montant)} {devise}
          </div>
          <div>
            Payé : {formaterMontant(credit.montantPaye)} {devise}
          </div>
          <div className="total-net">
            Solde : {formaterMontant(solde)} {devise}
          </div>
        </div>

        <div className="barre-actions">
          <h4>Règlements</h4>
          {peutGerer && solde > 0 && !afficherModalRembourser && (
            <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherModalRembourser(true)}>
              + Nouveau règlement
            </button>
          )}
        </div>
        <div className="zone-tableau-scroll">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>N°</th>
                <th>Date de règlement</th>
                <th>Montant</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {credit.paiements.map((p, index) => (
                <tr key={p.id}>
                  <td>{index + 1}</td>
                  <td>{new Date(p.dateCreation).toLocaleString("fr-FR")}</td>
                  <td>
                    {formaterMontant(p.montant)} {devise}
                  </td>
                  <td>{p.mode || ""}</td>
                </tr>
              ))}
              {credit.paiements.length === 0 && (
                <tr>
                  <td colSpan={4} className="liste-vide">
                    Aucun règlement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {afficherModalRembourser && (
          <div className="fond-modale" onClick={() => setAfficherModalRembourser(false)}>
            <div className="modale-confirmation" onClick={(e) => e.stopPropagation()}>
              <form onSubmit={rembourser}>
                <h3>Nouveau règlement</h3>
                {erreur && <div className="message-erreur">{erreur}</div>}
                <div className="grille-champs">
                  <label>
                    Montant
                    <ChampMontant value={montant} onChange={setMontant} autoFocus />
                  </label>
                  <label>
                    Mode
                    <select value={mode} onChange={(e) => setMode(e.target.value)}>
                      {MODES_REGLEMENT.map((m) => (
                        <option key={m.valeur} value={m.valeur}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!session.depotId && (
                    <label>
                      Dépôt (caisse concernée)
                      <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                        <option value="">Choisir…</option>
                        {depots.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.nom}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="actions-formulaire">
                  <button type="button" onClick={() => setAfficherModalRembourser(false)} disabled={enCours}>
                    Annuler
                  </button>
                  <button type="submit" disabled={enCours}>
                    {enCours ? "Enregistrement…" : "Régler"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DetailClient({ client, session, onRetour }: { client: ClientResume; session: Session; onRetour: () => void }) {
  const peutGerer = !!session.permissions.gerer_clients;
  const clientId = client.id;
  const [ventes, setVentes] = useState<VenteResume[]>([]);
  const [credits, setCredits] = useState<CreditResume[]>([]);
  const [creditSelectionneId, setCreditSelectionneId] = useState<string | null>(null);
  const [venteSelectionneeId, setVenteSelectionneeId] = useState<string | null>(null);
  const [infos, setInfos] = useState(client);
  const [modifierInfos, setModifierInfos] = useState(false);
  const [nom, setNom] = useState(client.nom);
  const [telephone, setTelephone] = useState(client.telephone);
  const [adresse, setAdresse] = useState(client.adresse);
  const [erreurInfos, setErreurInfos] = useState<string | null>(null);
  const [enCoursInfos, setEnCoursInfos] = useState(false);
  const [pageClient, setPageClient] = useState<"achats" | "credits">("achats");

  async function rafraichir() {
    const [ventesResultat, creditsResultat] = await Promise.all([
      listerVentesLocales(session.boutiqueId, undefined, undefined, undefined, clientId),
      listerCredits(session.boutiqueId, clientId),
    ]);
    setVentes(ventesResultat);
    setCredits(creditsResultat);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function enregistrerInfos() {
    setErreurInfos(null);
    if (!nom.trim()) {
      setErreurInfos("Le nom est requis.");
      return;
    }
    if (telephone.trim() && !telephoneValide(telephone)) {
      setErreurInfos("Téléphone au format international requis, ex. +2250712345678.");
      return;
    }
    setEnCoursInfos(true);
    try {
      await modifierClient(clientId, { nom: nom.trim(), telephone, adresse });
      setInfos({ ...infos, nom: nom.trim(), telephone, adresse });
      setModifierInfos(false);
    } catch (e) {
      setErreurInfos(e instanceof ErreurClient ? e.message : "Erreur inattendue.");
    } finally {
      setEnCoursInfos(false);
    }
  }

  if (creditSelectionneId) {
    return (
      <DetailCredit
        creditId={creditSelectionneId}
        session={session}
        onRetour={() => {
          setCreditSelectionneId(null);
          rafraichir();
        }}
      />
    );
  }

  if (venteSelectionneeId) {
    return (
      <DetailVente
        venteId={venteSelectionneeId}
        session={session}
        onRetour={() => {
          setVenteSelectionneeId(null);
          rafraichir();
        }}
      />
    );
  }

  return (
    <>
      <div className="modale-entete">
        <h3>{infos.nom}</h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour
        </button>
      </div>
      <div className="modale-corps">
        <h4>Informations</h4>
        {erreurInfos && <div className="message-erreur">{erreurInfos}</div>}
        <div className="zone-tableau-scroll">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Adresse</th>
                {peutGerer && <th />}
              </tr>
            </thead>
            <tbody>
              {modifierInfos ? (
                <tr className="ligne-edition">
                  <td>
                    <input value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
                  </td>
                  <td>
                    <input
                      value={telephone}
                      onChange={(e) => setTelephone(normaliserTelephone(e.target.value))}
                      placeholder="+2250712345678"
                    />
                    <span className="aide-format-telephone">Indicatif + numéro, ex. 2250712345678</span>
                  </td>
                  <td>
                    <input value={adresse} onChange={(e) => setAdresse(e.target.value)} />
                  </td>
                  <td>
                    <span className="actions-ligne">
                      <button type="button" onClick={enregistrerInfos} disabled={enCoursInfos}>
                        {enCoursInfos ? "Enregistrement…" : "Enregistrer"}
                      </button>
                      <button type="button" className="lien" onClick={() => setModifierInfos(false)}>
                        Annuler
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr>
                  <td>{infos.nom || ""}</td>
                  <td>{infos.telephone || ""}</td>
                  <td>{infos.adresse || ""}</td>
                  {peutGerer && (
                    <td>
                      <button type="button" onClick={() => setModifierInfos(true)}>
                        Modifier
                      </button>
                    </td>
                  )}
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="barre-onglets">
          <button type="button" className={`onglet ${pageClient === "achats" ? "actif" : ""}`} onClick={() => setPageClient("achats")}>
            Historique des achats
          </button>
          <button type="button" className={`onglet ${pageClient === "credits" ? "actif" : ""}`} onClick={() => setPageClient("credits")}>
            Crédits
          </button>
        </div>

        {pageClient === "achats" && (
          <div className="zone-tableau-scroll zone-tableau-scroll-client">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Date</th>
                  <th>Numéro</th>
                  <th>Statut</th>
                  <th>Total net</th>
                </tr>
              </thead>
              <tbody>
                {ventes.map((v, index) => (
                  <tr key={v.id} onClick={() => setVenteSelectionneeId(v.id)}>
                    <td>{index + 1}</td>
                    <td>{new Date(v.dateCreation).toLocaleString("fr-FR")}</td>
                    <td>{v.numero}</td>
                    <td>
                      <span className={`badge-${v.statut}`}>{libelleStatutVente(v.statut)}</span>
                    </td>
                    <td>{formaterMontant(v.totalNet)}</td>
                  </tr>
                ))}
                {ventes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucun achat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {pageClient === "credits" && (
          <div className="zone-tableau-scroll zone-tableau-scroll-client">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Date d'achat</th>
                  <th>Vente</th>
                  <th>Montant</th>
                  <th>Payé</th>
                  <th>Solde</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {credits.map((c, index) => (
                  <tr key={c.id} onClick={() => setCreditSelectionneId(c.id)}>
                    <td>{index + 1}</td>
                    <td>{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
                    <td>{c.venteNumero ?? ""}</td>
                    <td>{formaterMontant(c.montant)}</td>
                    <td>{formaterMontant(c.montantPaye)}</td>
                    <td>{formaterMontant(c.solde)}</td>
                    <td>
                      <span className={c.statut === "solde" ? "badge-payee" : "badge-credit"}>{libelleStatutCredit(c.statut)}</span>
                    </td>
                  </tr>
                ))}
                {credits.length === 0 && (
                  <tr>
                    <td colSpan={7} className="liste-vide">
                      Aucun crédit.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Ronds défilants du fond (même patron que Accueil.tsx) : tailles/vitesses/
 * délais variés, trajectoire propre à chacun (départ → arrivée en vw/vh),
 * couleur --cercle-N (index.css — cycle des teintes sémantiques par défaut,
 * réassorti à l'identité propre de certains thèmes comme Orange).
 */
const CERCLES_FOND = [
  { taille: 90, couleur: "var(--cercle-1)", duree: 26, delai: -4, depart: ["-15vw", "10vh"], arrivee: ["115vw", "60vh"] },
  { taille: 60, couleur: "var(--cercle-2)", duree: 22, delai: -15, depart: ["115vw", "70vh"], arrivee: ["-15vw", "15vh"] },
  { taille: 120, couleur: "var(--cercle-3)", duree: 32, delai: -9, depart: ["20vw", "115vh"], arrivee: ["75vw", "-20vh"] },
  { taille: 50, couleur: "var(--cercle-4)", duree: 24, delai: -2, depart: ["70vw", "-15vh"], arrivee: ["15vw", "115vh"] },
  { taille: 75, couleur: "var(--cercle-5)", duree: 28, delai: -20, depart: ["-15vw", "90vh"], arrivee: ["110vw", "20vh"] },
  { taille: 100, couleur: "var(--cercle-6)", duree: 30, delai: -12, depart: ["110vw", "25vh"], arrivee: ["-15vw", "85vh"] },
  { taille: 40, couleur: "var(--cercle-1)", duree: 20, delai: -7, depart: ["40vw", "-15vh"], arrivee: ["85vw", "115vh"] },
  { taille: 65, couleur: "var(--cercle-3)", duree: 25, delai: -16, depart: ["105vw", "45vh"], arrivee: ["-10vw", "55vh"] },
  { taille: 85, couleur: "var(--cercle-4)", duree: 34, delai: -5, depart: ["85vw", "110vh"], arrivee: ["10vw", "-15vh"] },
  { taille: 55, couleur: "var(--cercle-6)", duree: 23, delai: -10, depart: ["-10vw", "35vh"], arrivee: ["105vw", "90vh"] },
] as const;

const SECTIONS = [
  { cle: "clients", label: "Clients", icone: "👤" },
  { cle: "credits", label: "Crédits", icone: "💳" },
] as const;

type Section = (typeof SECTIONS)[number]["cle"];

function EnteteModale({ titre, onFermer }: { titre: string; onFermer: () => void }) {
  return (
    <div className="modale-entete">
      <h3>{titre}</h3>
      <button type="button" className="lien bouton-retour" onClick={onFermer}>
        ← Retour
      </button>
    </div>
  );
}

interface LigneClientGroupe {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
}

function FormulaireClientsGroupe({
  boutiqueId,
  onAnnuler,
  onCree,
}: {
  boutiqueId: string;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [adresse, setAdresse] = useState("");
  const [lignes, setLignes] = useState<LigneClientGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  function ajouterClient() {
    if (!nom.trim()) return;
    if (telephone.trim() && !telephoneValide(telephone)) {
      setErreur("Téléphone au format international requis, ex. +2250712345678.");
      return;
    }
    setErreur(null);
    setLignes((actuel) => [...actuel, { id: crypto.randomUUID(), nom: nom.trim(), telephone: telephone.trim(), adresse: adresse.trim() }]);
    setNom("");
    setTelephone("");
    setAdresse("");
  }

  function surEntree(evenement: React.KeyboardEvent) {
    if (evenement.key === "Enter") {
      evenement.preventDefault();
      ajouterClient();
    }
  }

  function retirerLigne(id: string) {
    setLignes((actuel) => actuel.filter((l) => l.id !== id));
  }

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (lignes.length === 0) {
      setErreur("Ajoutez au moins un client à la liste.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignes) {
        try {
          await creerClient(boutiqueId, ligne.nom, ligne.telephone, ligne.adresse);
        } catch (e) {
          setErreur(`"${ligne.nom}" : ${e instanceof ErreurClient ? e.message : "Erreur inattendue."}`);
          return;
        }
      }
      onCree();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-produits-groupe">
      <div className="modale-entete entete-fixe">
        <h3>Nouveau client</h3>
        <div className="actions-formulaire">
          <button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : `Enregistrer la liste (${lignes.length})`}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="grille-champs ajout-produit-groupe">
        <label>
          Nom
          <input value={nom} onChange={(e) => setNom(e.target.value)} onKeyDown={surEntree} autoFocus />
        </label>
        <label>
          Téléphone
          <input
            value={telephone}
            onChange={(e) => setTelephone(normaliserTelephone(e.target.value))}
            onKeyDown={surEntree}
            placeholder="+2250712345678"
          />
          <span className="aide-format-telephone">Indicatif + numéro, ex. 2250712345678</span>
        </label>
        <label>
          Adresse
          <input value={adresse} onChange={(e) => setAdresse(e.target.value)} onKeyDown={surEntree} />
        </label>
        <button type="button" className="bouton-ajouter-produit-groupe" onClick={ajouterClient}>
          + Ajouter à la liste
        </button>
      </div>

      <div className="zone-tableau-scroll tableau-produits-groupe-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th className="colonne-numero-groupe">N°</th>
              <th className="col-designation-groupe">Nom</th>
              <th>Téléphone</th>
              <th>Adresse</th>
              <th className="colonne-numero-groupe" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, index) => (
              <tr key={l.id}>
                <td className="colonne-numero-groupe">{index + 1}</td>
                <td className="col-designation-groupe">{l.nom}</td>
                <td>{l.telephone}</td>
                <td>{l.adresse}</td>
                <td className="colonne-numero-groupe">
                  <button type="button" className="bouton-retirer-ligne-groupe" title="Retirer de la liste" onClick={() => retirerLigne(l.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td className="colonne-numero-groupe">&nbsp;</td>
                <td className="col-designation-groupe">&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td className="colonne-numero-groupe">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

function OngletClients({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_clients;
  const devise = useDevise();
  const [terme, setTerme] = useState("");
  const [clientsListe, setClientsListe] = useState<ClientResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  const [clientSelectionne, setClientSelectionne] = useState<ClientResume | null>(null);
  const [clientASupprimerId, setClientASupprimerId] = useState<string | null>(null);

  async function rafraichir() {
    setClientsListe(await listerClientsDetail(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const termeNormalise = terme.trim().toLowerCase();
  const clientsFiltres = termeNormalise
    ? clientsListe.filter((c) => c.nom.toLowerCase().includes(termeNormalise) || c.telephone.toLowerCase().includes(termeNormalise))
    : clientsListe;

  async function supprimer(id: string) {
    await supprimerClient(id);
    setClientASupprimerId(null);
    rafraichir();
  }

  return (
    <div>
      {clientSelectionne && (
        <div className="fond-modale" onClick={() => setClientSelectionne(null)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <DetailClient
              client={clientSelectionne}
              session={session}
              onRetour={() => {
                setClientSelectionne(null);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      {clientASupprimerId && (
        <ModaleConfirmation
          titre="Supprimer ce client ?"
          description="Cette action est irréversible."
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setClientASupprimerId(null)}
          onConfirmer={() => supprimer(clientASupprimerId)}
        />
      )}
      <div className="barre-actions barre-actions-fixe barre-actions-avec-onglets">
        <input className="champ-recherche" placeholder="Rechercher par nom ou téléphone…" value={terme} onChange={(e) => setTerme(e.target.value)} />
        {peutGerer && (
          <span className="actions-ligne">
            <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)}>
              + Nouveau client
            </button>
          </span>
        )}
      </div>
      {afficherForm && (
        <div className="fond-modale" onClick={() => setAfficherForm(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireClientsGroupe
              boutiqueId={session.boutiqueId}
              onAnnuler={() => setAfficherForm(false)}
              onCree={() => {
                setAfficherForm(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Adresse</th>
              <th>Solde dû</th>
              {peutGerer && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {clientsFiltres.map((c, index) => (
              <tr key={c.id} onClick={() => setClientSelectionne(c)}>
                <td>{index + 1}</td>
                <td>{c.nom}</td>
                <td>{c.telephone || ""}</td>
                <td>{c.adresse || ""}</td>
                <td>
                  {c.soldeCredit > 0 ? (
                    <span className="badge-solde-du">
                      {formaterMontant(c.soldeCredit)} {devise}
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                {peutGerer && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className="actions-ligne">
                      <button type="button" className="lien-icone" title="Modifier" onClick={() => setClientSelectionne(c)}>
                        ✎
                      </button>
                      <button type="button" className="lien-icone lien-icone-danger" title="Supprimer" onClick={() => setClientASupprimerId(c.id)}>
                        ×
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
            {clientsFiltres.length === 0 && (
              <tr>
                <td colSpan={6} className="liste-vide">
                  Aucun client.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OngletCredits({ session }: { session: Session }) {
  const [statut, setStatut] = useState<StatutCredit | "">("");
  // Les crédits de clients réguliers et de clients de passage ne doivent
  // jamais se mélanger dans la même vue (mémoire projet "clients permanents
  // vs occasionnels").
  const [typeClient, setTypeClient] = useState<"reguliers" | "occasionnels">("reguliers");
  const [credits, setCredits] = useState<CreditResume[]>([]);
  const [creditSelectionneId, setCreditSelectionneId] = useState<string | null>(null);

  async function rafraichir() {
    setCredits(await listerCredits(session.boutiqueId, undefined, statut || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statut]);

  const creditsFiltres = credits.filter((c) => (typeClient === "reguliers" ? c.clientEstPermanent : !c.clientEstPermanent));

  return (
    <div>
      {creditSelectionneId && (
        <div className="fond-modale" onClick={() => setCreditSelectionneId(null)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <DetailCredit
              creditId={creditSelectionneId}
              session={session}
              onRetour={() => {
                setCreditSelectionneId(null);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="barre-actions barre-actions-fixe barre-actions-avec-onglets">
        <div className="barre-onglets">
          <button type="button" className={`onglet ${typeClient === "reguliers" ? "actif" : ""}`} onClick={() => setTypeClient("reguliers")}>
            Clients réguliers
          </button>
          <button type="button" className={`onglet ${typeClient === "occasionnels" ? "actif" : ""}`} onClick={() => setTypeClient("occasionnels")}>
            Clients de passage
          </button>
        </div>
        <select value={statut} onChange={(e) => setStatut(e.target.value as StatutCredit | "")}>
          <option value="">Tous les statuts</option>
          <option value="en_cours">En cours</option>
          <option value="solde">Soldé</option>
        </select>
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date d'achat</th>
              <th>Client</th>
              <th>Vente</th>
              <th>Montant</th>
              <th>Payé</th>
              <th>Solde</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {creditsFiltres.map((c, index) => (
              <tr key={c.id} onClick={() => setCreditSelectionneId(c.id)}>
                <td>{index + 1}</td>
                <td>{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
                <td>{c.clientNom}</td>
                <td>{c.venteNumero ?? ""}</td>
                <td>{formaterMontant(c.montant)}</td>
                <td>{formaterMontant(c.montantPaye)}</td>
                <td>{formaterMontant(c.solde)}</td>
                <td>
                  <span className={c.statut === "solde" ? "badge-payee" : "badge-credit"}>{libelleStatutCredit(c.statut)}</span>
                </td>
              </tr>
            ))}
            {creditsFiltres.length === 0 && (
              <tr>
                <td colSpan={8} className="liste-vide">
                  Aucun crédit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModaleClients({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Clients" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletClients session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleCredits({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Crédits" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletCredits session={session} />
        </div>
      </div>
    </div>
  );
}

export default function Clients({ session }: { session: Session }) {
  const [sectionOuverte, setSectionOuverte] = useState<Section | null>(null);

  return (
    <div className="page-produits page-accueil">
      {CERCLES_FOND.map((c, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="cercle-fond"
          style={
            {
              width: c.taille,
              height: c.taille,
              background: c.couleur,
              animationDuration: `${c.duree}s`,
              animationDelay: `${c.delai}s`,
              "--depart-x": c.depart[0],
              "--depart-y": c.depart[1],
              "--arrivee-x": c.arrivee[0],
              "--arrivee-y": c.arrivee[1],
            } as CSSProperties
          }
        />
      ))}
      <div className="grille-documents-comptables">
        {SECTIONS.map((s) => (
          <button
            key={s.cle}
            type="button"
            className="carte-document-comptable"
            onClick={() => setSectionOuverte(s.cle)}
          >
            <span className="icone-document-comptable">{s.icone}</span>
            {s.label}
          </button>
        ))}
      </div>
      {sectionOuverte === "clients" && (
        <ModaleClients session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "credits" && (
        <ModaleCredits session={session} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
