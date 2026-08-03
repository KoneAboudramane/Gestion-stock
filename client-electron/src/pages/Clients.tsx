import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  ClientDetailResume,
  CreditDetail,
  CreditResume,
  ModePaiement,
  Session,
  StatutCredit,
  VenteResume,
} from "../api/client";
import { useDevise } from "../contexts/DeviseContext";
import { MODES_PAIEMENT, libelleStatutVente } from "../lib/libelles";

// Rembourser "à crédit" n'a pas de sens : on exclut ce mode de la liste.
const MODES_REMBOURSEMENT = MODES_PAIEMENT.filter((m) => m.valeur !== "credit");

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
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState(MODES_REMBOURSEMENT[0].valeur);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    setCredit((await api.credits.obtenir(creditId)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditId]);

  async function rembourser(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.credits.rembourser(creditId, Number(montant) || 0, mode);
      if (resultat.succes) {
        setMontant("");
        setMode(MODES_REMBOURSEMENT[0].valeur);
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
    <div className="detail-produit">
      <div className="entete-detail">
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
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="totaux">
        <div>Montant : {credit.montant} {devise}</div>
        <div>Payé : {credit.montantPaye} {devise}</div>
        <div className="total-net">Solde : {solde} {devise}</div>
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
              <td>{p.montant} {devise}</td>
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
        </tbody>
      </table>
      </div>

      {peutGerer && solde > 0 && (
        <form onSubmit={rembourser} className="formulaire-catalogue">
          <h4>Nouveau remboursement</h4>
          <div className="grille-champs">
            <label>
              Montant
              <input
                type="number"
                min={0.01}
                max={solde}
                step="any"
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
              />
            </label>
            <label>
              Mode
              <select value={mode} onChange={(e) => setMode(e.target.value as ModePaiement)}>
                {MODES_REMBOURSEMENT.map((m) => (
                  <option key={m.valeur} value={m.valeur}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions-formulaire">
            <button type="submit" disabled={enCours}>
              {enCours ? "Enregistrement…" : "Rembourser"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// --- Onglet Clients ---

function DetailClient({
  clientId,
  clientNom,
  session,
  onRetour,
}: {
  clientId: string;
  clientNom: string;
  session: Session;
  onRetour: () => void;
}) {
  const [ventes, setVentes] = useState<VenteResume[]>([]);
  const [credits, setCredits] = useState<CreditResume[]>([]);
  const [creditSelectionneId, setCreditSelectionneId] = useState<string | null>(null);

  async function rafraichir() {
    setVentes(await api.ventes.lister(session.boutiqueId, undefined, undefined, "", 50, clientId));
    setCredits(await api.credits.lister(session.boutiqueId, clientId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

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

  return (
    <div className="detail-produit">
      <div className="entete-detail">
        <h3>{clientNom}</h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour à la liste
        </button>
      </div>

      <h4>Historique des achats</h4>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date</th>
            <th>Numéro</th>
            <th>Statut</th>
            <th>Total net</th>
          </tr>
        </thead>
        <tbody>
          {ventes.map((v) => (
            <tr key={v.id}>
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
              <td colSpan={4} className="liste-vide">
                Aucun achat.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      <h4>Crédits</h4>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date d'achat</th>
            <th>Vente</th>
            <th>Montant</th>
            <th>Payé</th>
            <th>Solde</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {credits.map((c) => (
            <tr key={c.id} onClick={() => setCreditSelectionneId(c.id)}>
              <td>{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{c.venteNumero ?? ""}</td>
              <td>{c.montant}</td>
              <td>{c.montantPaye}</td>
              <td>{c.solde}</td>
              <td>
                <span className={c.statut === "solde" ? "badge-payee" : "badge-credit"}>
                  {libelleStatutCredit(c.statut)}
                </span>
              </td>
            </tr>
          ))}
          {credits.length === 0 && (
            <tr>
              <td colSpan={6} className="liste-vide">
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

function OngletClients({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_clients;
  const devise = useDevise();
  const [terme, setTerme] = useState("");
  const [clientsListe, setClientsListe] = useState<ClientDetailResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [adresse, setAdresse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [clientSelectionne, setClientSelectionne] = useState<{ id: string; nom: string } | null>(null);

  async function rafraichir() {
    setClientsListe(await api.clients.lister(session.boutiqueId, terme));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme]);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    const resultat = await api.clients.creer(session.boutiqueId, nom.trim(), telephone.trim(), adresse.trim());
    if (resultat.succes) {
      setNom("");
      setTelephone("");
      setAdresse("");
      setErreur(null);
      setAfficherForm(false);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  if (clientSelectionne) {
    return (
      <DetailClient
        clientId={clientSelectionne.id}
        clientNom={clientSelectionne.nom}
        session={session}
        onRetour={() => {
          setClientSelectionne(null);
          rafraichir();
        }}
      />
    );
  }

  return (
    <div>
      <div className="barre-actions">
        <input
          className="champ-recherche"
          placeholder="Rechercher par nom ou téléphone…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        {peutGerer && !afficherForm && (
          <button type="button" onClick={() => setAfficherForm(true)}>
            + Nouveau client
          </button>
        )}
      </div>
      {afficherForm && (
        <form onSubmit={ajouter} className="formulaire-catalogue">
          <h4>Nouveau client</h4>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <div className="grille-champs">
            <label>
              Nom
              <input value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
            </label>
            <label>
              Téléphone
              <input value={telephone} onChange={(e) => setTelephone(e.target.value)} />
            </label>
            <label>
              Adresse
              <input value={adresse} onChange={(e) => setAdresse(e.target.value)} />
            </label>
          </div>
          <div className="actions-formulaire">
            <button type="button" onClick={() => setAfficherForm(false)}>
              Annuler
            </button>
            <button type="submit">Créer</button>
          </div>
        </form>
      )}
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Téléphone</th>
            <th>Adresse</th>
            <th>Solde dû</th>
          </tr>
        </thead>
        <tbody>
          {clientsListe.map((c) => (
            <tr key={c.id} onClick={() => setClientSelectionne({ id: c.id, nom: c.nom })}>
              <td>{c.nom}</td>
              <td>{c.telephone || ""}</td>
              <td>{c.adresse || ""}</td>
              <td>
                {c.soldeCredit > 0 ? (
                  <span className="badge-solde-du">{c.soldeCredit} {devise}</span>
                ) : (
                  ""
                )}
              </td>
            </tr>
          ))}
          {clientsListe.length === 0 && (
            <tr>
              <td colSpan={4} className="liste-vide">
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

// --- Onglet Crédits (carnet global) ---

function OngletCredits({ session, statutInitial }: { session: Session; statutInitial?: StatutCredit | "" }) {
  const [statut, setStatut] = useState<StatutCredit | "">(statutInitial ?? "");
  const [credits, setCredits] = useState<CreditResume[]>([]);
  const [creditSelectionneId, setCreditSelectionneId] = useState<string | null>(null);

  async function rafraichir() {
    setCredits(await api.credits.lister(session.boutiqueId, undefined, statut || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statut]);

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

  return (
    <div>
      <div className="barre-actions">
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
          {credits.map((c) => (
            <tr key={c.id} onClick={() => setCreditSelectionneId(c.id)}>
              <td>{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{c.clientNom}</td>
              <td>{c.venteNumero ?? ""}</td>
              <td>{c.montant}</td>
              <td>{c.montantPaye}</td>
              <td>{c.solde}</td>
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
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Page principale ---

const ONGLETS = [
  { cle: "clients", label: "Clients" },
  { cle: "credits", label: "Crédits" },
] as const;

export type OngletClients = (typeof ONGLETS)[number]["cle"];

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
      <div className="entete-page-onglets">
        <h2>Clients & crédit</h2>
        <div className="barre-onglets">
          {ONGLETS.map((o) => (
            <button key={o.cle} className={`onglet ${onglet === o.cle ? "actif" : ""}`} onClick={() => setOnglet(o.cle)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="contenu-onglet">
        {onglet === "clients" && <OngletClients session={session} />}
        {onglet === "credits" && <OngletCredits session={session} statutInitial={statutCreditsInitial} />}
      </div>
    </div>
  );
}
