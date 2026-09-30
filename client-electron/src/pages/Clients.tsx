import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type {
  ClientDetailResume,
  CreditDetail,
  CreditResume,
  DepotResume,
  Session,
  StatutCredit,
  VenteResume,
  EcheanceDetail,
} from "../api/client";
import ChampMontant from "../components/ChampMontant";
import {
  MODES_MONTANT_INITIAL,
  PanneauCompte,
  enregistrerMontantInitial,
  libelleModeInitial,
} from "../components/CompteTiers";
import ModaleConfirmation from "../components/ModaleConfirmation";
import RecuCredit from "../components/RecuCredit";
import { useDevise } from "../contexts/DeviseContext";
import BoutonsExport from "../components/BoutonsExport";
import type { ColonneExport } from "../api/client";
import ModaleEcheancier from "../components/ModaleEcheancier";
import { formaterMontant, normaliserTelephone, telephoneValide } from "../lib/formatage";
import { MODES_REGLEMENT, libelleModeReglement, libelleStatutVente } from "../lib/libelles";
import { DetailVente } from "./Ventes";

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
  const [mode, setMode] = useState(MODES_REGLEMENT[0].valeur);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  // Argent laissé d'avance par le client : peut régler ce crédit.
  const [soldeCompte, setSoldeCompte] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [recuPaiementId, setRecuPaiementId] = useState<string | null>(null);
  const [reglementsOuverts, setReglementsOuverts] = useState(false);
  const [echeances, setEcheances] = useState<EcheanceDetail[]>([]);
  const [planification, setPlanification] = useState(false);

  useEffect(() => {
    if (!session.depotId) api.depots.lister(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!credit?.clientId) return;
    api.comptesTiers.compteClient(credit.clientId).then((c) => {
      setSoldeCompte(c.solde);
      // Compte vide : l'option disparaît, le mode ne doit pas rester dessus.
      if (c.solde <= 0) setMode((m) => (m === "compte_client" ? MODES_REGLEMENT[0].valeur : m));
    });
  }, [credit]);

  async function rafraichir() {
    setCredit((await api.credits.obtenir(creditId)) ?? null);

    setEcheances(await api.credits.echeancier(creditId));
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

  async function planifier(tranches: { dateEcheance: string; montant: number }[]): Promise<string | null> {
    const resultat = await api.credits.planifier(creditId, tranches);
    if (!resultat.succes) return resultat.message;
    rafraichir();
    return null;
  }

  async function rembourser(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.credits.rembourser(
        creditId,
        Number(montant) || 0,
        mode,
        depotId || null,
        session.utilisateurId,
      );
      if (resultat.succes) {
        setMontant("");
        setMode(MODES_REGLEMENT[0].valeur);
        setAfficherModalRembourser(false);
        const creditFrais = await api.credits.obtenir(creditId);
        setEcheances(await api.credits.echeancier(creditId));
        setCredit(creditFrais ?? null);
        if (creditFrais?.paiements[0]) setRecuPaiementId(creditFrais.paiements[0].id);
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  if (recuPaiementId) {
    return (
      <RecuCredit
        creditId={creditId}
        paiementId={recuPaiementId}
        session={session}
        onRetour={() => setRecuPaiementId(null)}
      />
    );
  }

  if (!credit) return <p>Chargement…</p>;
  const solde = credit.statut === "solde" ? 0 : credit.solde;
  const pourcentagePaye = credit.montant > 0 ? Math.min(100, Math.round((credit.montantPaye / credit.montant) * 100)) : 100;
  const resumeEcheancier = (() => {
    if (echeances.length === 0) {
      return { texte: peutGerer && credit.statut === "en_cours"
          ? "Pas d'échéancier : cliquez pour en planifier un."
          : "Pas d'échéancier.", retard: false };
    }
    const prochaine = echeances.find((e) => e.statut !== "payee");
    const payees = echeances.filter((e) => e.statut === "payee").length;
    return {
      texte:
        `${echeances.length} tranche${echeances.length > 1 ? "s" : ""} · ${payees} payée${payees > 1 ? "s" : ""}` +
        (prochaine
          ? ` · prochaine le ${new Date(`${prochaine.dateEcheance}T00:00:00`).toLocaleDateString("fr-FR")} ` +
            `(${formaterMontant(prochaine.montant - prochaine.couvert)} ${devise})` +
            (prochaine.statut === "en_retard" ? " — en retard" : "")
          : " · tout est payé"),
      retard: prochaine?.statut === "en_retard",
    };
  })();

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
      <div className="fiche-entete">
        <div className="fiche-entete-haut">
          <div>
            <span className="sous-info">Reste dû</span>
            <strong className={`fiche-reste${solde > 0 ? " reste-dette" : ""}`}>
              {formaterMontant(solde)} {devise}
            </strong>
          </div>
          <span className={credit.statut === "solde" ? "badge-payee" : "badge-credit"}>
            {libelleStatutCredit(credit.statut)}
          </span>
        </div>
        <div className="barre-progression" title={`${pourcentagePaye} % remboursé`}>
          <span style={{ width: `${pourcentagePaye}%` }} />
        </div>
        <span className="sous-info">
          {formaterMontant(credit.montantPaye)} / {formaterMontant(credit.montant)} {devise} remboursés ({pourcentagePaye} %)
        </span>
      </div>
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">Vente</span>
          <strong>{credit.venteNumero ?? "—"}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">Date d'achat</span>
          <strong>{new Date(credit.dateCreation).toLocaleDateString("fr-FR")}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">Montant</span>
          <strong>{formaterMontant(credit.montant)} {devise}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">Déjà payé</span>
          <strong>{formaterMontant(credit.montantPaye)} {devise}</strong>
        </div>
      </div>
      <div className="cartes-fiche">
        <section className="carte-fiche">
          <h4>👤 Client</h4>
          {erreurInfos && <div className="message-erreur">{erreurInfos}</div>}
          {infoClient && modifierInfos ? (
            <>
              <input value={nomClient} onChange={(e) => setNomClient(e.target.value)} placeholder="Nom" autoFocus />
              <input
                value={telephoneClient}
                onChange={(e) => setTelephoneClient(normaliserTelephone(e.target.value))}
                placeholder="+2250712345678"
              />
              <input value={adresseClient} onChange={(e) => setAdresseClient(e.target.value)} placeholder="Adresse" />
              <span className="actions-ligne">
                <button type="button" className="bouton-primaire" onClick={enregistrerInfosClient} disabled={enCoursInfos}>
                  {enCoursInfos ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button type="button" onClick={() => setModifierInfos(false)}>
                  Annuler
                </button>
              </span>
            </>
          ) : (
            <>
              <strong>{infoClient?.nom ?? credit.clientNom}</strong>
              <span>📞 {infoClient?.telephone || "Téléphone non renseigné"}</span>
              <span>📍 {infoClient?.adresse || "Adresse non renseignée"}</span>
              {peutGerer && infoClient && (
                <span className="actions-ligne">
                  <button type="button" onClick={() => setModifierInfos(true)}>
                    Modifier
                  </button>
                </span>
              )}
            </>
          )}
        </section>
        {peutGerer && solde > 0 ? (
          <form className="carte-fiche carte-fiche--action" onSubmit={rembourser}>
            <h4>💸 Nouveau règlement</h4>
            <div className="ligne-champs-fiche">
              <ChampMontant placeholder="Montant" value={montant} onChange={setMontant} />
              <button type="button" onClick={() => setMontant(String(solde))}>
                Tout le reste
              </button>
            </div>
            <div className="ligne-champs-fiche">
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES_REGLEMENT.map((m) => (
                  <option key={m.valeur} value={m.valeur}>
                    {m.label}
                  </option>
                ))}
                {soldeCompte > 0 && <option value="compte_client">👛 Compte (disponible {formaterMontant(soldeCompte)})</option>}
              </select>
              {!session.depotId && (
                <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                  <option value="">Dépôt (caisse)…</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nom}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button type="submit" className="bouton-primaire" disabled={enCours || !(Number(montant) > 0)}>
              {enCours ? "Enregistrement…" : "Enregistrer le règlement"}
            </button>
            {erreur && <div className="message-erreur">{erreur}</div>}
          </form>
        ) : (
          <section className="carte-fiche">
            <h4>{credit.statut === "solde" ? "✅ Crédit soldé" : "💸 Règlement"}</h4>
            <span className="sous-info">
              {credit.statut === "solde"
                ? "Le client a tout réglé."
                : "Seuls les comptes qui gèrent les clients peuvent enregistrer un règlement."}
            </span>
          </section>
        )}
      </div>
      <div className="cartes-liens-fiche">
        <button type="button" className="carte-lien-fiche" onClick={() => setPlanification(true)} disabled={!(echeances.length > 0 || (peutGerer && credit.statut === "en_cours"))}>
          <span className="carte-lien-fiche-icone" aria-hidden="true">
            📅
          </span>
          <span className="carte-lien-fiche-corps">
            <strong>Échéancier</strong>
            <span className={resumeEcheancier.retard ? "texte-erreur" : "sous-info"}>{resumeEcheancier.texte}</span>
          </span>
          <span className="carte-lien-fiche-fleche" aria-hidden="true">
            →
          </span>
        </button>
        <button type="button" className="carte-lien-fiche" onClick={() => setReglementsOuverts(true)} disabled={false}>
          <span className="carte-lien-fiche-icone" aria-hidden="true">
            🧾
          </span>
          <span className="carte-lien-fiche-corps">
            <strong>Règlements</strong>
            <span className="sous-info">{credit.paiements.length === 0
                ? "Aucun règlement pour l'instant."
                : `${credit.paiements.length} règlement(s) · dernier le ${new Date(credit.paiements[0].dateCreation).toLocaleDateString("fr-FR")}`}</span>
          </span>
          <span className="carte-lien-fiche-fleche" aria-hidden="true">
            →
          </span>
        </button>
      </div>

      {planification && (
        <ModaleEcheancier
          titre={`Échéancier — crédit de ${credit.clientNom}`}
          reste={credit.solde}
          enCours={credit.statut === "en_cours"}
          peutGerer={peutGerer}
          echeances={echeances}
          onPlanifier={planifier}
          onFermer={() => setPlanification(false)}
        />
      )}
      {reglementsOuverts && (
        <div className="fond-modale" onClick={() => setReglementsOuverts(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <EnteteModale titre={`Règlements — crédit de ${credit.clientNom}`} onFermer={() => setReglementsOuverts(false)} />
            <div className="modale-corps">
              <div className="zone-tableau-scroll zone-traces-dette">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    <th>Date de règlement</th>
                    <th>Montant</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {credit.paiements.map((p) => (
                    <tr key={p.id} onClick={() => setRecuPaiementId(p.id)}>
                      <td>{new Date(p.dateCreation).toLocaleString("fr-FR")}</td>
                      <td>{formaterMontant(p.montant)} {devise}</td>
                      <td>{p.mode ? libelleModeReglement(p.mode) : "—"}</td>
                    </tr>
                  ))}
                  {credit.paiements.length === 0 && (
                    <tr>
                      <td colSpan={3} className="liste-vide">
                        Aucun règlement.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, credit.paiements.length)) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p className="note-aide">Cliquez sur un règlement pour voir ou imprimer son reçu.</p>
              <div className="totaux">
                <div>
                  Montant : {formaterMontant(credit.montant)} {devise} · Payé : {formaterMontant(credit.montantPaye)} {devise}
                </div>
                <div className="total-net">
                  Solde : {formaterMontant(solde)} {devise}
                </div>
              </div>
            </div>
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
  const [pageClient, setPageClient] = useState<"achats" | "credits" | "compte">("achats");
  const devise = useDevise();
  // Chiffres du client : totaux du service (toutes ses ventes), pas seulement les 50 affichées.
  const panierMoyen = infos.nombreAchats > 0 ? Math.round(infos.totalAchats / infos.nombreAchats) : 0;
  const soldeDu = credits.filter((c) => c.statut !== "solde").reduce((t, c) => t + c.solde, 0);
  function ecrire() {
    const numero = (infos.telephone ?? "").replace(/\D/g, "");
    if (!numero) return;
    ((url: string) => api.systeme.ouvrirExterne(url))(`https://wa.me/${numero}?text=${encodeURIComponent(`Bonjour ${infos.nom}, `)}`);
  }

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
      <div className="modale-avec-menu">
        <nav className="menu-modale">
          <button
            type="button"
            className={pageClient === "achats" ? "actif" : ""}
            onClick={() => setPageClient("achats")}
          >
            <span className="icone-menu-modale">🛒</span>
            Historique des achats
            <span className="compteur-menu-modale">{ventes.length}</span>
          </button>
          <button
            type="button"
            className={pageClient === "credits" ? "actif" : ""}
            onClick={() => setPageClient("credits")}
          >
            <span className="icone-menu-modale">💳</span>
            Crédits
            <span className="compteur-menu-modale">{credits.length}</span>
          </button>
          <button
            type="button"
            className={pageClient === "compte" ? "actif" : ""}
            onClick={() => setPageClient("compte")}
          >
            <span className="icone-menu-modale">📄</span>
            Compte
          </button>
        </nav>
      <div className="modale-corps">
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">🛒 Total acheté</span>
          <strong className="nowrap">
            {formaterMontant(infos.totalAchats)} {devise}
          </strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">🧾 Achats</span>
          <strong>{infos.nombreAchats}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">🧺 Panier moyen</span>
          <strong className="nowrap">
            {formaterMontant(panierMoyen)} {devise}
          </strong>
        </div>
        <div className={`tuile-fiche${soldeDu > 0 ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">💳 Solde dû</span>
          <strong className="nowrap">
            {formaterMontant(soldeDu)} {devise}
          </strong>
        </div>
      </div>
      {erreurInfos && <div className="message-erreur">{erreurInfos}</div>}
      {modifierInfos ? (
      <div className="zone-tableau-scroll zone-infos-client">
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
      ) : (
        <div className="fiche-infos-produit">
          <div>
            <span className="sous-info">Téléphone</span>
            <strong>{infos.telephone || "—"}</strong>
          </div>
          <div className="fiche-infos-description">
            <span className="sous-info">Adresse</span>
            <strong>{infos.adresse || "—"}</strong>
          </div>
          <div>
            <span className="sous-info">Client depuis</span>
            <strong>{infos.dateCreation ? new Date(infos.dateCreation).toLocaleDateString("fr-FR") : "—"}</strong>
          </div>
          <span className="actions-ligne">
            {infos.telephone && (
              <button type="button" onClick={ecrire}>
                📲 WhatsApp
              </button>
            )}
            {peutGerer && (
              <button type="button" onClick={() => setModifierInfos(true)}>
                ✎ Modifier
              </button>
            )}
          </span>
        </div>
      )}


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
              <td title={new Date(v.dateCreation).toLocaleString("fr-FR")}>{new Date(v.dateCreation).toLocaleDateString("fr-FR")}</td>
              <td>{v.numero}</td>
              <td>
                <span className={`badge-${v.statut}`}>{libelleStatutVente(v.statut)}</span>
              </td>
              <td className="nowrap">{formaterMontant(v.totalNet)} {devise}</td>
            </tr>
          ))}
          {ventes.length === 0 && (
            <tr>
              <td colSpan={5} className="liste-vide">
                Aucun achat.
              </td>
            </tr>
          )}
          {Array.from({ length: Math.max(0, 10 - Math.max(1, ventes.length)) }).map((_, i) => (
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

      {pageClient === "compte" && (
        <PanneauCompte
          genre="client"
          tiersId={clientId}
          tiersNom={infos.nom}
          telephone={infos.telephone ?? ""}
          session={session}
          classeZone="zone-tableau-scroll-client zone-compte-tiers"
          onModifie={rafraichir}
        />
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
              <td title={new Date(c.dateCreation).toLocaleString("fr-FR")}>{new Date(c.dateCreation).toLocaleDateString("fr-FR")}</td>
              <td>{c.venteNumero ?? ""}</td>
              <td className="nowrap">{formaterMontant(c.montant)} {devise}</td>
              <td className="nowrap">{formaterMontant(c.montantPaye)} {devise}</td>
              <td className="nowrap">
                <strong className={c.statut !== "solde" && c.prochaineEcheance?.enRetard ? "texte-erreur" : undefined}>
                  {formaterMontant(c.solde)} {devise}
                  {c.statut !== "solde" && c.prochaineEcheance?.enRetard && " (en retard)"}
                </strong>
              </td>
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
          {Array.from({ length: Math.max(0, 10 - Math.max(1, credits.length)) }).map((_, i) => (
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
      </div>
    </>
  );
}

const SECTIONS = [
  { cle: "clients", label: "Clients", icone: "👤" },
  { cle: "credits", label: "Crédits", icone: "💳" },
] as const;

export type OngletClients = (typeof SECTIONS)[number]["cle"];

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
  montantInitial: number;
  modeInitial: string;
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
  const [montantInitial, setMontantInitial] = useState("");
  const [modeInitial, setModeInitial] = useState("especes");
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
      { id: crypto.randomUUID(), nom: nom.trim(), telephone: telephone.trim(), adresse: adresse.trim(), montantInitial: Number(montantInitial) || 0, modeInitial },
    ]);
    setNom("");
    setTelephone("");
    setAdresse("");
    setMontantInitial("");
    setModeInitial("especes");
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
        if (ligne.montantInitial > 0) {
          try {
            await enregistrerMontantInitial("client", resultat.resultat, ligne.montantInitial, ligne.modeInitial, session);
          } catch (e) {
            setErreur(`"${ligne.nom}" est enregistré, mais pas son dépôt : ${e instanceof Error ? e.message : "erreur inattendue"}.`);
            return;
          }
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
        <label>
          Dépôt initial
          <span className="champ-montant-initial">
            <ChampMontant placeholder="0" value={montantInitial} onChange={setMontantInitial} onKeyDown={surEntree} />
            <select value={modeInitial} onChange={(e) => setModeInitial(e.target.value)} disabled={!(Number(montantInitial) > 0)}>
              {MODES_MONTANT_INITIAL.map((m) => (
                <option key={m.valeur} value={m.valeur}>
                  {m.label}
                </option>
              ))}
            </select>
          </span>
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
              <th>Dépôt initial</th>
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
                <td className="nowrap">
                  {l.montantInitial > 0 ? `${formaterMontant(l.montantInitial)} · ${libelleModeInitial(l.modeInitial)}` : ""}
                </td>
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

  const [filtre, setFiltre] = useState<"tous" | "credit" | "inactifs">("tous");
  const [tri, setTri] = useState<{ colonne: "nom" | "total" | "dernier" | "solde"; sens: 1 | -1 }>({ colonne: "nom", sens: 1 });
  const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + v, 0);
  /** Jours depuis le dernier achat (null = jamais acheté). */
  const joursDepuis = (iso: string | null) =>
    iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null;
  const inactif = (c: ClientDetailResume) => {
    const j = joursDepuis(c.dernierAchat);
    return j === null || j > 60;
  };
  const clientsVisibles = clientsListe.filter(
    (c) => filtre === "tous" || (filtre === "credit" ? c.soldeCredit > 0 : inactif(c)),
  ).sort((a, b) => {
    if (tri.colonne === "total") return (a.totalAchats - b.totalAchats) * tri.sens;
    if (tri.colonne === "solde") return (a.soldeCredit - b.soldeCredit) * tri.sens;
    if (tri.colonne === "dernier") return (a.dernierAchat ?? "").localeCompare(b.dernierAchat ?? "") * tri.sens;
    return a.nom.localeCompare(b.nom, "fr") * tri.sens;
  });
  const avecCredit = clientsListe.filter((c) => c.soldeCredit > 0);
  const actifs30 = clientsListe.filter((c) => {
    const j = joursDepuis(c.dernierAchat);
    return j !== null && j <= 30;
  }).length;
  const meilleur = [...clientsListe].sort((a, b) => b.totalAchats - a.totalAchats)[0];
  function trierPar(colonne: "nom" | "total" | "dernier" | "solde") {
    setTri((t) => ({ colonne, sens: t.colonne === colonne ? (-t.sens as 1 | -1) : colonne === "nom" ? 1 : -1 }));
  }
  const fleche = (colonne: string) => (tri.colonne === colonne ? (tri.sens === 1 ? " ▲" : " ▼") : "");
  function libelleDernierAchat(iso: string | null) {
    const j = joursDepuis(iso);
    if (j === null) return "Jamais";
    if (j === 0) return "Aujourd'hui";
    return `il y a ${j} jour${j > 1 ? "s" : ""}`;
  }
  function ecrire(c: ClientDetailResume) {
    const numero = (c.telephone ?? "").replace(/\D/g, "");
    if (!numero) return;
    ((url: string) => api.systeme.ouvrirExterne(url))(`https://wa.me/${numero}?text=${encodeURIComponent(`Bonjour ${c.nom}, `)}`);
  }
  const colonnesExport: ColonneExport[] = [
    { cle: "nom", libelle: "Nom" },
    { cle: "telephone", libelle: "Téléphone" },
    { cle: "adresse", libelle: "Adresse" },
    { cle: "total", libelle: `Total acheté (${devise})` },
    { cle: "achats", libelle: "Achats" },
    { cle: "dernier", libelle: "Dernier achat" },
    { cle: "solde", libelle: `Solde dû (${devise})` },
  ];
  const lignesExport = clientsVisibles.map((c) => ({
    nom: c.nom,
    telephone: c.telephone || "",
    adresse: c.adresse || "",
    total: c.totalAchats,
    achats: c.nombreAchats,
    dernier: c.dernierAchat ? new Date(c.dernierAchat).toLocaleDateString("fr-FR") : "",
    solde: c.soldeCredit,
  }));

  return (
    <div className="liste-dettes-credits">
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
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">👥 Clients</span>
          <strong>{clientsListe.length}</strong>
        </div>
        <div className={`tuile-fiche${avecCredit.length > 0 ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">💳 Doivent de l'argent</span>
          <strong className="nowrap">
            {avecCredit.length} · {formaterMontant(somme(avecCredit.map((c) => c.soldeCredit)))} {devise}
          </strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">🛒 Venus ces 30 jours</span>
          <strong>{actifs30}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">🏆 Meilleur client</span>
          <strong>
            {meilleur && meilleur.totalAchats > 0 ? `${meilleur.nom} (${formaterMontant(meilleur.totalAchats)} ${devise})` : "—"}
          </strong>
        </div>
      </div>
      <div className="barre-actions barre-actions-avec-onglets barre-filtres-historique">
        <input className="champ-recherche" placeholder="Rechercher par nom ou téléphone…" value={terme} onChange={(e) => setTerme(e.target.value)} />
        <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
          <option value="tous">Tous les clients</option>
          <option value="credit">Avec crédit en cours</option>
          <option value="inactifs">Inactifs (plus de 60 jours)</option>
        </select>
        <span className="actions-ligne">
          <BoutonsExport titre="Clients" colonnes={colonnesExport} lignes={lignesExport} compact />
          {peutGerer && (
            <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)}>
              + Nouveau client
            </button>
          )}
        </span>
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
              <th className="th-triable" onClick={() => trierPar("nom")}>
                Nom{fleche("nom")}
              </th>
              <th>Téléphone</th>
              <th>Adresse</th>
              <th className="th-triable" onClick={() => trierPar("total")}>
                Total acheté{fleche("total")}
              </th>
              <th>Achats</th>
              <th className="th-triable" onClick={() => trierPar("dernier")}>
                Dernier achat{fleche("dernier")}
              </th>
              <th className="th-triable" onClick={() => trierPar("solde")}>
                Solde dû{fleche("solde")}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clientsVisibles.map((c, index) => (
              <tr key={c.id} onClick={() => setClientSelectionne(c)} title="Ouvrir la fiche du client">
                <td>{index + 1}</td>
                <td>{c.nom}</td>
                <td>{c.telephone || "—"}</td>
                <td>{c.adresse || "—"}</td>
                <td className="nowrap">
                  {formaterMontant(c.totalAchats)} {devise}
                </td>
                <td>{c.nombreAchats}</td>
                <td className="nowrap" title={c.dernierAchat ? new Date(c.dernierAchat).toLocaleDateString("fr-FR") : undefined}>
                  <span className={inactif(c) ? "sous-info" : undefined}>{libelleDernierAchat(c.dernierAchat)}</span>
                </td>
                <td>
                  {c.soldeCredit > 0 ? (
                    <span className="badge-solde-du nowrap">
                      {formaterMontant(c.soldeCredit)} {devise}
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <span className="actions-ligne">
                    {c.telephone && (
                      <button type="button" className="lien-icone" title="Écrire sur WhatsApp" onClick={() => ecrire(c)}>
                        📲
                      </button>
                    )}
                    {peutGerer && (
                      <>
                        <button type="button" className="lien-icone" title="Modifier" onClick={() => setClientSelectionne(c)}>
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
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {clientsVisibles.length === 0 && (
              <tr>
                <td colSpan={9} className="liste-vide">
                  {clientsListe.length === 0 ? "Aucun client." : "Aucun client pour ces filtres."}
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, clientsVisibles.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                {Array.from({ length: 9 }).map((_, j) => (
                  <td key={j}>&nbsp;</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {clientsVisibles.length > 0 && (
        <div className="totaux">
          <div>
            {clientsVisibles.length} client{clientsVisibles.length > 1 ? "s" : ""} · acheté :{" "}
            {formaterMontant(somme(clientsVisibles.map((c) => c.totalAchats)))} {devise}
          </div>
          <div className="total-net">
            Solde dû : {formaterMontant(somme(clientsVisibles.map((c) => c.soldeCredit)))} {devise}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Onglet Crédits (carnet global) ---

function OngletCredits({
  session,
  statutInitial,
}: {
  session: Session;
  statutInitial?: StatutCredit | "";
}) {
  const devise = useDevise();
  const [statut, setStatut] = useState<StatutCredit | "">(statutInitial ?? "en_cours");
  // Les crédits de clients réguliers et de clients de passage ne doivent
  // jamais se mélanger dans la même vue (mémoire projet "clients permanents
  // vs occasionnels") : tuiles, liste et totaux portent sur le type choisi.
  const [typeClient, setTypeClient] = useState<"reguliers" | "occasionnels">("reguliers");
  const [clientNom, setClientNom] = useState("");
  const [recherche, setRecherche] = useState("");
  const [credits, setCredits] = useState<CreditResume[]>([]);
  const [regleMois, setRegleMois] = useState(0);
  const [creditSelectionneId, setCreditSelectionneId] = useState<string | null>(null);
  const [vue, setVue] = useState<"credits" | "clients">("credits");
  const [messageRelance, setMessageRelance] = useState<{ ok: boolean; texte: string } | null>(null);

  async function rafraichir() {
    setCredits(await api.credits.lister(session.boutiqueId));
    const debutMois = new Date();
    debutMois.setDate(1);
    debutMois.setHours(0, 0, 0, 0);
    setRegleMois(await api.credits.regleDepuis(session.boutiqueId, debutMois.toISOString()));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enCoursParType = (regulier: boolean) =>
    credits.filter((c) => c.statut === "en_cours" && !!c.clientEstPermanent === regulier).length;
  const duType = credits.filter((c) => (typeClient === "reguliers" ? !!c.clientEstPermanent : !c.clientEstPermanent));
  const enCours = duType.filter((c) => c.statut === "en_cours");
  const enRetard = enCours.filter((c) => c.prochaineEcheance?.enRetard).length;
  const clientsListe = [...new Set(duType.map((c) => c.clientNom))].sort((a, b) => a.localeCompare(b, "fr"));
  const cle = recherche.trim().toLowerCase();
  // Les crédits en retard d'abord, puis les plus anciens.
  const creditsFiltres = duType
    .filter(
      (c) =>
        (!statut || c.statut === statut) &&
        (!clientNom || c.clientNom === clientNom) &&
        (!cle || (c.venteNumero ?? "").toLowerCase().includes(cle)),
    )
    .sort(
      (a, b) =>
        Number(!!b.prochaineEcheance?.enRetard) - Number(!!a.prochaineEcheance?.enRetard) ||
        a.dateCreation.localeCompare(b.dateCreation),
    );
  const pourcentage = (c: CreditResume) =>
    c.montant > 0 ? Math.min(100, Math.round((c.montantPaye / c.montant) * 100)) : 100;
  const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + v, 0);
  const anciennete = (dateIso: string) => Math.max(0, Math.floor((Date.now() - new Date(dateIso).getTime()) / 86_400_000));

  /** Relance WhatsApp préparée (le message s'ouvre dans WhatsApp) et tracée dans Messages. */
  async function relancer(c: CreditResume) {
    setMessageRelance(null);
    const numero = c.clientTelephone.replace(/\D/g, "");
    if (!numero) {
      setMessageRelance({ ok: false, texte: `Pas de numéro de téléphone pour ${c.clientNom} : ajoutez-le dans sa fiche.` });
      return;
    }
    const texte =
      `Bonjour ${c.clientNom}, petit rappel de ${session.boutiqueNom} : il reste ${formaterMontant(c.solde)} ${devise} ` +
      `à régler pour votre achat du ${new Date(c.dateCreation).toLocaleDateString("fr-FR")}` +
      (c.prochaineEcheance
        ? `, prochaine échéance le ${new Date(`${c.prochaineEcheance.date}T00:00:00`).toLocaleDateString("fr-FR")} ` +
          `(${formaterMontant(c.prochaineEcheance.reste)} ${devise})`
        : "") +
      ". Merci !";
    await api.systeme.ouvrirExterne(`https://wa.me/${numero}?text=${encodeURIComponent(texte)}`);
    await api.messages.enregistrerRelanceCredit(c.id, c.clientTelephone, texte, session.utilisateurId);
    setMessageRelance({ ok: true, texte: `Relance WhatsApp préparée pour ${c.clientNom} (trace dans Messages).` });
  }

  // Vue « par client » : une ligne par client (sur les crédits affichés).
  const parClient = [
    ...creditsFiltres
      .reduce((groupes, c) => groupes.set(c.clientNom, [...(groupes.get(c.clientNom) ?? []), c]), new Map<string, CreditResume[]>())
      .entries(),
  ]
    .map(([nom, liste]) => {
      const echeances = liste.map((c) => c.prochaineEcheance).filter((e): e is NonNullable<typeof e> => !!e);
      const prochaine = echeances.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
      return {
        nom,
        nombre: liste.length,
        du: somme(liste.map((c) => c.solde)),
        plusAncien: liste.reduce((p, c) => (!p || c.dateCreation < p ? c.dateCreation : p), ""),
        prochaine,
        enRetard: liste.some((c) => c.prochaineEcheance?.enRetard),
      };
    })
    .sort((a, b) => Number(b.enRetard) - Number(a.enRetard) || b.du - a.du);

  return (
    <div className="modale-avec-menu">
      <nav className="menu-modale">
        <button
          type="button"
          className={typeClient === "reguliers" ? "actif" : ""}
          onClick={() => {
            setTypeClient("reguliers");
            setClientNom("");
          }}
        >
          <span className="icone-menu-modale">👥</span>
          Clients réguliers
          <span className="compteur-menu-modale">{enCoursParType(true)}</span>
        </button>
        <button
          type="button"
          className={typeClient === "occasionnels" ? "actif" : ""}
          onClick={() => {
            setTypeClient("occasionnels");
            setClientNom("");
          }}
        >
          <span className="icone-menu-modale">🚶</span>
          Clients de passage
          <span className="compteur-menu-modale">{enCoursParType(false)}</span>
        </button>
      </nav>
      <div className="modale-corps">
    <div className="liste-dettes-credits">
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
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">💰 Total dû</span>
          <strong>
            {formaterMontant(somme(enCours.map((c) => c.solde)))} {devise}
          </strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">📄 Crédits en cours</span>
          <strong>{enCours.length}</strong>
        </div>
        <div className={`tuile-fiche${enRetard > 0 ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">🔴 En retard</span>
          <strong>{enRetard}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">✅ Réglé ce mois (tous clients)</span>
          <strong>
            {formaterMontant(regleMois)} {devise}
          </strong>
        </div>
      </div>
      <div className="barre-actions barre-filtres-historique">
        <select value={statut} onChange={(e) => setStatut(e.target.value as StatutCredit | "")}>
          <option value="en_cours">En cours</option>
          <option value="solde">Soldés</option>
          <option value="">Tous</option>
        </select>
        <select value={clientNom} onChange={(e) => setClientNom(e.target.value)}>
          <option value="">Tous les clients</option>
          {clientsListe.map((nom) => (
            <option key={nom} value={nom}>
              {nom}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="N° de vente…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
        <div className="bascule-vue" role="group" aria-label="Affichage">
          <button type="button" className={vue === "credits" ? "actif" : ""} onClick={() => setVue("credits")}>
            📄 Par crédit
          </button>
          <button type="button" className={vue === "clients" ? "actif" : ""} onClick={() => setVue("clients")}>
            👤 Par client
          </button>
        </div>
      </div>
      {messageRelance && (
        <div className={messageRelance.ok ? "message-succes" : "message-erreur"}>{messageRelance.texte}</div>
      )}
      {vue === "clients" ? (
        <div className="zone-tableau-scroll">
          <table className="tableau-catalogue tableau-serre">
            <thead>
              <tr>
                <th>N°</th>
                <th>Client</th>
                <th>Crédits</th>
                <th>Total dû</th>
                <th>Plus ancien</th>
                <th>Prochaine échéance</th>
              </tr>
            </thead>
            <tbody>
              {parClient.map((g, index) => (
                <tr
                  key={g.nom}
                  onClick={() => {
                    setClientNom(g.nom);
                    setVue("credits");
                  }}
                  title="Voir les crédits de ce client"
                >
                  <td>{index + 1}</td>
                  <td><strong>{g.nom}</strong></td>
                  <td>{g.nombre}</td>
                  <td><strong className="nowrap">{formaterMontant(g.du)} {devise}</strong></td>
                  <td><span className="nowrap">{new Date(g.plusAncien).toLocaleDateString("fr-FR")} · {anciennete(g.plusAncien)} j</span></td>
                  <td>{g.prochaine ? (
                      <span className={g.enRetard ? "texte-erreur nowrap" : "nowrap"}>
                        {new Date(`${g.prochaine.date}T00:00:00`).toLocaleDateString("fr-FR")} · {formaterMontant(g.prochaine.reste)}
                        {g.enRetard && " (en retard)"}
                      </span>
                    ) : (
                      "—"
                    )}</td>
                </tr>
              ))}
              {parClient.length === 0 && (
                <tr>
                  <td colSpan={6} className="liste-vide">
                    Aucun crédit pour ces filtres.
                  </td>
                </tr>
              )}
              {Array.from({ length: Math.max(0, 10 - Math.max(1, parClient.length)) }).map((_, i) => (
                <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
      ) : (
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue tableau-serre">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date d'achat</th>
              <th>Client</th>
              <th>Montant</th>
              <th>Réglé</th>
              <th>Reste</th>
              <th>Prochaine échéance</th>
              <th>Statut</th>
              <th className="colonne-relance" />
            </tr>
          </thead>
          <tbody>
            {creditsFiltres.map((c, index) => (
              <tr key={c.id} onClick={() => setCreditSelectionneId(c.id)} title="Voir le crédit">
                  <td>{index + 1}</td>
                  <td>
                    {new Date(c.dateCreation).toLocaleDateString("fr-FR")}
                    {c.statut === "en_cours" && (
                      <span className={`sous-info nowrap${anciennete(c.dateCreation) > 60 ? " texte-erreur" : ""}`}>
                        <br />
                        il y a {anciennete(c.dateCreation)} jours
                      </span>
                    )}
                  </td>
                  <td>
                    {c.clientNom}
                    {c.venteNumero && (
                      <span className="sous-info nowrap">
                        <br />
                        {c.venteNumero}
                      </span>
                    )}
                  </td>
                  <td><span className="nowrap">{formaterMontant(c.montant)} {devise}</span></td>
                  <td><span className="mini-progression">
                    <span className="barre-progression">
                      <span style={{ width: `${pourcentage(c)}%` }} />
                    </span>
                    <span className="sous-info">{pourcentage(c)} %</span>
                  </span></td>
                  <td><strong className="nowrap">{formaterMontant(c.solde)} {devise}</strong></td>
                  <td>{c.prochaineEcheance ? (
                    <span className={c.prochaineEcheance.enRetard ? "texte-erreur nowrap" : "nowrap"}>
                      {new Date(`${c.prochaineEcheance.date}T00:00:00`).toLocaleDateString("fr-FR")} ·{" "}
                      {formaterMontant(c.prochaineEcheance.reste)}
                      {c.prochaineEcheance.enRetard && " (en retard)"}
                    </span>
                  ) : (
                    "—"
                  )}</td>
                  <td><span className={`nowrap ${c.statut === "solde" ? "badge-payee" : "badge-credit"}`}>
                    {libelleStatutCredit(c.statut)}
                  </span></td>
                  <td className="colonne-relance">{c.statut === "en_cours" && (
                    <button
                      type="button"
                      className="lien-icone"
                      title="Relancer par WhatsApp"
                      onClick={(e) => {
                        e.stopPropagation();
                        relancer(c);
                      }}
                    >
                      📲
                    </button>
                  )}</td>
              </tr>
            ))}
            {creditsFiltres.length === 0 && (
              <tr>
                <td colSpan={9} className="liste-vide">
                  Aucun crédit pour ces filtres.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, creditsFiltres.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
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
      {vue === "clients" && parClient.length > 0 && (
        <div className="totaux">
          <div>
            {parClient.length} client{parClient.length > 1 ? "s" : ""} · {creditsFiltres.length} crédit(s)
          </div>
          <div className="total-net">
            Total dû : {formaterMontant(somme(parClient.map((g) => g.du)))} {devise}
          </div>
        </div>
      )}
      {vue === "credits" && creditsFiltres.length > 0 && (
        <div className="totaux">
          <div>
            {creditsFiltres.length} crédit{creditsFiltres.length > 1 ? "s" : ""} · Montant :{" "}
            {formaterMontant(somme(creditsFiltres.map((c) => c.montant)))} {devise} · Réglé :{" "}
            {formaterMontant(somme(creditsFiltres.map((c) => c.montantPaye)))} {devise}
          </div>
          <div className="total-net">
            Reste : {formaterMontant(somme(creditsFiltres.map((c) => c.solde)))} {devise}
          </div>
        </div>
      )}
    </div>
      </div>
    </div>
  );
}

// --- Page principale ---
// Chaque section (Clients / Crédits) est un bouton-carte qui ouvre sa propre
// modale, même patron que Comptabilite.tsx/Rapports.tsx/Reglages.tsx.

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

function ModaleCredits({
  session, statutInitial, onFermer,
}: { session: Session; statutInitial?: StatutCredit | ""; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Crédits" onFermer={onFermer} />
        <OngletCredits session={session} statutInitial={statutInitial} />
      </div>
    </div>
  );
}

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

export default function Clients({
  session,
  ongletInitial,
  statutCreditsInitial,
}: {
  session: Session;
  ongletInitial?: OngletClients;
  statutCreditsInitial?: StatutCredit | "";
}) {
  const [sectionOuverte, setSectionOuverte] = useState<OngletClients | null>(ongletInitial ?? null);

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
        <ModaleCredits session={session} statutInitial={statutCreditsInitial} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
