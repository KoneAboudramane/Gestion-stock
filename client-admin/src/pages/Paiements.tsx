import { type FormEvent, useState } from "react";

import { api, ErreurApi } from "../api";
import OngletsRubriques from "../composants/OngletsRubriques";
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

/**
 * Paiements des abonnements, au même design que l'Espace Admin du bureau :
 * rubriques dans la barre de gauche (à vérifier, registre, enregistrer).
 */
export default function Paiements() {
  const [onglet, setOnglet] = useState<Onglet>("declares");
  const aVerifier = useChargement(() => api<PaiementDeclare[]>("/admin/paiements/declares/?statut=en_attente"), [onglet]);
  const nombre = aVerifier.donnees?.length ?? null;
  return (
    <div className="ecran-admin-commun page-onglets">
      <OngletsRubriques
        etiquette="Paiements"
        etat={nombre === null ? "…" : nombre ? `${nombre} à vérifier` : "rien à vérifier"}
        ton={nombre ? "alerte" : "ok"}
        rubriques={[
          { cle: "declares" as const, label: "📥 Déclarés dans l'appli", compteur: nombre ?? undefined },
          { cle: "registre" as const, label: "📒 Registre" },
          { cle: "enregistrer" as const, label: "➕ Enregistrer un paiement" },
        ]}
        active={onglet}
        onChoisir={setOnglet}
      />
      <div className="contenu-onglet contenu-reseau">
        {onglet === "declares" && <Declares />}
        {onglet === "registre" && <RegistreAbonnements />}
        {onglet === "enregistrer" && <Enregistrer />}
      </div>
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
      <h4 className="titre-rubrique-reseau">📥 Paiements déclarés dans l'appli</h4>
      <p className="note-aide">
        Le commerçant a envoyé l'argent par Mobile Money et saisi la référence dans l'appli. Vérifiez la transaction sur
        votre téléphone avant de valider : la période s'ajoute alors à la fin de son abonnement en cours.
      </p>
      <div className="puces-filtres-comptes">
        {[
          ["en_attente", "⏳ À vérifier"],
          ["validee", "✅ Validés"],
          ["rejetee", "⛔ Rejetés"],
          ["tous", "Tous"],
        ].map(([v, l]) => (
          <button key={v} type="button" className={`puce-nom-poste${statut === v ? " choisi" : ""}`} onClick={() => setStatut(v)}>
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
      <h4 className="titre-rubrique-reseau">📒 Registre des abonnements</h4>
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
  const boutiqueChoisie = boutiques.donnees?.find((b) => b.id === f.boutique_id);

  return (
    <>
      <h4 className="titre-rubrique-reseau">➕ Enregistrer un paiement</h4>
      <p className="note-aide">
        Pour un paiement reçu en dehors de l'appli (espèces, virement…), des mois offerts, ou pour corriger une date de fin.
        Un paiement ou des mois offerts s'ajoutent à la fin de l'abonnement en cours ; un ajustement fixe la date.
      </p>
      <div className="etape-reseau">
        <span className="numero-etape-reseau">1</span>
        <div className="champ-etape-reseau champs-sauvegarde">
          <strong>Boutique</strong>
          <select
            value={f.boutique_id}
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
        </div>
      </div>
      <div className="etape-reseau">
        <span className="numero-etape-reseau">2</span>
        <div className="champ-etape-reseau champs-sauvegarde">
          <strong>Nature</strong>
          <div className="choix-methode-restauration">
            {(
              [
                ["paiement", "💵 Paiement reçu"],
                ["offert", "🎁 Mois offerts"],
                ["ajustement", "✏️ Correction de date"],
              ] as const
            ).map(([cle, libelle]) => (
              <label key={cle}>
                <input type="radio" checked={f.nature === cle} onChange={() => maj("nature", cle)} /> {libelle}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="etape-reseau">
        <span className="numero-etape-reseau">3</span>
        <div className="champ-etape-reseau champs-sauvegarde">
          <strong>Formule et durée</strong>
          <div className="choix-formule-abonnement">
            {(["essentiel", "pro"] as const).map((cle) => (
              <button
                key={cle}
                type="button"
                className={`puce-nom-poste${f.formule === cle ? " choisi" : ""}`}
                onClick={() => maj("formule", cle)}
              >
                {cle === "pro" ? "Pro" : "Essentiel"}
              </button>
            ))}
          </div>
          {!f.sans_limite &&
            (parDate ? (
              <label>
                Nouvelle date de fin
                <input type="date" value={f.date_fin} onChange={(e) => maj("date_fin", e.target.value)} />
                {erreurDe("date_fin")}
              </label>
            ) : (
              <div className="grille-durees-abonnement">
                {["1", "3", "6", "12"].map((mois) => (
                  <button
                    key={mois}
                    type="button"
                    className={`carte-duree-abonnement${f.duree_mois === mois ? " choisi" : ""}`}
                    onClick={() => maj("duree_mois", mois)}
                  >
                    <strong>+{mois} mois</strong>
                  </button>
                ))}
              </div>
            ))}
          {erreurDe("duree_mois")}
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
        </div>
      </div>
      {f.nature === "paiement" && (
        <div className="etape-reseau">
          <span className="numero-etape-reseau">4</span>
          <div className="champ-etape-reseau champs-sauvegarde">
            <strong>Paiement</strong>
            <div className="grille-paiement-abonnement">
              <label>
                Montant reçu (FCFA)
                <input inputMode="numeric" value={f.montant} onChange={(e) => maj("montant", e.target.value.replace(/[^0-9]/g, ""))} />
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
            </div>
          </div>
        </div>
      )}
      <label className="champ-plein">
        Note (facultative)
        <input value={f.note} onChange={(e) => maj("note", e.target.value)} maxLength={255} />
      </label>
      {erreur && <Erreur message={erreur} />}
      <div className="prochaine-etape prochaine-etape--neutre">
        <div>
          <span className="libelle-prochaine-etape">Récapitulatif</span>
          <p>
            {boutiqueChoisie ? `« ${boutiqueChoisie.nom} » · ` : "Choisissez la boutique · "}
            {f.formule === "pro" ? "Pro" : "Essentiel"} ·{" "}
            {f.sans_limite ? "sans limite" : parDate ? (f.date_fin ? `jusqu'au ${date(f.date_fin)}` : "date à choisir") : `+${f.duree_mois} mois`}
            {f.nature === "paiement" ? ` · ${f.montant ? montant(f.montant) : "montant à saisir"}` : f.nature === "offert" ? " · offert" : " · correction"}
          </p>
        </div>
        <button type="button" className="bouton-primaire" disabled={enCours || !f.boutique_id} onClick={(e) => soumettre(e as unknown as FormEvent)}>
          {enCours ? "Enregistrement…" : "💳 Enregistrer"}
        </button>
      </div>
    </>
  );
}
