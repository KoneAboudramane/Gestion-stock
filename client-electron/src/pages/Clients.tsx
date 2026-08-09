import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  ClientDetailResume,
  CreditDetail,
  CreditResume,
  Session,
  StatutCredit,
  VenteResume,
} from "../api/client";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant, normaliserTelephone, telephoneValide } from "../lib/formatage";
import { libelleStatutVente } from "../lib/libelles";
import { DetailVente } from "./Ventes";

// Rembourser "à crédit" n'a pas de sens : on liste directement Espèces et les
// opérateurs Mobile Money (pas de sélecteur à deux niveaux comme en Caisse).
const MODES_REMBOURSEMENT = ["Espèces", "Orange Money", "MTN Money", "Moov Money", "Wave"];

function libelleStatutCredit(statut: StatutCredit): string {
  return statut === "solde" ? "Soldé" : "En cours";
}

// --- Détail d'un crédit (partagé entre l'onglet Clients et l'onglet Crédits) ---

function DetailCredit({
  creditId,
  session,
  onRetour,
}: {
  creditId: string;
  session: Session;
  onRetour: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_clients;
  const devise = useDevise();
  const [credit, setCredit] = useState<CreditDetail | null>(null);
  const [infoClient, setInfoClient] = useState<ClientDetailResume | null>(null);
  const [modifierInfos, setModifierInfos] = useState(false);
  const [nomClient, setNomClient] = useState("");
  const [telephoneClient, setTelephoneClient] = useState("");
  const [adresseClient, setAdresseClient] = useState("");
  const [erreurInfos, setErreurInfos] = useState<string | null>(null);
  const [enCoursInfos, setEnCoursInfos] = useState(false);
  const [afficherModalRembourser, setAfficherModalRembourser] = useState(false);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState(MODES_REMBOURSEMENT[0]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    setCredit((await api.credits.obtenir(creditId)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditId]);

  useEffect(() => {
    if (!credit) return;
    api.clients.obtenir(credit.clientId).then((c) => {
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
      const resultat = await api.clients.modifier(infoClient.id, {
        nom: nomClient.trim(),
        telephone: telephoneClient,
        adresse: adresseClient,
      });
      if (resultat.succes) {
        setInfoClient({ ...infoClient, nom: nomClient.trim(), telephone: telephoneClient, adresse: adresseClient });
        setModifierInfos(false);
      } else {
        setErreurInfos(resultat.message);
      }
    } finally {
      setEnCoursInfos(false);
    }
  }

  async function rembourser(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.credits.rembourser(creditId, Number(montant) || 0, mode);
      if (resultat.succes) {
        setMontant("");
        setMode(MODES_REMBOURSEMENT[0]);
        setAfficherModalRembourser(false);
        rafraichir();
      } else {
        setErreur(resultat.message);
      }
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
          <span className={credit.statut === "solde" ? "badge-payee" : "badge-credit"}>
            {libelleStatutCredit(credit.statut)}
          </span>
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
                <td>{infoClient.nom || "—"}</td>
                <td>{infoClient.telephone || "—"}</td>
                <td>{infoClient.adresse || "—"}</td>
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
        <div>Montant : {formaterMontant(credit.montant)} {devise}</div>
        <div>Payé : {formaterMontant(credit.montantPaye)} {devise}</div>
        <div className="total-net">Solde : {formaterMontant(solde)} {devise}</div>
      </div>

      <h4>Remboursements</h4>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date de remboursement</th>
            <th>Montant</th>
            <th>Mode</th>
          </tr>
        </thead>
        <tbody>
          {credit.paiements.map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{formaterMontant(p.montant)} {devise}</td>
              <td>{p.mode || ""}</td>
            </tr>
          ))}
          {credit.paiements.length === 0 && (
            <tr>
              <td colSpan={3} className="liste-vide">
                Aucun remboursement.
              </td>
            </tr>
          )}
          {credit.paiements.length > 0 &&
            Array.from({ length: Math.max(0, 10 - credit.paiements.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
        </tbody>
      </table>
      </div>

      {peutGerer && solde > 0 && !afficherModalRembourser && (
        <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherModalRembourser(true)}>
          + Nouveau remboursement
        </button>
      )}

      {afficherModalRembourser && (
        <div className="fond-modale" onClick={() => setAfficherModalRembourser(false)}>
          <div className="modale-confirmation" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={rembourser}>
              <h3>Nouveau remboursement</h3>
              {erreur && <div className="message-erreur">{erreur}</div>}
              <div className="grille-champs">
                <label>
                  Montant
                  <ChampMontant value={montant} onChange={setMontant} autoFocus />
                </label>
                <label>
                  Mode
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    {MODES_REMBOURSEMENT.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="actions-formulaire">
                <button type="button" onClick={() => setAfficherModalRembourser(false)} disabled={enCours}>
                  Annuler
                </button>
                <button type="submit" disabled={enCours}>
                  {enCours ? "Enregistrement…" : "Rembourser"}
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

// --- Onglet Clients ---

function DetailClient({
  client,
  session,
  onRetour,
}: {
  client: ClientDetailResume;
  session: Session;
  onRetour: () => void;
}) {
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
    setVentes(await api.ventes.lister(session.boutiqueId, undefined, undefined, "", 50, clientId));
    setCredits(await api.credits.lister(session.boutiqueId, clientId));
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
      const resultat = await api.clients.modifier(clientId, { nom: nom.trim(), telephone, adresse });
      if (resultat.succes) {
        setInfos({ ...infos, nom: nom.trim(), telephone, adresse });
        setModifierInfos(false);
      } else {
        setErreurInfos(resultat.message);
      }
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
              <td>{infos.nom || "—"}</td>
              <td>{infos.telephone || "—"}</td>
              <td>{infos.adresse || "—"}</td>
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
        <button
          type="button"
          className={`onglet ${pageClient === "achats" ? "actif" : ""}`}
          onClick={() => setPageClient("achats")}
        >
          Historique des achats
        </button>
        <button
          type="button"
          className={`onglet ${pageClient === "credits" ? "actif" : ""}`}
          onClick={() => setPageClient("credits")}
        >
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
              <td>{v.totalNet}</td>
            </tr>
          ))}
          {ventes.length === 0 && (
            <tr>
              <td colSpan={5} className="liste-vide">
                Aucun achat.
              </td>
            </tr>
          )}
          {ventes.length > 0 &&
            Array.from({ length: Math.max(0, 10 - ventes.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
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
                <span className={c.statut === "solde" ? "badge-payee" : "badge-credit"}>
                  {libelleStatutCredit(c.statut)}
                </span>
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
          {credits.length > 0 &&
            Array.from({ length: Math.max(0, 10 - credits.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
        </tbody>
      </table>
      </div>
      )}
      </div>
    </>
  );
}

const ONGLETS = [
  { cle: "clients", label: "Clients" },
  { cle: "credits", label: "Crédits" },
] as const;

export type OngletClients = (typeof ONGLETS)[number]["cle"];

function SelecteurOnglet({
  onglet,
  setOnglet,
}: {
  onglet: OngletClients;
  setOnglet: (o: OngletClients) => void;
}) {
  return (
    <div className="barre-onglets">
      {ONGLETS.map((o) => (
        <button
          key={o.cle}
          type="button"
          className={`onglet ${onglet === o.cle ? "actif" : ""}`}
          onClick={() => setOnglet(o.cle)}
        >
          {o.label}
        </button>
      ))}
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
  session,
  onAnnuler,
  onCree,
}: {
  session: Session;
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
    setLignes((actuel) => [
      ...actuel,
      { id: crypto.randomUUID(), nom: nom.trim(), telephone: telephone.trim(), adresse: adresse.trim() },
    ]);
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
        const resultat = await api.clients.creer(session.boutiqueId, ligne.nom, ligne.telephone, ligne.adresse);
        if (!resultat.succes) {
          setErreur(`"${ligne.nom}" : ${resultat.message}`);
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
                  <button
                    type="button"
                    className="bouton-retirer-ligne-groupe"
                    title="Retirer de la liste"
                    onClick={() => retirerLigne(l.id)}
                  >
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

function OngletClients({
  session,
  onglet,
  setOnglet,
}: {
  session: Session;
  onglet: OngletClients;
  setOnglet: (o: OngletClients) => void;
}) {
  const peutGerer = !!session.permissions.gerer_clients;
  const devise = useDevise();
  const [terme, setTerme] = useState("");
  const [clientsListe, setClientsListe] = useState<ClientDetailResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  const [clientSelectionne, setClientSelectionne] = useState<ClientDetailResume | null>(null);
  const [clientASupprimerId, setClientASupprimerId] = useState<string | null>(null);

  async function rafraichir() {
    setClientsListe(await api.clients.lister(session.boutiqueId, terme));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme]);

  async function supprimer(id: string) {
    const resultat = await api.clients.supprimer(id);
    if (resultat.succes) {
      setClientASupprimerId(null);
      rafraichir();
    }
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
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
        <input
          className="champ-recherche"
          placeholder="Rechercher par nom ou téléphone…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
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
              session={session}
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
          {clientsListe.map((c, index) => (
            <tr key={c.id} onClick={() => setClientSelectionne(c)}>
              <td>{index + 1}</td>
              <td>{c.nom}</td>
              <td>{c.telephone || ""}</td>
              <td>{c.adresse || ""}</td>
              <td>
                {c.soldeCredit > 0 ? (
                  <span className="badge-solde-du">{formaterMontant(c.soldeCredit)} {devise}</span>
                ) : (
                  ""
                )}
              </td>
              {peutGerer && (
                <td onClick={(e) => e.stopPropagation()}>
                    <span className="actions-ligne">
                      <button
                        type="button"
                        className="lien-icone"
                        title="Modifier"
                        onClick={() => setClientSelectionne(c)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="lien-icone lien-icone-danger"
                        title="Supprimer"
                        onClick={() => setClientASupprimerId(c.id)}
                      >
                        ×
                      </button>
                    </span>
                </td>
              )}
            </tr>
          ))}
          {clientsListe.length === 0 && (
            <tr>
              <td colSpan={6} className="liste-vide">
                Aucun client.
              </td>
            </tr>
          )}
          {clientsListe.length > 0 &&
            Array.from({ length: Math.max(0, 10 - clientsListe.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                {peutGerer && <td>&nbsp;</td>}
              </tr>
            ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Onglet Crédits (carnet global) ---

function OngletCredits({
  session,
  statutInitial,
  onglet,
  setOnglet,
}: {
  session: Session;
  statutInitial?: StatutCredit | "";
  onglet: OngletClients;
  setOnglet: (o: OngletClients) => void;
}) {
  const [statut, setStatut] = useState<StatutCredit | "">(statutInitial ?? "");
  // Les crédits de clients réguliers et de clients de passage ne doivent
  // jamais se mélanger dans la même vue, même si les deux vivent dans ce
  // même carnet de crédit global — voir mémoire projet "clients permanents
  // vs occasionnels".
  const [typeClient, setTypeClient] = useState<"reguliers" | "occasionnels">("reguliers");
  const [credits, setCredits] = useState<CreditResume[]>([]);
  const [creditSelectionneId, setCreditSelectionneId] = useState<string | null>(null);

  async function rafraichir() {
    setCredits(await api.credits.lister(session.boutiqueId, undefined, statut || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statut]);

  const creditsFiltres = credits.filter((c) =>
    typeClient === "reguliers" ? !!c.clientEstPermanent : !c.clientEstPermanent,
  );

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
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
        <div className="barre-onglets">
          <button
            type="button"
            className={`onglet ${typeClient === "reguliers" ? "actif" : ""}`}
            onClick={() => setTypeClient("reguliers")}
          >
            Clients réguliers
          </button>
          <button
            type="button"
            className={`onglet ${typeClient === "occasionnels" ? "actif" : ""}`}
            onClick={() => setTypeClient("occasionnels")}
          >
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
          {creditsFiltres.map((c) => (
            <tr key={c.id} onClick={() => setCreditSelectionneId(c.id)}>
              <td>{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{c.clientNom}</td>
              <td>{c.venteNumero ?? ""}</td>
              <td>{formaterMontant(c.montant)}</td>
              <td>{formaterMontant(c.montantPaye)}</td>
              <td>{formaterMontant(c.solde)}</td>
              <td>
                <span className={c.statut === "solde" ? "badge-payee" : "badge-credit"}>
                  {libelleStatutCredit(c.statut)}
                </span>
              </td>
            </tr>
          ))}
          {creditsFiltres.length === 0 && (
            <tr>
              <td colSpan={7} className="liste-vide">
                Aucun crédit.
              </td>
            </tr>
          )}
          {creditsFiltres.length > 0 &&
            Array.from({ length: Math.max(0, 10 - creditsFiltres.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Page principale ---
// L'onglet (Clients/Crédits) est affiché dans la même ligne que la recherche
// et les actions de chaque onglet (voir SelecteurOnglet) plutôt que dans une
// en-tête séparée.

export default function Clients({
  session,
  ongletInitial,
  statutCreditsInitial,
}: {
  session: Session;
  ongletInitial?: OngletClients;
  statutCreditsInitial?: StatutCredit | "";
}) {
  const [onglet, setOnglet] = useState<OngletClients>(ongletInitial ?? "clients");

  return (
    <div className="page-produits">
      <div className="contenu-onglet">
        {onglet === "clients" && <OngletClients session={session} onglet={onglet} setOnglet={setOnglet} />}
        {onglet === "credits" && (
          <OngletCredits
            session={session}
            statutInitial={statutCreditsInitial}
            onglet={onglet}
            setOnglet={setOnglet}
          />
        )}
      </div>
    </div>
  );
}
