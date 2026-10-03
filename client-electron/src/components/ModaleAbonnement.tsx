import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  AbonnementDetail,
  BoutiqueDetail,
  DeclarationPaiementAbonnement,
  EtatAbonnement,
  Session,
} from "../api/client";
import { formaterMontant } from "../lib/formatage";

/** Accès aux données (seule partie qui diffère entre le bureau et le web). */
const donnees = {
  boutique: (session: Session): Promise<BoutiqueDetail | undefined> => api.reglages.obtenirBoutique(session.boutiqueId),
  etat: (session: Session): Promise<EtatAbonnement> => api.abonnement.etat(session.boutiqueId),
  detail: async (session: Session): Promise<AbonnementDetail> => {
    const resultat = await api.comptes.abonnementBoutique(session);
    if (!resultat.succes) throw new Error(resultat.message);
    return resultat.resultat;
  },
  declarer: async (session: Session, declaration: DeclarationPaiementAbonnement): Promise<void> => {
    const resultat = await api.comptes.declarerPaiementAbonnement(session, declaration);
    if (!resultat.succes) throw new Error(resultat.message);
  },
  ouvrirLien: (url: string) => api.systeme.ouvrirExterne(url),
};

// --- Fenêtre « Abonnement » : où en est l'abonnement, comment le renouveler, historique ---
// Ouverte depuis le bandeau de fin d'abonnement, les notifications « Abonnement »
// et la carte « ⭐ Abonnement » des Informations boutique.

const LIBELLES_FORMULE: Record<string, string> = { essentiel: "Essentiel", pro: "Pro" };

const OPERATEURS = [
  { valeur: "wave", libelle: "Wave" },
  { valeur: "orange_money", libelle: "Orange Money" },
  { valeur: "mtn", libelle: "MTN Mobile Money" },
  { valeur: "moov", libelle: "Moov Money" },
];

const CLASSES_STATUT: Record<string, string> = {
  en_attente: "badge-brouillon",
  validee: "badge-recue",
  rejetee: "badge-annulee",
};

interface DeclarationSaisie {
  formule: string;
  dureeMois: string;
  montant: string;
  mode: string;
  reference: string;
}

function date(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "";
}

function texteEtat(etat: EtatAbonnement | null): { texte: string; classe?: string } {
  if (!etat || !etat.dateExpiration) return { texte: "Sans limite" };
  const jours = etat.joursRestants ?? 0;
  if (etat.niveau === "ok") return { texte: `Actif, jusqu'au ${date(etat.dateExpiration)}` };
  if (etat.niveau === "bientot") {
    const quand = jours <= 0 ? "aujourd'hui" : jours === 1 ? "demain" : `dans ${jours} jours`;
    return { texte: `Se termine le ${date(etat.dateExpiration)} (${quand})`, classe: "texte-avertissement" };
  }
  if (etat.niveau === "grace") {
    return { texte: `Expiré le ${date(etat.dateExpiration)} — vente possible jusqu'au ${date(etat.finGrace)}`, classe: "texte-erreur" };
  }
  return { texte: `Expiré : vente bloquée depuis le ${date(etat.finGrace)}`, classe: "texte-erreur" };
}

