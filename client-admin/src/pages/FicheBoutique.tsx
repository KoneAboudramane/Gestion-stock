import { type ReactNode, useState } from "react";

import { api } from "../api";
import BarreRubriques from "../composants/BarreRubriques";
import CarteOption from "../composants/CarteOption";
import PanneauOptions, { type CleOption, type EnregistrementOption } from "../composants/PanneauOptions";
import CodeActivation from "../composants/CodeActivation";
import { BadgeAbonnement, Chargement, Erreur, Info, Modale } from "../composants/Commun";
import { date, dateHeure, depuis, montant } from "../format";
import type { FicheBoutique as Fiche, ResumeBoutique } from "../types";
import { useChargement } from "../useChargement";

/**
 * Fiche d'une boutique sur le site d'administration, au même design que
 * l'Espace Admin du bureau (partage/styles, composants communs) : barre de
 * rubriques à gauche — Vue d'ensemble, Abonnement, Essai gratuit, Options,
 * Réseau, Utilisateurs, Historique. Chaque rubrique n'apparaît que si
 * l'administrateur a le droit correspondant (`fiche.peut`, revérifié par le serveur).
 *
 * Confidentialité : informations de COMPTE seulement, jamais de vente, de stock
 * ni de client de la boutique.
 */

interface Props {
  id: string;
  surFermer: () => void;
  surModifiee: (b: ResumeBoutique) => void;
}

type Rubrique = "apercu" | "abonnement" | "essai" | "optionsPayantes" | "options" | "reseau" | "utilisateurs" | "historique";
type Ton = "ok" | "attention" | "alerte" | "neutre";

const LIBELLES_FORMULE: Record<string, string> = { essentiel: "Essentiel", pro: "Pro" };
const DUREES = [1, 3, 6, 12];
const DUREES_ESSAI = [7, 15, 30];
const MODES_PAIEMENT: [string, string][] = [
  ["wave", "Wave"],
  ["orange_money", "Orange Money"],
  ["mtn", "MTN Mobile Money"],
  ["moov", "Moov Money"],
  ["especes", "Espèces"],
  ["banque", "Banque"],
  ["autre", "Autre"],
];
const CLASSE_TON: Record<Ton, string> = { ok: "marche", attention: "arrete", alerte: "panne", neutre: "neutre" };

function finEssaiDans(jours: number): Date {
  const fin = new Date();
  fin.setDate(fin.getDate() + jours);
  fin.setHours(23, 59, 59, 0);
  return fin;
}

/** Même calcul que le serveur (comptes/services.py::ajouter_mois). */
function ajouterMois(depart: Date, mois: number): Date {
  const resultat = new Date(depart);
  const jour = resultat.getDate();
  resultat.setDate(1);
  resultat.setMonth(resultat.getMonth() + mois);
  resultat.setDate(Math.min(jour, new Date(resultat.getFullYear(), resultat.getMonth() + 1, 0).getDate()));
  return resultat;
}

