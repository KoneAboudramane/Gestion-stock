import { type FormEvent, useState } from "react";

import { api, ErreurApi } from "../api";
import CodeActivation from "../composants/CodeActivation";
import { BadgeAbonnement, Chargement, Erreur, Info, Modale } from "../composants/Commun";
import { date, dateHeure, montant } from "../format";
import type { BoutiqueCourte, PaiementDeclare, Registre } from "../types";
import { useChargement } from "../useChargement";

type Onglet = "declares" | "registre" | "enregistrer";

const MODES = [
  { valeur: "wave", libelle: "Wave" },
  { valeur: "orange_money", libelle: "Orange Money" },
  { valeur: "mtn", libelle: "MTN Mobile Money" },
  { valeur: "moov", libelle: "Moov Money" },
  { valeur: "especes", libelle: "Espèces" },
  { valeur: "banque", libelle: "Banque" },
  { valeur: "autre", libelle: "Autre" },
];

export default function Paiements() {
  const [onglet, setOnglet] = useState<Onglet>("declares");
  return (
    <div className="pile">
      <div className="onglets" role="tablist">
        {(
          [
            ["declares", "📥 Déclarés dans l'appli"],
            ["registre", "📒 Registre"],
            ["enregistrer", "➕ Enregistrer un paiement"],
          ] as [Onglet, string][]
        ).map(([id, libelle]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={onglet === id}
            className={`onglet${onglet === id ? " actif" : ""}`}
            onClick={() => setOnglet(id)}
          >
            {libelle}
          </button>
        ))}
      </div>
      {onglet === "declares" && <Declares />}
      {onglet === "registre" && <RegistreAbonnements />}
      {onglet === "enregistrer" && <Enregistrer />}
    </div>
  );
}

// --- Paiements déclarés --------------------------------------------------------