export default function ModaleAbonnement({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const [boutique, setBoutique] = useState<BoutiqueDetail | null>(null);
  const [etat, setEtat] = useState<EtatAbonnement | null>(null);
  const [detail, setDetail] = useState<AbonnementDetail | null>(null);
  const [erreurDetail, setErreurDetail] = useState<string | null>(null);
  const responsable = !!session.permissions.gerer_utilisateurs_reglages;
  const [declaration, setDeclaration] = useState<DeclarationSaisie | null>(null);
  const [erreurDeclaration, setErreurDeclaration] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  function chargerDetail() {
    donnees
      .detail(session)
      .then(setDetail)
      .catch(() => setErreurDetail("Historique et coordonnées de paiement disponibles en ligne uniquement : vérifiez votre connexion."));
  }

  useEffect(() => {
    donnees.boutique(session).then((b) => setBoutique(b ?? null));
    donnees.etat(session).then(setEtat).catch(() => {});
    if (responsable) chargerDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, responsable]);

  function prixTarif(formule: string, dureeMois: string): string {
    const tarif = detail?.tarifs.find((t) => t.formule === formule && String(t.duree_mois) === dureeMois);
    return tarif ? String(Number(tarif.prix)) : "";
  }

  function changerDeclaration(champs: Partial<DeclarationSaisie>) {
    if (!declaration) return;
    const suivante = { ...declaration, ...champs };
    if (("formule" in champs || "dureeMois" in champs) && detail?.tarifs.length) {
      suivante.montant = prixTarif(suivante.formule, suivante.dureeMois);
    }
    setDeclaration(suivante);
  }

  async function declarer() {
    if (!declaration) return;
    setErreurDeclaration(null);
    if (!(Number(declaration.montant) > 0)) return setErreurDeclaration("Indiquez le montant envoyé.");
    if (!declaration.mode) return setErreurDeclaration("Indiquez par quel opérateur vous avez payé.");
    if (!declaration.reference.trim()) {
      return setErreurDeclaration("Indiquez la référence de la transaction (reçue par SMS).");
    }
    setEnvoi(true);
    try {
      await donnees.declarer(session, {
        formule: declaration.formule,
        dureeMois: Number(declaration.dureeMois),
        montant: Number(declaration.montant),
        mode: declaration.mode,
        reference: declaration.reference.trim(),
      });
      setDeclaration(null);
      setMessage("✅ Paiement déclaré. Votre abonnement sera prolongé dès sa vérification.");
      chargerDetail();
    } catch (e) {
      setErreurDeclaration(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setEnvoi(false);
    }
  }

  const formule = LIBELLES_FORMULE[boutique?.formule ?? ""] ?? boutique?.formule ?? "";
  const etatAffiche = texteEtat(etat);
  const renouvellement = detail?.renouvellement;
  const messageWhatsApp =
    `Bonjour, je souhaite renouveler l'abonnement de la boutique ${boutique?.nom ?? session.boutiqueNom}` +
    ` (formule ${formule}${etat?.dateExpiration ? `, échéance du ${date(etat.dateExpiration)}` : ""}).`;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>⭐ Abonnement</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps modale-abonnement">
          <div className="resume-abonnement">
            <section className="carte-profil">
              <h4>Formule</h4>
              <p className="valeur-abonnement">{formule}</p>
            </section>
            <section className="carte-profil">
              <h4>État</h4>
              <p className={`valeur-abonnement ${etatAffiche.classe ?? ""}`}>{etatAffiche.texte}</p>
            </section>
          </div>

          {!responsable && (
            <p className="note-aide">Pour renouveler l'abonnement, prévenez le responsable de la boutique.</p>
          )}
          {erreurDetail && <div className="bloc-hors-ligne">🌐 {erreurDetail}</div>}

          {renouvellement && (
            <section className="carte-profil renouveler-abonnement">
              <h4>Pour renouveler</h4>
              {renouvellement.instructions && <p className="instructions-abonnement">{renouvellement.instructions}</p>}
              {renouvellement.numeros.length > 0 && (
                <dl>
                  {renouvellement.numeros.map((n) => (
                    <div key={n.operateur} className="ligne-numero-abonnement">
                      <dt>{n.operateur}</dt>
                      <dd>
                        <strong>{n.numero}</strong>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {renouvellement.whatsapp ? (
                <button
                  type="button"
                  className="bouton-primaire"
                  onClick={() =>
                    donnees.ouvrirLien(
                      `https://wa.me/${renouvellement.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(messageWhatsApp)}`,
                    )
                  }
                >
                  💬 Demander le renouvellement sur WhatsApp
                </button>
              ) : (
                renouvellement.numeros.length === 0 &&
                !renouvellement.instructions && (
                  <p className="note-aide">Contactez votre fournisseur pour renouveler l'abonnement.</p>
                )
              )}
            </section>
          )}

          {detail && detail.tarifs.length > 0 && (
            <section className="historique-abonnement">
              <h4>Tarifs</h4>
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue tableau-tarifs-abonnement">
                  <thead>
                    <tr>
                      <th>Formule</th>
                      {[1, 3, 6, 12].map((mois) => (
                        <th key={mois}>{mois === 1 ? "1 mois" : `${mois} mois`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {["essentiel", "pro"]
                      .filter((f) => detail.tarifs.some((t) => t.formule === f))
                      .map((f) => (
                        <tr key={f}>
                          <td>
                            <strong>{LIBELLES_FORMULE[f]}</strong>
                          </td>
                          {[1, 3, 6, 12].map((mois) => {
                            const tarif = detail.tarifs.find((t) => t.formule === f && t.duree_mois === mois);
                            return (
                              <td key={mois} className="nowrap">
                                {tarif ? formaterMontant(Number(tarif.prix)) : "—"}
                                {tarif && Number(tarif.remise) > 0 && (
                                  <div className="sous-info">−{Number(tarif.remise)} %</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {message && <div className="message-succes">{message}</div>}
          {detail && !declaration && (
            <button
              type="button"
              className="bouton-primaire bouton-j-ai-paye"
              onClick={() => {
                setMessage(null);
                setErreurDeclaration(null);
                const formule = boutique?.formule || "essentiel";
                setDeclaration({ formule, dureeMois: "1", montant: prixTarif(formule, "1"), mode: "", reference: "" });
              }}
            >
              ✅ J'ai payé : déclarer mon paiement
            </button>
          )}
          {declaration && (
            <section className="carte-profil declaration-paiement">
              <h4>Déclarer mon paiement</h4>
              <p className="note-aide">
                Après avoir envoyé l'argent, saisissez la référence reçue par SMS. Votre abonnement sera prolongé dès la
                vérification du paiement.
              </p>
              {erreurDeclaration && <div className="message-erreur">{erreurDeclaration}</div>}
              <div className="champs-declaration-paiement">
                <label>
                  Formule
                  <select value={declaration.formule} onChange={(e) => changerDeclaration({ formule: e.target.value })}>
                    <option value="essentiel">Essentiel</option>
                    <option value="pro">Pro</option>
                  </select>
                </label>
                <label>
                  Durée
                  <select
                    value={declaration.dureeMois}
                    onChange={(e) => changerDeclaration({ dureeMois: e.target.value })}
                  >
                    <option value="1">1 mois</option>
                    <option value="3">3 mois</option>
                    <option value="6">6 mois</option>
                    <option value="12">12 mois</option>
                  </select>
                </label>
                <label>
                  Montant envoyé
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={declaration.montant}
                    onChange={(e) => setDeclaration({ ...declaration, montant: e.target.value })}
                  />
                </label>
                <label>
                  Payé par
                  <select value={declaration.mode} onChange={(e) => setDeclaration({ ...declaration, mode: e.target.value })}>
                    <option value="">—</option>
                    {OPERATEURS.map((o) => (
                      <option key={o.valeur} value={o.valeur}>
                        {o.libelle}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="champ-reference-paiement">
                  Référence de la transaction
                  <input
                    value={declaration.reference}
                    onChange={(e) => setDeclaration({ ...declaration, reference: e.target.value })}
                    placeholder="ex. MP241003.1530.A12345"
                  />
                </label>
              </div>
              <div className="actions-formulaire">
                <button type="button" className="bouton-primaire" onClick={declarer} disabled={envoi}>
                  {envoi ? "Envoi…" : "Envoyer la déclaration"}
                </button>
                <button type="button" className="lien" onClick={() => setDeclaration(null)}>
                  Annuler
                </button>
              </div>
            </section>
          )}

          {detail && detail.demandes.length > 0 && (
            <section className="historique-abonnement">
              <h4>Paiements déclarés</h4>
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Formule</th>
                      <th>Montant</th>
                      <th>Payé par</th>
                      <th>Référence</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.demandes.map((d, i) => (
                      <tr key={i}>
                        <td>{date(d.date)}</td>
                        <td>
                          {LIBELLES_FORMULE[d.formule] ?? d.formule}, {d.duree_libelle}
                        </td>
                        <td className="nowrap">{formaterMontant(Number(d.montant))}</td>
                        <td>{d.mode_libelle}</td>
                        <td>{d.reference}</td>
                        <td>
                          <span className={`badge ${CLASSES_STATUT[d.statut] ?? ""}`}>{d.statut_libelle}</span>
                          {d.motif_rejet && <div className="sous-info">{d.motif_rejet}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {detail && (
            <section className="historique-abonnement">
              <h4>Historique</h4>
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Nature</th>
                      <th>Formule</th>
                      <th>Période</th>
                      <th>Montant</th>
                      <th>Payé par</th>
                      <th>Référence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.historique.map((p, i) => (
                      <tr key={i}>
                        <td>{date(p.date)}</td>
                        <td>{p.nature_libelle}</td>
                        <td>{LIBELLES_FORMULE[p.formule] ?? p.formule}</td>
                        <td className="nowrap">
                          {date(p.date_debut)} → {p.date_fin ? date(p.date_fin) : "sans limite"}
                        </td>
                        <td className="nowrap">{Number(p.montant) > 0 ? formaterMontant(Number(p.montant)) : "—"}</td>
                        <td>{p.mode_libelle || "—"}</td>
                        <td>{p.reference || "—"}</td>
                      </tr>
                    ))}
                    {detail.historique.length === 0 && (
                      <tr>
                        <td colSpan={7} className="liste-vide">
                          Aucun renouvellement enregistré pour l'instant.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