export default function FicheBoutique({ id, surFermer, surModifiee }: Props) {
  const url = `/admin/boutiques/${id}/`;
  const { donnees: fiche, setDonnees, erreur, enCours, recharger } = useChargement(() => api<Fiche>(url), [id]);
  const [rubrique, setRubrique] = useState<Rubrique>("apercu");
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreurAction, setErreurAction] = useState("");
  const [message, setMessage] = useState("");
  // Abonnement : renouveler
  const [formule, setFormule] = useState<string | null>(null);
  const [duree, setDuree] = useState(1);
  const [nature, setNature] = useState<"paiement" | "offert" | "ajustement">("paiement");
  const [montantSaisi, setMontantSaisi] = useState("");
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  // Essai gratuit
  const [essaiFormule, setEssaiFormule] = useState("pro");
  const [essaiJours, setEssaiJours] = useState<number | null>(15);
  const [essaiJoursSaisis, setEssaiJoursSaisis] = useState("");

  function aller(r: Rubrique) {
    setErreurAction("");
    setMessage("");
    setRubrique(r);
  }

  /** Applique une réponse du serveur (fiche à jour) et prévient la liste. */
  function appliquer(nouvelle: Fiche, texte?: string) {
    setDonnees(nouvelle);
    surModifiee(nouvelle);
    if (texte) setMessage(texte);
  }

  async function action(fn: () => Promise<void>) {
    setEnregistrement(true);
    setErreurAction("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setErreurAction((e as Error).message);
    } finally {
      setEnregistrement(false);
    }
  }

  const modifier = (champs: Record<string, unknown>, texte: string) =>
    action(async () => appliquer(await api<Fiche>(url, { method: "PATCH", body: JSON.stringify(champs) }), texte));

  if (!fiche) {
    return (
      <Modale titre="Boutique" surFermer={surFermer}>
        {erreur && <Erreur message={erreur} reessayer={recharger} />}
        {enCours && <Chargement />}
      </Modale>
    );
  }

  const formuleChoisie = formule ?? fiche.formule;
  const fin = fiche.date_expiration_abonnement ? new Date(fiche.date_expiration_abonnement) : null;
  const depart = fin && fin > new Date() ? fin : new Date();
  const tarif = fiche.tarifs?.find((t) => t.formule === formuleChoisie && t.duree_mois === duree) ?? null;
  const joursEssai = essaiJours ?? (Number(essaiJoursSaisis) >= 1 ? Math.floor(Number(essaiJoursSaisis)) : null);
  const finEssai = joursEssai ? finEssaiDans(joursEssai) : null;
  const demandeReseau = fiche.demandes_reseau?.find((d) => d.statut === "en_attente") ?? null;

  function choisirDuree(mois: number, f = formuleChoisie) {
    setDuree(mois);
    const t = fiche?.tarifs?.find((x) => x.formule === f && x.duree_mois === mois);
    if (t && nature === "paiement") setMontantSaisi(String(Number(t.prix)));
  }

  function renouveler() {
    if (nature === "paiement" && !(Number(montantSaisi) > 0)) return setErreurAction("Indiquez le montant reçu.");
    if (nature === "paiement" && !mode) return setErreurAction("Indiquez comment le paiement a été reçu.");
    return action(async () => {
      await api("/admin/paiements/enregistrer/", {
        method: "POST",
        body: JSON.stringify({
          boutique_id: fiche!.id,
          nature,
          formule: formuleChoisie,
          duree_mois: duree,
          ...(nature === "paiement" ? { montant: montantSaisi, mode, reference: reference.trim() } : {}),
        }),
      });
      appliquer(await api<Fiche>(url), "✅ Abonnement enregistré.");
      setReference("");
    });
  }

  const refuserDemande = (demandeId: string) =>
    action(async () => {
      await api(`/admin/demandes-reseau/${demandeId}/`, { method: "POST", body: JSON.stringify({ action: "refuser" }) });
      appliquer(await api<Fiche>(url), "Demande refusée.");
    });

  // --- Rubriques ------------------------------------------------------------

  function vueEnsemble() {
    const niveau = fiche!.abonnement.niveau;
    const ton: Ton = fiche!.essai_en_cours
      ? "ok"
      : niveau === "grace" || niveau === "bloque"
        ? "alerte"
        : niveau === "bientot"
          ? "attention"
          : "ok";
    const icone = fiche!.essai_en_cours ? "🧪" : { ok: "✅", bientot: "⏳", grace: "🟠", bloque: "🔴", illimite: "♾️" }[niveau];
    const aFaire: { ton: Ton; texte: ReactNode; action?: { libelle: string; rubrique: Rubrique } }[] = [];
    if (fiche!.paiements_declares_en_attente) {
      aFaire.push({ ton: "attention", texte: `${fiche!.paiements_declares_en_attente} paiement(s) déclaré(s) à vérifier dans 💳 Paiements.` });
    }
    if (demandeReseau) {
      aFaire.push({ ton: "attention", texte: "La boutique demande l'activation du réseau.", action: { libelle: "Traiter", rubrique: "reseau" } });
    }
    if (fiche!.peut.paiements && !fiche!.essai_en_cours && (niveau === "bientot" || niveau === "grace" || niveau === "bloque")) {
      aFaire.push({
        ton: niveau === "bientot" ? "attention" : "alerte",
        texte: niveau === "bientot" ? "L'abonnement se termine bientôt." : "La boutique ne peut plus vendre (ou bientôt plus).",
        action: { libelle: "💳 Renouveler", rubrique: "abonnement" },
      });
    }
    return (
      <>
        <div className={`carte-etat-serveur carte-etat-serveur--${CLASSE_TON[ton]}`}>
          <div className="entete-vue-ensemble">
            <span className="icone-vue-ensemble">{icone}</span>
            <div>
              <strong className="etat-serveur-titre">{fiche!.abonnement.libelle}</strong>
              <span className="sous-info ligne-detail-article">
                Formule {LIBELLES_FORMULE[fiche!.formule_effective]}
                {fiche!.essai_en_cours ? " (essai gratuit)" : ""} · abonnement payé jusqu'au {date(fiche!.date_expiration_abonnement)}
              </span>
            </div>
          </div>
          {fiche!.peut.paiements && (
            <button type="button" className="bouton-primaire" onClick={() => aller("abonnement")}>
              🔄 Renouveler
            </button>
          )}
        </div>
        {aFaire.length === 0 ? (
          <div className="prochaine-etape prochaine-etape--ok">
            <div>
              <span className="libelle-prochaine-etape">À faire</span>
              <p>Rien à faire pour cette boutique.</p>
            </div>
          </div>
        ) : (
          aFaire.map((a, i) => (
            <div key={i} className={`prochaine-etape prochaine-etape--${a.ton}`}>
              <div>
                <span className="libelle-prochaine-etape">À faire</span>
                <p>{a.texte}</p>
              </div>
              {a.action && (
                <button type="button" onClick={() => aller(a.action!.rubrique)}>
                  {a.action.libelle}
                </button>
              )}
            </div>
          ))
        )}
        <div className="grille-cartes-reseau">
          <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller("options")}>
            <span className="titre-carte-reseau">🌐 Envoi en ligne</span>
            <strong>{fiche!.synchro_autorisee ? "🌐 en ligne" : "🔒 100 % local"}</strong>
            <span className="sous-info">📱 appli {fiche!.appli_mobile_autorisee ? "activée" : "non activée"}</span>
          </button>
          <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller("reseau")}>
            <span className="titre-carte-reseau">📶 Réseau</span>
            <strong>{fiche!.reseau_autorise ? "Activé" : "Non activé"}</strong>
            <span className="sous-info">{fiche!.demandes_reseau_en_attente ? "demande en attente" : "aucune demande"}</span>
          </button>
          <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller("utilisateurs")}>
            <span className="titre-carte-reseau">👥 Utilisateurs</span>
            <strong>{fiche!.utilisateurs.length} compte(s)</strong>
            <span className="sous-info">
              {fiche!.postes.length} poste(s) · sauvegarde {depuis(fiche!.date_derniere_sauvegarde)}
            </span>
          </button>
        </div>
        <div className="deux-colonnes">
          <section className="carte">
            <h3>Boutique</h3>
            <dl className="infos">
              <Info libelle="Téléphone">{fiche!.telephone}</Info>
              <Info libelle="E-mail">{fiche!.email}</Info>
              <Info libelle="Adresse">{fiche!.adresse}</Info>
              <Info libelle="Devise">{fiche!.devise}</Info>
              <Info libelle="Créée le">{date(fiche!.date_creation)}</Info>
            </dl>
          </section>
          <section className="carte">
            <h3>Patron</h3>
            {fiche!.patron ? (
              <dl className="infos">
                <Info libelle="Nom">{fiche!.patron.nom}</Info>
                <Info libelle="Identifiant">{fiche!.patron.username}</Info>
                <Info libelle="Téléphone">{fiche!.patron.telephone}</Info>
                <Info libelle="E-mail">{fiche!.patron.email}</Info>
              </dl>
            ) : (
              <p className="vide">Aucun compte Patron.</p>
            )}
          </section>
        </div>
        <p className="note-confidentialite">
          🔒 Informations de compte seulement : les ventes, le stock et les clients de la boutique restent privés.
        </p>
      </>
    );
  }

  function abonnement() {
    return (
      <>
        <h4 className="titre-rubrique-reseau">💳 Abonnement</h4>
        <dl className="infos infos-ligne">
          <Info libelle="Formule payée">{fiche!.formule_libelle}</Info>
          <Info libelle="Fin">{date(fiche!.date_expiration_abonnement)}</Info>
          <Info libelle="État">
            <BadgeAbonnement etat={fiche!.abonnement} actif={fiche!.actif} />
          </Info>
        </dl>
        <div className="etape-reseau">
          <span className="numero-etape-reseau">1</span>
          <div className="champ-etape-reseau">
            <strong>Formule</strong>
            <div className="choix-formule-abonnement">
              {(["essentiel", "pro"] as const).map((cle) => (
                <button
                  key={cle}
                  type="button"
                  className={`puce-nom-poste${formuleChoisie === cle ? " choisi" : ""}`}
                  onClick={() => {
                    setFormule(cle);
                    choisirDuree(duree, cle);
                  }}
                >
                  {LIBELLES_FORMULE[cle]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="etape-reseau">
          <span className="numero-etape-reseau">2</span>
          <div className="champ-etape-reseau">
            <strong>Durée</strong>
            <div className="grille-durees-abonnement">
              {DUREES.map((mois) => {
                const t = fiche!.tarifs?.find((x) => x.formule === formuleChoisie && x.duree_mois === mois);
                return (
                  <button
                    key={mois}
                    type="button"
                    className={`carte-duree-abonnement${duree === mois ? " choisi" : ""}`}
                    onClick={() => choisirDuree(mois)}
                  >
                    <strong>+{mois} mois</strong>
                    <span className="sous-info">
                      jusqu'au {date(ajouterMois(nature === "ajustement" ? new Date() : depart, mois).toISOString())}
                    </span>
                    {t && <span className="prix-duree-abonnement">{montant(t.prix)}</span>}
                    {t && Number(t.remise) > 0 && <span className="sous-info">−{Number(t.remise)} %</span>}
                  </button>
                );
              })}
            </div>
            <span className="note-aide">
              {nature === "ajustement"
                ? "Correction de date : part d'aujourd'hui."
                : fin && fin > new Date()
                  ? `Part de la fin actuelle (${date(fin.toISOString())}) : les jours déjà payés ne sont pas perdus.`
                  : "Part d'aujourd'hui (l'abonnement est terminé)."}
            </span>
          </div>
        </div>
        <div className="etape-reseau">
          <span className="numero-etape-reseau">3</span>
          <div className="champ-etape-reseau champs-sauvegarde">
            <strong>Paiement</strong>
            <div className="choix-methode-restauration">
              {(
                [
                  ["paiement", "💵 Paiement reçu"],
                  ["offert", "🎁 Offert"],
                  ["ajustement", "✏️ Correction de date"],
                ] as const
              ).map(([cle, libelle]) => (
                <label key={cle}>
                  <input type="radio" checked={nature === cle} onChange={() => setNature(cle)} /> {libelle}
                </label>
              ))}
            </div>
            {nature === "paiement" && (
              <div className="grille-paiement-abonnement">
                <label>
                  Montant reçu
                  <input type="number" min={0} step="any" value={montantSaisi} onChange={(e) => setMontantSaisi(e.target.value)} />
                  <span className="note-aide">{tarif ? `Tarif : ${montant(tarif.prix)}` : "Pas de tarif saisi pour ce choix."}</span>
                </label>
                <label>
                  Payé par
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="">—</option>
                    {MODES_PAIEMENT.map(([cle, libelle]) => (
                      <option key={cle} value={cle}>
                        {libelle}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Référence de la transaction
                  <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex. MP2410…" />
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" disabled={enregistrement} onClick={renouveler}>
            {enregistrement ? "Enregistrement…" : "💳 Enregistrer"}
          </button>
        </div>
        {fiche!.date_expiration_abonnement && (
          <section className="carte">
            <h3>🔑 Code d'activation hors ligne</h3>
            <CodeActivation boutiqueId={fiche!.id} nom={fiche!.nom} />
          </section>
        )}
      </>
    );
  }

  function essai() {
    const finPayee = fiche!.date_expiration_abonnement;
    const apres = !finPayee
      ? `${fiche!.formule_libelle}, sans limite`
      : finEssai && new Date(finPayee) > finEssai
        ? `${fiche!.formule_libelle} jusqu'au ${date(finPayee)}`
        : "abonnement à renouveler";
    return (
      <>
        <h4 className="titre-rubrique-reseau">🧪 Essai gratuit</h4>
        <p className="note-aide">
          L'essai commence aujourd'hui et passe devant l'abonnement payé, qui n'est pas touché : à la fin de l'essai, la
          boutique retrouve d'elle-même sa formule et sa date. Inscrit au registre comme « Essai gratuit ».
        </p>
        {fiche!.essai_en_cours && fiche!.essai_fin && (
          <div className="prochaine-etape prochaine-etape--neutre">
            <div>
              <span className="libelle-prochaine-etape">Essai en cours</span>
              <p>
                Essai gratuit {LIBELLES_FORMULE[fiche!.essai_formule] ?? fiche!.essai_formule} jusqu'au {date(fiche!.essai_fin)}.
              </p>
            </div>
            <button
              type="button"
              disabled={enregistrement}
              onClick={() =>
                window.confirm("Arrêter l'essai ? L'abonnement payé s'applique de nouveau tout de suite.") &&
                modifier({ essai_fin: null }, "Essai gratuit arrêté : l'abonnement payé s'applique de nouveau.")
              }
            >
              ⏹ Arrêter l'essai
            </button>
          </div>
        )}
        <div className="etape-reseau">
          <span className="numero-etape-reseau">1</span>
          <div className="champ-etape-reseau">
            <strong>Formule de l'essai</strong>
            <div className="choix-formule-abonnement">
              {(["essentiel", "pro"] as const).map((cle) => (
                <button
                  key={cle}
                  type="button"
                  className={`puce-nom-poste${essaiFormule === cle ? " choisi" : ""}`}
                  onClick={() => setEssaiFormule(cle)}
                >
                  {LIBELLES_FORMULE[cle]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="etape-reseau">
          <span className="numero-etape-reseau">2</span>
          <div className="champ-etape-reseau">
            <strong>Durée</strong>
            <div className="grille-durees-abonnement">
              {DUREES_ESSAI.map((jours) => (
                <button
                  key={jours}
                  type="button"
                  className={`carte-duree-abonnement${essaiJours === jours ? " choisi" : ""}`}
                  onClick={() => {
                    setEssaiJours(jours);
                    setEssaiJoursSaisis("");
                  }}
                >
                  <strong>{jours} jours</strong>
                  <span className="sous-info">jusqu'au {date(finEssaiDans(jours).toISOString())}</span>
                </button>
              ))}
            </div>
            <label className="champs-sauvegarde">
              Autre durée (en jours)
              <input
                type="number"
                min={1}
                step={1}
                value={essaiJoursSaisis}
                placeholder="ex. 45"
                onChange={(e) => {
                  setEssaiJoursSaisis(e.target.value);
                  setEssaiJours(null);
                }}
              />
            </label>
          </div>
        </div>
        <div className="prochaine-etape prochaine-etape--neutre">
          <div>
            <span className="libelle-prochaine-etape">Récapitulatif</span>
            <p>
              {finEssai
                ? `Essai ${LIBELLES_FORMULE[essaiFormule]} du ${date(new Date().toISOString())} au ${date(finEssai.toISOString())}, puis ${apres}.`
                : "Choisissez la durée de l'essai."}
            </p>
          </div>
          <button
            type="button"
            className="bouton-primaire"
            disabled={enregistrement || !finEssai}
            onClick={() =>
              finEssai &&
              modifier(
                { essai_fin: finEssai.toISOString(), essai_formule: essaiFormule },
                `✅ Essai gratuit ${LIBELLES_FORMULE[essaiFormule]} accordé jusqu'au ${date(finEssai.toISOString())}.`,
              )
            }
          >
            {fiche!.essai_en_cours ? "🧪 Remplacer l'essai" : "🧪 Accorder l'essai"}
          </button>
        </div>
      </>
    );
  }

  function options() {
    const droitEnLigne = fiche!.options?.en_ligne?.droit ?? true;
    return (
      <>
        <h4 className="titre-rubrique-reseau">🌐 Envoi en ligne</h4>
        <p className="note-aide">
          Même avec l'option En ligne (ou en Pro), l'envoi reste éteint tant qu'on ne l'allume pas : certains commerçants
          refusent que leurs données partent sur le serveur.
        </p>
        <CarteOption
          icone="🌐"
          titre="Envoi des données en ligne"
          actif={fiche!.synchro_autorisee}
          libelleOui="Allumé"
          libelleNon="100 % local"
          detail={
            !droitEnLigne && !fiche!.synchro_autorisee
              ? "🔒 L'option En ligne n'est pas prise : prenez-la ou offrez-la dans « 🧩 Options » avant de l'allumer."
              : fiche!.synchro_autorisee
                ? "Ventes, stock et fiches envoyés au serveur : sauvegarde en ligne, appli web et mobile à jour."
                : "Tout reste sur les appareils de la boutique ; seuls le nom et l'abonnement sont en ligne."
          }
          confirmation={(v) =>
            v
              ? `Allumer l'envoi en ligne pour « ${fiche!.nom} » ? Ses données seront envoyées au serveur.`
              : `Passer « ${fiche!.nom} » en 100 % local ? L'appli continue de fonctionner sur ses appareils.`
          }
          enCours={enregistrement || (!droitEnLigne && !fiche!.synchro_autorisee)}
          onBasculer={(v) => modifier({ synchro_autorisee: v }, v ? "✅ Envoi en ligne allumé." : "Boutique passée en 100 % local.")}
        />
        <dl className="infos infos-ligne">
          <Info libelle="Dernière synchro">{dateHeure(fiche!.derniere_synchro)}</Info>
          <Info libelle="Dernière sauvegarde">{depuis(fiche!.date_derniere_sauvegarde)}</Info>
        </dl>
      </>
    );
  }

  function optionsPayantes() {
    return (
      <>
        <h4 className="titre-rubrique-reseau">🧩 Options payantes</h4>
        <p className="note-aide">
          Pour la formule Essentiel : chaque option se prend à part (payée ou offerte), pour une durée, jusqu'à une date ou
          liée à l'abonnement. Toutes sont comprises dans Pro.
        </p>
        {fiche!.options ? (
          <PanneauOptions
            options={fiche!.options}
            tarifs={fiche!.tarifs_options ?? []}
            enCours={enregistrement}
            onEnregistrer={(e: EnregistrementOption) =>
              action(async () =>
                appliquer(
                  await api<Fiche>(`${url}option/`, {
                    method: "POST",
                    body: JSON.stringify({
                      cle: e.cle,
                      nature: e.nature,
                      ...(e.suitAbonnement ? { suit_abonnement: true } : e.dateFin ? { date_fin: e.dateFin } : { duree_mois: e.dureeMois }),
                      ...(e.nature === "paiement" ? { montant: e.montant, mode: e.mode, reference: e.reference } : {}),
                    }),
                  }),
                  `✅ ${fiche!.options?.[e.cle]?.libelle ?? "Option"} enregistrée.`,
                ),
              )
            }
            onRetirer={(cle: CleOption) =>
              action(async () =>
                appliquer(
                  await api<Fiche>(`${url}option/`, { method: "POST", body: JSON.stringify({ cle, action: "retirer" }) }),
                  `${fiche!.options?.[cle]?.libelle ?? "Option"} retirée.`,
                ),
              )
            }
            onException={(cle: CleOption, valeur: boolean) =>
              modifier(
                cle === "en_ligne"
                  ? { option_en_ligne_offerte: valeur }
                  : cle === "reseau"
                    ? { reseau_autorise: valeur }
                    : { appli_mobile_autorisee: valeur },
                `${fiche!.options?.[cle]?.libelle ?? "Option"} ${valeur ? "accordée sans paiement" : ": exception retirée"}.`,
              )
            }
          />
        ) : (
          <p className="vide">État des options indisponible.</p>
        )}
      </>
    );
  }

  function reseau() {
    return (
      <>
        <h4 className="titre-rubrique-reseau">📶 Réseau de la boutique</h4>
        <div className={`prochaine-etape prochaine-etape--${fiche!.options?.reseau?.droit ? "ok" : "neutre"}`}>
          <div>
            <span className="libelle-prochaine-etape">Droit au réseau</span>
            <p>
              {(
                {
                  pro: "✅ compris dans la formule Pro",
                  suit: "✅ option Réseau liée à l'abonnement",
                  payee: `✅ option Réseau prise jusqu'au ${date(fiche!.options?.reseau?.fin ?? null)}`,
                  exception: "✅ accordé sans paiement",
                } as Record<string, string>
              )[fiche!.options?.reseau?.source ?? ""] ?? "🔒 option Réseau non prise"}
            </p>
          </div>
        </div>
        {demandeReseau && !fiche!.options?.reseau?.droit && (
          <div className="prochaine-etape prochaine-etape--attention">
            <div>
              <span className="libelle-prochaine-etape">📨 Demande de la boutique</span>
              <p>
                Le {date(demandeReseau.date)}
                {demandeReseau.demandeur ? ` par ${demandeReseau.demandeur}` : ""}
                {demandeReseau.note ? ` : « ${demandeReseau.note} »` : ""}.
              </p>
            </div>
            <div className="actions-code-reseau">
              <button
                type="button"
                className="bouton-primaire"
                disabled={enregistrement}
                onClick={() => modifier({ reseau_autorise: true }, "✅ Réseau activé, demande acceptée.")}
              >
                Accepter et activer
              </button>
              <button type="button" disabled={enregistrement} onClick={() => refuserDemande(demandeReseau.id)}>
                Refuser
              </button>
            </div>
          </div>
        )}
        <CarteOption
          icone="🎁"
          titre="Réseau accordé sans paiement (exception)"
          actif={fiche!.reseau_autorise}
          libelleOui="Accordé"
          libelleNon="Non accordé"
          detail={
            ["pro", "payee", "suit"].includes(fiche!.options?.reseau?.source ?? "")
              ? "Inutile ici : la boutique a déjà droit au réseau."
              : fiche!.reseau_autorise
                ? "Accordé sans paiement : les appareils de la boutique peuvent se relier sans internet."
                : "Pour vendre l'option : « 🧩 Options ». Ou accordez-la ici sans paiement (geste commercial)."
          }
          confirmation={(v) =>
            v
              ? `Activer le réseau de « ${fiche!.nom} » ? Elle pourra faire d'un appareil le poste principal et y brancher ses caisses.`
              : "Désactiver le réseau ? Le poste principal arrête son serveur dans la minute : les caisses continuent de vendre seules. Rien n'est perdu ; réactivé, tout reprend."
          }
          dangereuxSiActif
          enCours={enregistrement}
          onBasculer={(v) => modifier({ reseau_autorise: v }, v ? "✅ Réseau activé." : "Réseau désactivé.")}
        />
        <h4>Demandes de la boutique</h4>
        {fiche!.demandes_reseau && fiche!.demandes_reseau.length > 0 ? (
          <div className="defilement-tableau">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Demandé par</th>
                  <th>Note</th>
                  <th>Statut</th>
                  <th>Traitée le</th>
                </tr>
              </thead>
              <tbody>
                {fiche!.demandes_reseau.map((d) => (
                  <tr key={d.id}>
                    <td>{date(d.date)}</td>
                    <td>{d.demandeur || "—"}</td>
                    <td>{d.note || "—"}</td>
                    <td>
                      <span className={`pastille-etat-reseau${d.statut === "acceptee" ? " pastille-etat-reseau--relie" : ""}`}>
                        {d.statut_libelle}
                      </span>
                    </td>
                    <td>{date(d.date_traitement)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="vide">Aucune demande.</p>
        )}
      </>
    );
  }

  function utilisateurs() {
    return (
      <>
        <h4 className="titre-rubrique-reseau">👥 Utilisateurs ({fiche!.utilisateurs.length})</h4>
        <div className="defilement-tableau">
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Identifiant</th>
                <th>Rôle</th>
                <th>Téléphone</th>
                <th>Dernière connexion en ligne</th>
              </tr>
            </thead>
            <tbody>
              {fiche!.utilisateurs.map((u) => (
                <tr key={u.username} className={u.actif ? "" : "ligne-inactive"}>
                  <td>{u.nom || "—"}</td>
                  <td>{u.username}</td>
                  <td>{u.role || "—"}</td>
                  <td>{u.telephone || "—"}</td>
                  <td>{u.actif ? dateHeure(u.derniere_connexion) : "Compte désactivé"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fiche!.peut.comptes && (
          <p className="note-aide">Pour réinitialiser un mot de passe : menu 🔑 Comptes et mots de passe.</p>
        )}
        <h4>Postes synchronisés ({fiche!.postes.length})</h4>
        {fiche!.postes.length === 0 ? (
          <p className="vide">
            {fiche!.synchro_autorisee ? "Aucun poste n'a encore synchronisé." : "Synchronisation en ligne désactivée."}
          </p>
        ) : (
          <ul className="liste-simple">
            {fiche!.postes.map((p) => (
              <li key={p.appareil}>
                <strong>{p.appareil}</strong> — dernière synchro {dateHeure(p.derniere_synchro)}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  function historique() {
    const registre = fiche!.registre_abonnement ?? [];
    return (
      <>
        <h4 className="titre-rubrique-reseau">🧾 Historique de l'abonnement</h4>
        {registre.length === 0 ? (
          <p className="vide">Aucune ligne.</p>
        ) : (
          <div className="defilement-tableau">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Nature</th>
                  <th>Formule</th>
                  <th>Période</th>
                  <th className="nombre">Montant</th>
                  <th>Paiement</th>
                </tr>
              </thead>
              <tbody>
                {registre.map((p, i) => (
                  <tr key={i}>
                    <td>{date(p.date)}</td>
                    <td>{p.nature_libelle}</td>
                    <td>{p.formule_libelle}</td>
                    <td>
                      {date(p.date_debut)} → {p.date_fin ? date(p.date_fin) : "sans limite"}
                    </td>
                    <td className="nombre">{Number(p.montant) ? montant(p.montant) : "—"}</td>
                    <td>{[p.mode_libelle, p.reference].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  const contenus: Record<Rubrique, () => ReactNode> = {
    apercu: vueEnsemble,
    abonnement,
    essai,
    options,
    optionsPayantes,
    reseau,
    utilisateurs,
    historique,
  };
  const rubriques = [
    { cle: "apercu" as const, label: "🧭 Vue d'ensemble" },
    ...(fiche.peut.paiements
      ? [
          { cle: "abonnement" as const, label: "💳 Abonnement", compteur: fiche.paiements_declares_en_attente || undefined },
          { cle: "essai" as const, label: "🧪 Essai gratuit" },
          { cle: "optionsPayantes" as const, label: "🧩 Options" },
        ]
      : []),
    { cle: "options" as const, label: "🌐 Envoi en ligne" },
    ...(fiche.peut.demandes_reseau
      ? [{ cle: "reseau" as const, label: "📶 Réseau", compteur: fiche.demandes_reseau_en_attente || undefined }]
      : []),
    { cle: "utilisateurs" as const, label: "👥 Utilisateurs" },
    ...(fiche.registre_abonnement ? [{ cle: "historique" as const, label: "🧾 Historique" }] : []),
  ];

  return (
    <Modale titre={fiche.nom} surFermer={surFermer}>
      <div className="ecran-admin-commun disposition-parametres">
        <BarreRubriques
          etiquette="Abonnement"
          etat={`${LIBELLES_FORMULE[fiche.formule_effective]}${fiche.essai_en_cours ? " · essai" : ""}`}
          details={[fiche.abonnement.libelle, fiche.synchro_autorisee ? "🌐 en ligne" : "🔒 100 % local"]}
          ton={fiche.abonnement.niveau === "grace" || fiche.abonnement.niveau === "bloque" ? "alerte" : "ok"}
          rubriques={rubriques}
          active={rubrique}
          onChoisir={aller}
        />
        <div className="contenu-parametres contenu-reseau bloc-fiche-site">
          {erreurAction && <Erreur message={erreurAction} />}
          {message && <div className="message-succes">{message}</div>}
          {contenus[rubrique]()}
        </div>
      </div>
    </Modale>
  );
}
