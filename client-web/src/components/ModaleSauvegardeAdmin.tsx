import { useEffect, useState, type ReactNode } from "react";

import { api } from "../api/sauvegardeBoutique";
import type { AbonnementBoutique, CopieSauvegarde, EtatSauvegarde, ListeSauvegardes } from "../api/sauvegardeBoutique";
import { imprimer } from "../lib/impression";
import { libelleDossier } from "../services/sauvegarde";

// Copie de client-electron/src/components/ModaleSauvegardeAdmin.tsx (docs/plan_mobile_complet.md,
// lot 4) : seuls les appels (api/sauvegardeBoutique.ts), le dossier (choisi dans Android) et
// les conseils (appli Google Drive, carte mémoire) diffèrent.
//
// Sauvegarde chiffrée de la boutique (docs/plan_reseau_local.md, lot 7), une
// même modale pour deux personnes :
// - mode « admin » (Espace Admin) : l'admin paramètre sur place (dossier
//   « Google Drive pour appareil » de la boutique, heure, conservation), le
//   patron tape lui-même le mot de passe (fiche de récupération), restauration ;
// - mode « patron » (Informations boutique) : il VOIT que la sauvegarde
//   fonctionne et ses copies, peut sauvegarder maintenant, sans rien modifier.
// Barre latérale : Vue d'ensemble, Copies, Réglages, Mot de passe, Restaurer.

type Rubrique = "apercu" | "copies" | "parametrer" | "reglages" | "motDePasse" | "restaurer";
type Conservation = "progressive" | "illimitee";
type Ton = "ok" | "attention" | "alerte" | "neutre";
const CLASSE_TON: Record<Ton, string> = { ok: "marche", attention: "arrete", alerte: "panne", neutre: "neutre" };

const LIBELLE_CATEGORIE: Record<CopieSauvegarde["categorie"], string> = {
  jour: "Quotidienne",
  semaine: "Hebdomadaire",
  mois: "Mensuelle",
};

function quand(iso: string | null): string {
  if (!iso) return "jamais";
  const date = new Date(iso);
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const jour = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const maintenant = new Date();
  const aujourdhui = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()).getTime();
  const ecart = Math.round((jour - aujourdhui) / 86400000);
  if (ecart === 0) return `aujourd'hui à ${heure}`;
  if (ecart === -1) return `hier à ${heure}`;
  if (ecart === 1) return `demain à ${heure}`;
  return `${date.toLocaleDateString("fr-FR")} à ${heure}`;
}