function Declares() {
  const [statut, setStatut] = useState("en_attente");
  const [ouvert, setOuvert] = useState<PaiementDeclare | null>(null);
  const { donnees, erreur, enCours, recharger } = useChargement(
    () => api<PaiementDeclare[]>(`/admin/paiements/declares/?statut=${statut}`),
    [statut],
  );

  return (
    <>
      <p className="aide">
        Le commerçant a envoyé l'argent par Mobile Money et saisi la référence dans l'appli. Vérifiez la transaction sur
        votre téléphone avant de valider : la période s'ajoute alors à la fin de son abonnement en cours.
      </p>
      <div className="pilules">
        {[
          ["en_attente", "À vérifier"],
          ["validee", "Validés"],
          ["rejetee", "Rejetés"],
          ["tous", "Tous"],
        ].map(([v, l]) => (
          <button key={v} type="button" className={`pilule${statut === v ? " active" : ""}`} onClick={() => setStatut(v)}>
            {l}
          </button>
        ))}
      </div>
      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {enCours && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            {donnees.length === 0 ? (
              <p className="vide">{statut === "en_attente" ? "Aucun paiement à vérifier. 🎉" : "Aucun paiement."}</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Déclaré le</th>
                      <th>Boutique</th>
                      <th>Formule</th>
                      <th className="nombre">Montant</th>
                      <th>Mode</th>
                      <th>Référence</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.map((p) => (
                      <tr key={p.id} className="ligne-cliquable" onClick={() => setOuvert(p)}>
                        <td>{dateHeure(p.date)}</td>
                        <td>
                          <strong>{p.boutique.nom}</strong>
                          <small className="sous-ligne">{p.demandeur}</small>
                        </td>
                        <td>
                          {p.formule_libelle} · {p.duree_libelle}
                        </td>
                        <td className="nombre">{montant(p.montant)}</td>
                        <td>{p.mode_libelle}</td>
                        <td>
                          <code>{p.reference}</code>
                        </td>
                        <td>
                          <span className={`badge ${{ en_attente: "badge-orange", validee: "badge-vert", rejetee: "badge-gris" }[p.statut]}`}>
                            {p.statut_libelle}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      )}
      {ouvert && (
        <TraiterDeclare
          paiement={ouvert}
          surFermer={() => setOuvert(null)}
          surTraite={() => {
            setOuvert(null);
            void recharger();
          }}
        />
      )}
    </>
  );
}

function TraiterDeclare({
  paiement,
  surFermer,
  surTraite,
}: {
  paiement: PaiementDeclare;
  surFermer: () => void;
  surTraite: () => void;
}) {
  const [motif, setMotif] = useState("Transaction introuvable : vérifiez la référence et renvoyez la demande.");
  const [rejet, setRejet] = useState(false);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function traiter(action: "valider" | "rejeter") {
    if (action === "valider" && !window.confirm(`Confirmer avoir reçu ${montant(paiement.montant)} (réf. ${paiement.reference}) ?`)) return;
    setEnCours(true);
    setErreur("");
    try {
      await api(`/admin/paiements/declares/${paiement.id}/`, {
        method: "POST",
        body: JSON.stringify(action === "valider" ? { action } : { action, motif }),
      });
      surTraite();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Modale titre={`Paiement de ${paiement.boutique.nom}`} surFermer={surFermer}>
      <div className="pile">
        <section className="carte">
          <dl className="infos infos-ligne">
            <Info libelle="Montant">
              <strong>{montant(paiement.montant)}</strong>
            </Info>
            <Info libelle="Mode">{paiement.mode_libelle}</Info>
            <Info libelle="Référence">
              <code className="reference">{paiement.reference}</code>
            </Info>
            <Info libelle="Formule">
              {paiement.formule_libelle} · {paiement.duree_libelle}
            </Info>
            <Info libelle="Déclaré le">{dateHeure(paiement.date)}</Info>
            <Info libelle="Par">{paiement.demandeur}</Info>
          </dl>
          {paiement.note && <p className="aide">Note du commerçant : {paiement.note}</p>}
        </section>
        <section className="carte">
          <h3>Abonnement actuel</h3>
          <dl className="infos infos-ligne">
            <Info libelle="Fin">{date(paiement.boutique.date_expiration_abonnement)}</Info>
            <Info libelle="État">
              <BadgeAbonnement etat={paiement.boutique.abonnement} />
            </Info>
          </dl>
        </section>

        {paiement.statut === "en_attente" ? (
          <section className="carte">
            {rejet && (
              <label className="champ-plein">
                Motif du rejet (montré au commerçant)
                <input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={255} />
              </label>
            )}
            {erreur && <Erreur message={erreur} />}
            <div className="actions">
              {rejet ? (
                <>
                  <button type="button" className="bouton-secondaire" onClick={() => setRejet(false)} disabled={enCours}>
                    Annuler
                  </button>
                  <button type="button" className="bouton-danger" onClick={() => traiter("rejeter")} disabled={enCours || !motif.trim()}>
                    Confirmer le rejet
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="bouton-danger" onClick={() => setRejet(true)} disabled={enCours}>
                    Rejeter
                  </button>
                  <button type="button" className="bouton-principal" onClick={() => traiter("valider")} disabled={enCours}>
                    {enCours ? "Enregistrement…" : "✓ Paiement reçu, valider"}
                  </button>
                </>
              )}
            </div>
          </section>
        ) : (
          <p className="aide">
            {paiement.statut_libelle} le {dateHeure(paiement.date_traitement)}
            {paiement.traitee_par && ` par ${paiement.traitee_par}`}
            {paiement.motif_rejet && ` — motif : ${paiement.motif_rejet}`}.
          </p>
        )}
      </div>
    </Modale>
  );
}

// --- Registre ------------------------------------------------------------------

function premierDuMois(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function RegistreAbonnements() {
  const [du, setDu] = useState(premierDuMois());
  const [au, setAu] = useState("");
  const [nature, setNature] = useState("");
  const [boutique, setBoutique] = useState("");
  const boutiques = useChargement(() => api<{ id: string; nom: string }[]>("/admin/paiements/boutiques/"));
  const { donnees, erreur, enCours, recharger } = useChargement(
    () => api<Registre>(`/admin/paiements/registre/?${new URLSearchParams({ du, au, nature, boutique })}`),
    [du, au, nature, boutique],
  );

  return (
    <>
      <div className="barre-filtres ligne-champs">
        <label>
          Du
          <input type="date" value={du} onChange={(e) => setDu(e.target.value)} />
        </label>
        <label>
          Au
          <input type="date" value={au} onChange={(e) => setAu(e.target.value)} />
        </label>
        <label>
          Nature
          <select value={nature} onChange={(e) => setNature(e.target.value)}>
            <option value="">Toutes</option>
            <option value="paiement">Paiements</option>
            <option value="essai">Essais gratuits</option>
            <option value="offert">Offerts</option>
            <option value="ajustement">Ajustements</option>
          </select>
        </label>
        <label>
          Boutique
          <select value={boutique} onChange={(e) => setBoutique(e.target.value)}>
            <option value="">Toutes</option>
            {boutiques.donnees?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nom}
              </option>
            ))}
          </select>
        </label>
      </div>
      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {enCours && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <>
            <div className="grille-tuiles">
              <div className="tuile">
                <strong className="tuile-chiffre chiffre-vert">{montant(donnees.total_encaisse)}</strong>
                <span>
                  encaissés · {donnees.nombre_paiements} paiement{donnees.nombre_paiements > 1 ? "s" : ""}
                </span>
              </div>
              {donnees.par_mode.map((m) => (
                <div key={m.mode} className="tuile">
                  <strong className="tuile-chiffre">{montant(m.total)}</strong>
                  <span>
                    {m.mode_libelle} · {m.nombre}
                  </span>
                </div>
              ))}
            </div>
            <section className="carte carte-tableau">
              {donnees.lignes.length === 0 ? (
                <p className="vide">Aucune ligne sur cette période.</p>
              ) : (
                <div className="defilement-tableau">
                  <table className="tableau">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Boutique</th>
                        <th>Nature</th>
                        <th>Période</th>
                        <th className="nombre">Montant</th>
                        <th>Paiement</th>
                        <th>Par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donnees.lignes.map((l) => (
                        <tr key={l.id}>
                          <td>{dateHeure(l.date)}</td>
                          <td>
                            <a href={`#/boutiques/${l.boutique.id}`}>{l.boutique.nom}</a>
                          </td>
                          <td>
                            {l.nature_libelle}
                            <small className="sous-ligne">{l.formule_libelle}</small>
                          </td>
                          <td>
                            {date(l.date_debut)} → {l.date_fin ? date(l.date_fin) : "sans limite"}
                          </td>
                          <td className="nombre">{Number(l.montant) ? montant(l.montant) : "—"}</td>
                          <td>
                            {[l.mode_libelle, l.reference].filter(Boolean).join(" · ") || "—"}
                            {l.note && <small className="sous-ligne">{l.note}</small>}
                          </td>
                          <td>{l.enregistre_par || "appli"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}

// --- Enregistrer un paiement reçu hors appli ----------------------------------

const VIDE = {
  boutique_id: "",
  nature: "paiement",
  formule: "essentiel",
  duree_mois: "1",
  date_fin: "",
  par_date: false,
  sans_limite: false,
  montant: "",
  mode: "especes",
  reference: "",
  note: "",
};

function Enregistrer() {
  const boutiques = useChargement(() =>
    api<{ id: string; nom: string; formule: "essentiel" | "pro" }[]>("/admin/paiements/boutiques/"),
  );
  const [f, setF] = useState(VIDE);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<BoutiqueCourte | null>(null);

  const maj = (cle: keyof typeof VIDE, valeur: string | boolean) => {
    setF((x) => ({ ...x, [cle]: valeur }));
    setErreurs((e) => ({ ...e, [cle]: "" }));
  };

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    setErreurs({});
    const corps: Record<string, unknown> = {
      boutique_id: f.boutique_id,
      nature: f.nature,
      formule: f.formule,
      sans_limite: f.sans_limite,
      note: f.note,
    };
    if (!f.sans_limite) {
      if (f.par_date || f.nature === "ajustement") corps.date_fin = f.date_fin;
      else corps.duree_mois = Number(f.duree_mois);
    }
    if (f.nature === "paiement") Object.assign(corps, { montant: f.montant, mode: f.mode, reference: f.reference });
    try {
      setResultat(await api<BoutiqueCourte>("/admin/paiements/enregistrer/", { method: "POST", body: JSON.stringify(corps) }));
      setF(VIDE);
    } catch (err) {
      const champs = err instanceof ErreurApi ? err.champs : {};
      setErreurs(champs);
      setErreur(Object.keys(champs).length ? "Corrigez les champs signalés en rouge." : (err as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  if (resultat) {
    return (
      <section className="carte carte-succes">
        <h2>✅ Enregistré pour « {resultat.nom} »</h2>
        <p>
          Abonnement {resultat.formule === "pro" ? "Pro" : "Essentiel"}{" "}
          {resultat.date_expiration_abonnement ? `jusqu'au ${date(resultat.date_expiration_abonnement)}` : "sans limite"}.
        </p>
        {resultat.date_expiration_abonnement && <CodeActivation boutiqueId={resultat.id} nom={resultat.nom} />}
        <div className="actions">
          <button type="button" className="bouton-principal" onClick={() => setResultat(null)}>
            Enregistrer un autre paiement
          </button>
        </div>
      </section>
    );
  }

  const erreurDe = (cle: string) => erreurs[cle] && <small className="erreur-champ">{erreurs[cle]}</small>;
  const parDate = f.par_date || f.nature === "ajustement";

  return (
    <form className="pile formulaire" onSubmit={soumettre}>
      <p className="aide">
        Pour un paiement reçu en dehors de l'appli (espèces, virement…), des mois offerts, ou pour corriger une date de
        fin. Un paiement ou des mois offerts s'ajoutent à la fin de l'abonnement en cours ; un ajustement fixe la date.
      </p>
      <section className="carte">
        <div className="grille-champs">
          <label>
            Boutique<span className="requis"> *</span>
            <select
              value={f.boutique_id}
              required
              onChange={(e) => {
                const b = boutiques.donnees?.find((x) => x.id === e.target.value);
                setF((x) => ({ ...x, boutique_id: e.target.value, formule: b?.formule ?? x.formule }));
              }}
            >
              <option value="">— Choisir —</option>
              {boutiques.donnees?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nom}
                </option>
              ))}
            </select>
            {erreurDe("boutique_id")}
          </label>
          <label>
            Nature
            <select value={f.nature} onChange={(e) => maj("nature", e.target.value)}>
              <option value="paiement">Paiement reçu</option>
              <option value="offert">Mois offerts</option>
              <option value="ajustement">Correction de la date de fin</option>
            </select>
          </label>
          <label>
            Formule
            <select value={f.formule} onChange={(e) => maj("formule", e.target.value)}>
              <option value="essentiel">Essentiel</option>
              <option value="pro">Pro</option>
            </select>
          </label>
        </div>

        <div className="grille-champs">
          {!f.sans_limite &&
            (parDate ? (
              <label>
                Nouvelle date de fin<span className="requis"> *</span>
                <input type="date" value={f.date_fin} required onChange={(e) => maj("date_fin", e.target.value)} />
                {erreurDe("date_fin")}
              </label>
            ) : (
              <label>
                Durée
                <select value={f.duree_mois} onChange={(e) => maj("duree_mois", e.target.value)}>
                  <option value="1">1 mois</option>
                  <option value="3">3 mois</option>
                  <option value="6">6 mois</option>
                  <option value="12">12 mois</option>
                </select>
                {erreurDe("duree_mois")}
              </label>
            ))}
          {f.nature === "paiement" && (
            <>
              <label>
                Montant reçu (FCFA)<span className="requis"> *</span>
                <input inputMode="numeric" value={f.montant} required onChange={(e) => maj("montant", e.target.value.replace(/[^0-9]/g, ""))} />
                {erreurDe("montant")}
              </label>
              <label>
                Reçu par
                <select value={f.mode} onChange={(e) => maj("mode", e.target.value)}>
                  {MODES.map((m) => (
                    <option key={m.valeur} value={m.valeur}>
                      {m.libelle}
                    </option>
                  ))}
                </select>
                {erreurDe("mode")}
              </label>
              <label>
                Référence (transaction, reçu…)
                <input value={f.reference} onChange={(e) => maj("reference", e.target.value)} maxLength={100} />
                {erreurDe("reference")}
              </label>
            </>
          )}
        </div>
        <div className="ligne-options">
          {f.nature !== "ajustement" && !f.sans_limite && (
            <label className="interrupteur">
              <input type="checkbox" checked={f.par_date} onChange={(e) => maj("par_date", e.target.checked)} />
              Choisir une date de fin précise plutôt qu'une durée
            </label>
          )}
          {f.nature !== "paiement" && (
            <label className="interrupteur">
              <input type="checkbox" checked={f.sans_limite} onChange={(e) => maj("sans_limite", e.target.checked)} />
              Sans limite de durée
            </label>
          )}
        </div>
        <label className="champ-plein">
          Note (facultative)
          <input value={f.note} onChange={(e) => maj("note", e.target.value)} maxLength={255} />
        </label>
      </section>
      {erreur && <Erreur message={erreur} />}
      <div className="actions">
        <button type="submit" className="bouton-principal" disabled={enCours || !f.boutique_id}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