function taille(octets: number): string {
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`;
  if (octets < 1024 * 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
  return `${(octets / (1024 * 1024 * 1024)).toFixed(2).replace(".", ",")} Go`;
}

export function imprimerFiche(): void {
  void imprimer("Fiche-de-recuperation", "impression-fiche");
}

/** Fiche de récupération : à imprimer et à garder par le patron, en lieu sûr. */
export function FicheRecuperation({
  boutiqueNom,
  motDePasse,
  dossier,
  secours = false,
  exemplaire,
}: {
  boutiqueNom: string;
  motDePasse: string;
  dossier: string;
  secours?: boolean;
  exemplaire?: string;
}) {
  return (
    <div className="fiche-recuperation">
      {exemplaire && <p className="exemplaire-fiche">{exemplaire}</p>}
      <h3>Fiche de récupération des sauvegardes</h3>
      <p>
        <strong>Boutique :</strong> {boutiqueNom}
        <br />
        <strong>Date :</strong> {new Date().toLocaleDateString("fr-FR")}
        <br />
        <strong>Dossier des sauvegardes :</strong> {dossier}
      </p>
      <p className="fiche-recuperation-mot-de-passe">
        Mot de passe des sauvegardes : <strong>{motDePasse}</strong>
      </p>
      <p>
        {secours
          ? "Sans ce mot de passe, seul votre administrateur peut ouvrir les sauvegardes (clé de secours, avec votre accord) ; ni Google ni personne d'autre."
          : "Sans ce mot de passe, les sauvegardes ne peuvent pas être ouvertes — par personne, ni par Google ni par l'administrateur."}{" "}
        Gardez cette fiche dans un endroit sûr, loin de l'appareil, et détruisez l'ancienne fiche si vous en aviez une.
        En cas de panne, l'administrateur installe l'application sur un autre appareil et vous demande ce mot de passe
        pour restaurer la dernière sauvegarde.
      </p>
    </div>
  );
}

/** Deux exemplaires sur la même page : un à la boutique, un chez le patron. */
export function FichesRecuperation(props: { boutiqueNom: string; motDePasse: string; dossier: string; secours: boolean }) {
  return (
    <div className="fiches-recuperation">
      <FicheRecuperation {...props} exemplaire="Exemplaire 1 — à garder à la boutique, en lieu sûr" />
      <FicheRecuperation {...props} exemplaire="Exemplaire 2 — à garder chez le patron" />
    </div>
  );
}

const EXPLICATION_CONSERVATION: Record<Conservation, string> = {
  progressive:
    "Une copie par jour pendant 30 jours, puis une par semaine jusqu'à 6 mois, puis une par mois pour toujours : on peut revenir à n'importe quel mois sans remplir le Drive.",
  illimitee: "Toutes les copies sont gardées : surveillez la place sur le Drive (une copie par jour).",
};

export function ModaleSauvegarde({
  mode,
  onFermer,
  identifiantsAdmin,
}: {
  mode: "admin" | "patron";
  onFermer: () => void;
  /** Espace Admin : identifiants déjà vérifiés, envoyés au serveur pour la clé de secours. */
  identifiantsAdmin?: { username: string; password: string };
}) {
  const admin = mode === "admin";
  const [boutique, setBoutique] = useState<AbonnementBoutique | null>(null);
  const [etat, setEtat] = useState<EtatSauvegarde | null>(null);
  const [liste, setListe] = useState<ListeSauvegardes | null>(null);
  const [rubrique, setRubrique] = useState<Rubrique>("apercu");
  const [dossier, setDossier] = useState("");
  const [heure, setHeure] = useState("21:00");
  const [conservation, setConservation] = useState<Conservation>("progressive");
  const [secours, setSecours] = useState(false);
  /** Restauration : par le mot de passe du patron, ou par la clé de secours (il l'a perdu). */
  const [methode, setMethode] = useState<"motDePasse" | "secours">("motDePasse");
  const [fichierASecours, setFichierASecours] = useState<boolean | null>(null);
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  /** Restauration : dossier parcouru (nouvel appareil), copie choisie, confirmation. */
  const [dossierRestauration, setDossierRestauration] = useState<string | null>(null);
  const [fichier, setFichier] = useState("");
  const [motConfirmation, setMotConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  /** Mot de passe tout juste choisi, pour la fiche (jamais gardé ailleurs). */
  const [motDePasseFiche, setMotDePasseFiche] = useState("");

  async function charger(dossierListe: string | null = dossierRestauration) {
    const e = await api.sauvegarde.etat();
    setEtat(e);
    if (e.configuree) {
      setDossier(e.dossier ?? "");
      setHeure(e.heure ?? "21:00");
      setConservation(e.conservation ?? "progressive");
      setSecours(e.secours);
    }
    setListe(await api.sauvegarde.lister(dossierListe));
  }
  useEffect(() => {
    api.admin.boutiqueLocale().then(setBoutique);
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Restauration : la copie choisie a-t-elle une clé de secours ?
  useEffect(() => {
    setFichierASecours(null);
    if (fichier) api.sauvegarde.aUneCleSecours(fichier).then(setFichierASecours);
  }, [fichier]);

  function aller(r: Rubrique) {
    setErreur(null);
    setMessage(null);
    setMotDePasse("");
    setConfirmation("");
    setMotDePasseFiche("");
    setRubrique(r);
  }

  function verifierMotsDePasse(): boolean {
    if (motDePasse.length < 8) return setErreur("Le mot de passe doit faire au moins 8 caractères."), false;
    if (motDePasse !== confirmation) return setErreur("Les deux mots de passe ne sont pas identiques."), false;
    return true;
  }

  async function configurer() {
    setErreur(null);
    if (!boutique) return setErreur("Aucune boutique sur cet appareil : connectez-vous d'abord une fois.");
    if (!dossier) return setErreur("Choisissez le dossier des sauvegardes.");
    if (!verifierMotsDePasse()) return;
    setEnCours(true);
    const resultat = await api.sauvegarde.configurer({
      boutiqueId: boutique.boutiqueId,
      boutiqueNom: boutique.boutiqueNom,
      dossier,
      heure,
      conservation,
      motDePasse,
      secours,
    });
    setEnCours(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setMotDePasseFiche(motDePasse);
    setMotDePasse("");
    setConfirmation("");
    await charger();
  }

  async function enregistrerReglages() {
    setErreur(null);
    const resultat = await api.sauvegarde.modifierReglages({ dossier, heure, conservation, secours });
    if (!resultat.succes) return setErreur(resultat.message);
    await charger();
    setMessage("✅ Réglages enregistrés.");
  }

  async function changerMotDePasse() {
    setErreur(null);
    if (!verifierMotsDePasse()) return;
    setEnCours(true);
    const resultat = await api.sauvegarde.changerMotDePasse(motDePasse);
    setEnCours(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setMotDePasseFiche(motDePasse);
    setMotDePasse("");
    setConfirmation("");
    await charger();
  }

  async function sauvegarderMaintenant() {
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    const resultat = await api.sauvegarde.maintenant();
    setEnCours(false);
    await charger();
    if (!resultat.succes) return setErreur(resultat.message);
    setMessage(`✅ Sauvegarde faite : ${resultat.resultat.dernierFichier}`);
  }

  async function restaurer() {
    setErreur(null);
    if (!fichier) return setErreur("Choisissez la copie à restaurer.");
    if (methode === "motDePasse" && !motDePasse) return setErreur("Tapez le mot de passe du patron (fiche de récupération).");
    if (methode === "secours" && !identifiantsAdmin) return setErreur("Ouvrez la sauvegarde depuis l'Espace Admin.");
    if (motConfirmation.trim().toUpperCase() !== "RESTAURER") return setErreur("Tapez RESTAURER pour confirmer.");
    setEnCours(true);
    const resultat =
      methode === "secours" && identifiantsAdmin
        ? await api.sauvegarde.restaurerAvecSecours(fichier, identifiantsAdmin.username, identifiantsAdmin.password)
        : await api.sauvegarde.restaurer(fichier, motDePasse);
    setEnCours(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setMessage("✅ Sauvegarde restaurée : l'application redémarre…");
  }

  async function choisirDossierReglages() {
    const choisi = await api.sauvegarde.choisirDossier();
    if (choisi) setDossier(choisi);
  }

  async function parcourirDossierRestauration() {
    const choisi = await api.sauvegarde.choisirDossier();
    if (!choisi) return;
    setDossierRestauration(choisi);
    setFichier("");
    setListe(await api.sauvegarde.lister(choisi));
  }

  // ---------------------------------------------------------------------------

  const configuree = !!etat?.configuree;
  const rubriques: { cle: Rubrique; label: string; compteur?: string }[] = admin
    ? configuree
      ? [
          { cle: "apercu", label: "💾 Vue d'ensemble" },
          { cle: "copies", label: "🗂️ Copies", compteur: String(liste?.copies.length ?? 0) },
          { cle: "reglages", label: "⚙️ Réglages" },
          { cle: "motDePasse", label: "🔑 Mot de passe" },
          { cle: "restaurer", label: "♻️ Restaurer" },
        ]
      : [
          { cle: "apercu", label: "💾 Vue d'ensemble" },
          { cle: "parametrer", label: "⚙️ Paramétrer" },
          { cle: "restaurer", label: "♻️ Restaurer" },
        ]
    : configuree
      ? [
          { cle: "apercu", label: "💾 Vue d'ensemble" },
          { cle: "copies", label: "🗂️ Copies", compteur: String(liste?.copies.length ?? 0) },
        ]
      : [{ cle: "apercu", label: "💾 Vue d'ensemble" }];
  const rubriqueActive = rubriques.some((r) => r.cle === rubrique) ? rubrique : "apercu";

  const champsReglages = (
    <div className="champs-sauvegarde">
      <label>
        Dossier des sauvegardes
        <span className="ligne-dossier-sauvegarde">
          <input value={libelleDossier(dossier)} readOnly placeholder="Un dossier de Google Drive ou de la carte mémoire" />
          <button type="button" onClick={choisirDossierReglages}>
            Choisir…
          </button>
        </span>
      </label>
      <label>
        Heure de la sauvegarde quotidienne
        <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
      </label>
      <label>
        Conservation des sauvegardes
        <select value={conservation} onChange={(e) => setConservation(e.target.value as Conservation)}>
          <option value="progressive">Garder moins de copies en vieillissant (recommandé)</option>
          <option value="illimitee">Ne jamais supprimer</option>
        </select>
        <span className="note-aide">{EXPLICATION_CONSERVATION[conservation]}</span>
      </label>
      <label className="case-secours-sauvegarde">
        <span>
          <input type="checkbox" checked={secours} onChange={(e) => setSecours(e.target.checked)} /> 🛟 Clé de secours chez
          l'administrateur <strong>(avec l'accord du patron)</strong>
        </span>
        <span className="note-aide">
          Si le patron perd son mot de passe, l'administrateur pourra quand même restaurer ses copies (internet
          nécessaire). En contrepartie, l'administrateur peut ouvrir les sauvegardes. Sans cette case : personne d'autre
          que le patron. Ne vaut que pour les copies faites après le changement.
        </span>
      </label>
    </div>
  );

  const champsMotDePasse = (
    <div className="champs-sauvegarde">
      <p className="note-aide">
        <strong>Passez le clavier au patron :</strong> c'est lui qui choisit et tape ce mot de passe. Il sera imprimé sur
        une fiche de récupération à garder en lieu sûr.
      </p>
      <label>
        Mot de passe des sauvegardes (8 caractères au moins)
        <input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        Retaper le mot de passe
        <input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" />
      </label>
    </div>
  );

  function tableauCopies(options: { choix?: boolean }) {
    const copies = liste?.copies ?? [];
    const colonnes = admin ? 6 : 5;
    return (
      <>
        <div className="zone-tableau-scroll zone-appareils-reseau">
          <table className="tableau-catalogue tableau-appareils-reseau">
            <thead>
              <tr>
                <th className="colonne-numero-groupe">N°</th>
                <th>Date</th>
                <th>Heure</th>
                <th>Gardée comme</th>
                <th>Taille</th>
                {admin && <th className="colonne-action-reseau">{options.choix ? "Choix" : "Action"}</th>}
              </tr>
            </thead>
            <tbody>
              {copies.map((c, index) => {
                const date = new Date(c.date);
                const choisie = fichier === c.chemin;
                return (
                  <tr key={c.nom} className={choisie ? "ligne-copie-choisie" : undefined}>
                    <td className="colonne-numero-groupe">{index + 1}</td>
                    <td className="nowrap">
                      <strong>{date.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</strong>
                      {index === 0 && <span className="pastille-etat-reseau pastille-etat-reseau--relie badge-derniere-copie">la plus récente</span>}
                    </td>
                    <td className="nowrap">{date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td>
                      <span className={`pastille-categorie-copie pastille-categorie-copie--${c.categorie}`}>{LIBELLE_CATEGORIE[c.categorie]}</span>
                    </td>
                    <td className="nowrap">{taille(c.taille)}</td>
                    {admin && (
                      <td className="colonne-action-reseau">
                        {options.choix ? (
                          <button type="button" className={choisie ? "bouton-primaire" : undefined} onClick={() => setFichier(c.chemin)}>
                            {choisie ? "✓ Choisie" : "Choisir"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="lien"
                            onClick={() => {
                              aller("restaurer");
                              setFichier(c.chemin);
                            }}
                          >
                            Restaurer…
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {copies.length === 0 && (
                <tr>
                  <td colSpan={colonnes} className="liste-vide">
                    {liste && !liste.accessible
                      ? "Dossier inaccessible (Google Drive déconnecté ? carte mémoire retirée ? Choisissez-le à nouveau)."
                      : "Aucune copie dans ce dossier."}
                  </td>
                </tr>
              )}
              {Array.from({ length: Math.max(0, 8 - Math.max(1, copies.length)) }).map((_, i) => (
                <tr key={`vide-${i}`} className="ligne-groupe-vide">
                  {Array.from({ length: colonnes }).map((__, j) => (
                    <td key={j}>&nbsp;</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totaux">
          <div>
            {copies.length} copie{copies.length > 1 ? "s" : ""} · {taille(liste?.tailleTotale ?? 0)} au total
          </div>
          {api.sauvegarde.peutOuvrirDossier && liste?.dossier && liste.accessible && (
            <button type="button" className="lien" onClick={() => api.sauvegarde.ouvrirDossier(liste.dossier!)}>
              📂 Ouvrir le dossier
            </button>
          )}
        </div>
      </>
    );
  }

  // --- Vue d'ensemble ---
  function vueEnsemble() {
    if (!etat) return <p className="sous-info">Chargement…</p>;
    let icone = "💾";
    let titre: string;
    let sousTitre: string;
    let ton: Ton;
    let etape: { ton: Ton; texte: ReactNode; action?: { libelle: string; onClick: () => void } };
    if (!configuree) {
      icone = "⚪";
      titre = "Aucune sauvegarde sur cet appareil";
      sousTitre = "Les données de la boutique n'existent que sur cet appareil (et en ligne si l'envoi est autorisé).";
      ton = "neutre";
      etape = admin
        ? {
            ton: "attention",
            texte:
              "Paramétrez la sauvegarde : avec l'appli Google Drive connectée au compte Google de la boutique, créez un dossier « Sauvegardes », puis choisissez-le ici (ou un dossier de la carte mémoire).",
            action: { libelle: "⚙️ Paramétrer", onClick: () => aller("parametrer") },
          }
        : {
            ton: "attention",
            texte: "Demandez à votre administrateur de paramétrer la sauvegarde : c'est indispensable en 100 % local.",
          };
    } else {
      const enRetard = etat.alerte !== "aucune";
      icone = enRetard ? "⚠️" : "✅";
      titre = enRetard ? "Sauvegarde en retard" : "Sauvegarde à jour";
      sousTitre = `Dernière : ${quand(etat.derniereSauvegarde)} · prochaine : ${quand(etat.prochaine)}`;
      ton = enRetard ? (etat.alerte === "echecs" ? "alerte" : "attention") : "ok";
      etape = enRetard
        ? {
            ton: "alerte",
            texte: `${etat.derniereErreur ?? "Aucune sauvegarde réussie depuis plusieurs jours."} Vérifiez que Google Drive est connecté (ou la carte mémoire en place), puis réessayez.${admin ? "" : " Si ça continue, prévenez votre administrateur."}`,
            action: { libelle: "💾 Réessayer maintenant", onClick: sauvegarderMaintenant },
          }
        : {
            ton: "ok",
            texte: `Tout va bien : une copie chiffrée est faite chaque jour à ${etat.heure}, et Google l'envoie dès qu'internet passe.`,
          };
    }

    const copies = liste?.copies ?? [];
    const parCategorie = (c: CopieSauvegarde["categorie"]) => copies.filter((x) => x.categorie === c).length;
    const cartes: { cle: string; titre: string; lignes: ReactNode[]; onClick?: () => void }[] = configuree
      ? [
          {
            cle: "derniere",
            titre: "🕘 Dernière",
            lignes: [
              <strong key="d">{quand(etat.derniereSauvegarde)}</strong>,
              <span key="f" className="sous-info ligne-appareil-carte">{etat.dernierFichier ?? "—"}</span>,
            ],
          },
          {
            cle: "prochaine",
            titre: "⏰ Prochaine",
            lignes: [<strong key="p">{quand(etat.prochaine)}</strong>, <span key="h" className="sous-info">chaque jour à {etat.heure}</span>],
          },
          {
            cle: "copies",
            titre: "🗂️ Copies",
            onClick: () => aller("copies"),
            lignes: [
              <strong key="n">
                {copies.length} copie{copies.length > 1 ? "s" : ""} · {taille(liste?.tailleTotale ?? 0)}
              </strong>,
              <span key="r" className="sous-info">
                {parCategorie("jour")} quotidienne(s) · {parCategorie("semaine")} hebdo · {parCategorie("mois")} mensuelle(s)
              </span>,
            ],
          },
          {
            cle: "conservation",
            titre: "♾️ Conservation",
            onClick: admin ? () => aller("reglages") : undefined,
            lignes: [
              <strong key="c">{etat.conservation === "illimitee" ? "Ne jamais supprimer" : "Progressive"}</strong>,
              <span key="e" className="sous-info">
                {etat.conservation === "illimitee" ? "toutes les copies sont gardées" : "jour → semaine → mois, pour toujours"}
              </span>,
            ],
          },
          {
            cle: "dossier",
            titre: "📂 Dossier",
            onClick: api.sauvegarde.peutOuvrirDossier && liste?.accessible && etat.dossier ? () => api.sauvegarde.ouvrirDossier(etat.dossier!) : undefined,
            lignes: [
              <strong key="a">{liste?.accessible ? "✓ Accessible" : "✕ Introuvable"}</strong>,
              <span key="d" className="sous-info ligne-appareil-carte" title={libelleDossier(etat.dossier)}>
                {libelleDossier(etat.dossier)}
              </span>,
            ],
          },
          {
            cle: "securite",
            titre: "🔒 Sécurité",
            onClick: admin ? () => aller("motDePasse") : undefined,
            lignes: [
              <strong key="c">Chiffrée</strong>,
              <span key="m" className="sous-info">mot de passe du patron (fiche de récupération)</span>,
              <span key="s" className="sous-info">🛟 clé de secours : {etat.secours ? "oui (administrateur)" : "non"}</span>,
            ],
          },
        ]
      : [];

    return (
      <>
        <div className={`carte-etat-serveur carte-etat-serveur--${CLASSE_TON[ton]}`}>
          <div className="entete-vue-ensemble">
            <span className="icone-vue-ensemble">{icone}</span>
            <div>
              <strong className="etat-serveur-titre">{titre}</strong>
              <span className="sous-info ligne-detail-article">{sousTitre}</span>
            </div>
          </div>
          {configuree && (
            <button type="button" className="bouton-primaire" disabled={enCours} onClick={sauvegarderMaintenant}>
              {enCours ? "Sauvegarde…" : "💾 Sauvegarder maintenant"}
            </button>
          )}
        </div>

        <div className={`prochaine-etape prochaine-etape--${etape.ton}`}>
          <div>
            <span className="libelle-prochaine-etape">{etape.ton === "ok" ? "✓ État" : "👉 Prochaine étape"}</span>
            <p>{etape.texte}</p>
          </div>
          {etape.action && (
            <button type="button" className="bouton-primaire" disabled={enCours} onClick={etape.action.onClick}>
              {etape.action.libelle}
            </button>
          )}
        </div>

        {cartes.length > 0 && (
          <div className="grille-cartes-reseau">
            {cartes.map((c) =>
              c.onClick ? (
                <button key={c.cle} type="button" className="carte-info-reseau cliquable" onClick={c.onClick}>
                  <span className="titre-carte-reseau">
                    {c.titre} <span className="sous-info">›</span>
                  </span>
                  {c.lignes}
                </button>
              ) : (
                <div key={c.cle} className="carte-info-reseau">
                  <span className="titre-carte-reseau">{c.titre}</span>
                  {c.lignes}
                </div>
              ),
            )}
          </div>
        )}

        {!admin && configuree && (
          <p className="note-aide">Pour modifier les réglages ou restaurer une sauvegarde, contactez votre administrateur.</p>
        )}
      </>
    );
  }

  function contenu() {
    if (motDePasseFiche && boutique) {
      return (
        <>
          <h4 className="titre-rubrique-reseau">🖨️ Fiche de récupération</h4>
          <div className="message-succes">
            ✅ Mot de passe enregistré et sauvegarde faite. Imprimez la fiche : <strong>deux exemplaires</strong>, un à
            la boutique et un chez le patron, dans deux endroits différents. Détruisez l'ancienne fiche s'il y en avait une.
          </div>
          <FichesRecuperation boutiqueNom={boutique.boutiqueNom} motDePasse={motDePasseFiche} dossier={libelleDossier(dossier)} secours={secours} />
          <div className="actions-formulaire">
            <button type="button" className="bouton-primaire" onClick={imprimerFiche}>
              🖨️ Imprimer les deux exemplaires
            </button>
            <button type="button" onClick={() => aller("apercu")}>
              Terminé
            </button>
          </div>
        </>
      );
    }
    switch (rubriqueActive) {
      case "copies":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🗂️ Copies de sauvegarde</h4>
            <p className="note-aide">
              {etat?.conservation === "illimitee"
                ? "Toutes les copies sont gardées."
                : "Quotidiennes : les 30 derniers jours · Hebdomadaires : jusqu'à 6 mois · Mensuelles : au-delà, pour toujours."}
            </p>
            {tableauCopies({})}
          </>
        );
      case "parametrer":
        return (
          <>
            <h4 className="titre-rubrique-reseau">⚙️ Paramétrer la sauvegarde</h4>
            <p className="note-aide">
              Faites-le sur le poste principal (celui qui a toutes les données). Avant : installez l'appli Google Drive,
              connectez-la au compte Google de la boutique et créez un dossier « Sauvegardes ».
            </p>
            {champsReglages}
            {champsMotDePasse}
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" disabled={enCours} onClick={configurer}>
                {enCours ? "Première sauvegarde…" : "Activer et faire la première sauvegarde"}
              </button>
            </div>
          </>
        );
      case "reglages":
        return (
          <>
            <h4 className="titre-rubrique-reseau">⚙️ Réglages</h4>
            {champsReglages}
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" onClick={enregistrerReglages}>
                Enregistrer les réglages
              </button>
            </div>
            <div className="zone-danger-reseau">
              <div>
                <strong>Désactiver la sauvegarde</strong>
                <p className="note-aide">Plus aucune copie ne sera faite ; celles déjà faites restent dans le dossier.</p>
              </div>
              <button
                type="button"
                className="bouton-danger"
                onClick={async () => {
                  await api.sauvegarde.desactiver();
                  await charger();
                  aller("apercu");
                  setMessage("Sauvegarde désactivée sur cet appareil (les fichiers déjà faits restent dans le dossier).");
                }}
              >
                Désactiver
              </button>
            </div>
          </>
        );
      case "motDePasse":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🔑 Changer le mot de passe</h4>
            <p className="note-aide">
              Les sauvegardes suivantes utiliseront le nouveau mot de passe ; les anciennes gardent l'ancien (gardez aussi
              l'ancienne fiche tant qu'elles existent).
            </p>
            {champsMotDePasse}
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" disabled={enCours} onClick={changerMotDePasse}>
                Changer et sauvegarder
              </button>
            </div>
          </>
        );
      case "restaurer":
        return (
          <>
            <h4 className="titre-rubrique-reseau">♻️ Restaurer une sauvegarde</h4>
            <p className="note-aide texte-erreur">
              Les données actuelles de cet appareil seront remplacées par celles de la copie choisie (une copie de l'état actuel
              est d'abord déposée dans le dossier des sauvegardes, au cas où). L'application redémarre ensuite.
            </p>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">1</span>
              <div className="champ-etape-reseau">
                <strong>Choisir la copie</strong>
                <span className="note-aide">
                  Dossier : {liste?.dossier ? libelleDossier(liste.dossier) : "aucun"}{" "}
                  <button type="button" className="lien" onClick={parcourirDossierRestauration}>
                    {configuree ? "Autre dossier…" : "Choisir le dossier des sauvegardes…"}
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="lien"
                    onClick={async () => {
                      const choisi = await api.sauvegarde.choisirFichier();
                      if (choisi) setFichier(choisi);
                    }}
                  >
                    Choisir un fichier…
                  </button>
                </span>
                {tableauCopies({ choix: true })}
                {fichier && !liste?.copies.some((c) => c.chemin === fichier) && (
                  <span className="note-aide">
                    Fichier choisi : <strong>{libelleDossier(fichier)}</strong>
                  </span>
                )}
              </div>
            </div>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">2</span>
              <div className="champ-etape-reseau champs-sauvegarde">
                <div className="choix-methode-restauration">
                  <label>
                    <input type="radio" checked={methode === "motDePasse"} onChange={() => setMethode("motDePasse")} /> 🔑 Mot
                    de passe du patron
                  </label>
                  <label>
                    <input type="radio" checked={methode === "secours"} onChange={() => setMethode("secours")} /> 🛟 Clé de
                    secours (le patron a perdu son mot de passe)
                  </label>
                </div>
                {methode === "motDePasse" ? (
                  <label>
                    Mot de passe du patron (sur la fiche de récupération)
                    <input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
                  </label>
                ) : (
                  <p className={`note-aide${fichier && fichierASecours === false ? " texte-erreur" : ""}`}>
                    {!fichier
                      ? "Choisissez d'abord la copie."
                      : fichierASecours === false
                        ? "Cette copie n'a pas de clé de secours (option non cochée quand elle a été faite) : seul le mot de passe du patron peut l'ouvrir."
                        : `Cette copie a une clé de secours. Elle sera ouverte par votre serveur avec les identifiants de l'Espace Admin (${identifiantsAdmin?.username ?? "?"}) — internet nécessaire ; les données de la boutique ne quittent pas cet appareil.`}
                  </p>
                )}
                <label>
                  Tapez RESTAURER pour confirmer
                  <input value={motConfirmation} onChange={(e) => setMotConfirmation(e.target.value)} />
                </label>
              </div>
            </div>
            <div className="actions-formulaire">
              <button
                type="button"
                className="bouton-danger"
                disabled={enCours || !fichier || (methode === "secours" && fichierASecours === false)}
                onClick={restaurer}
              >
                {enCours ? "Restauration…" : "♻️ Restaurer cette copie"}
              </button>
            </div>
          </>
        );
      default:
        return vueEnsemble();
    }
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-sauvegarde" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>💾 Sauvegarde{boutique ? ` — ${boutique.boutiqueNom}` : ""}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="disposition-parametres">
            <nav className="barre-laterale-parametres barre-laterale-reseau">
              <div
                className={`role-reseau role-reseau--${!configuree ? "neutre" : etat?.alerte === "aucune" ? "ok" : "alerte"}`}
              >
                <span className="sous-info">Sauvegarde</span>
                <strong>{!etat ? "…" : !configuree ? "Non paramétrée" : etat.alerte === "aucune" ? "À jour" : "En retard"}</strong>
              </div>
              {rubriques.map((r) => (
                <button
                  key={r.cle}
                  type="button"
                  className={`item-nav-parametres${rubriqueActive === r.cle ? " actif" : ""}`}
                  onClick={() => aller(r.cle)}
                >
                  {r.label}
                  {r.compteur && <span className="compteur-nav-reseau">{r.compteur}</span>}
                </button>
              ))}
              <p className="note-aide note-barre-sauvegarde">
                {admin ? "Espace Admin : tous les réglages." : "Consultation : les réglages se font dans l'Espace Admin."}
              </p>
            </nav>
            <div className="contenu-parametres contenu-reseau">
              {erreur && <div className="message-erreur">{erreur}</div>}
              {message && <div className="message-succes">{message}</div>}
              {contenu()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Espace Admin → Sauvegarde. */
export default function ModaleSauvegardeAdmin({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  return <ModaleSauvegarde mode="admin" onFermer={onFermer} identifiantsAdmin={{ username, password }} />;
}
