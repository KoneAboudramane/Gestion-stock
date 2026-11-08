import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { CompteAdmin } from "../api/types";
import ChampNouveauMotDePasse from "../components/ChampNouveauMotDePasse";
import FicheAcces from "../components/FicheAcces";
import { soliditeMotDePasse } from "../lib/motDePasse";

/** Accès aux données (seule partie qui diffère avec client-web/src/pages/ReinitialiserMotDePasseAdmin.tsx). */
const appels = {
  lister: (username: string, password: string) => api.auth.listerComptesAdmin(username, password),
  aRefaire: (): Promise<string[]> => api.auth.reinitialisationsARefaire(),
  reinitialiser: (username: string, password: string, cible: string, motDePasse: string, doitChanger: boolean) =>
    api.auth.reinitialiserMotDePasseAdmin(username, password, cible, motDePasse, doitChanger),
  whatsapp: (texte: string, telephone: string) =>
    api.systeme.ouvrirExterne(`https://wa.me/${telephone.replace(/\D/g, "")}?text=${encodeURIComponent(texte)}`),
  imprimer: () => {
    document.body.classList.add("impression-fiche");
    window.print();
    document.body.classList.remove("impression-fiche");
  },
};

type Rubrique = "compte" | "motDePasse" | "aRefaire";
type Filtre = "tous" | "patrons" | "provisoires" | "aRefaire" | "desactives";
type Tri = "connexion" | "nom" | "boutique";

const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: "tous", libelle: "Tous" },
  { cle: "patrons", libelle: "👑 Patrons" },
  { cle: "provisoires", libelle: "⏳ Provisoires" },
  { cle: "aRefaire", libelle: "🔁 À refaire en ligne" },
  { cle: "desactives", libelle: "⛔ Désactivés" },
];

function dateCourte(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

/**
 * Carte « Réinitialiser mot de passe » de l'Espace Admin : n'importe quel compte
 * de boutique (patron, gérant, vendeur — jamais un administrateur), choisi dans la
 * liste de toutes les boutiques (recherche, filtres, tri) — rien n'est deviné.
 * Identifiants de l'Espace Admin réutilisés, revérifiés par le serveur.
 *
 * Mot de passe provisoire (« changer à la prochaine connexion », proposé coché) ;
 * « 🎲 Générer » propose un mot de passe facile à dicter. À la fin : fiche des
 * accès (copier, WhatsApp, imprimer).
 *
 * Sans internet : sur ce poste seulement (comptes déjà connus de cet ordinateur) ;
 * le serveur garde l'ancien mot de passe et le compte est noté « à refaire en
 * ligne » — le mot de passe n'est jamais gardé en clair pour plus tard.
 */
export default function ReinitialiserMotDePasseAdmin({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [comptes, setComptes] = useState<CompteAdmin[] | null>(null);
  const [source, setSource] = useState<"serveur" | "poste">("serveur");
  const [aRefaire, setARefaire] = useState<string[]>([]);
  const [rubrique, setRubrique] = useState<Rubrique>("compte");
  const [recherche, setRecherche] = useState("");
  const [filtreBoutique, setFiltreBoutique] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [tri, setTri] = useState<Tri>("connexion");
  const [cible, setCible] = useState<CompteAdmin | null>(null);
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [doitChanger, setDoitChanger] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<{ compte: CompteAdmin; motDePasse: string; statut: "enLigne" | "local"; provisoire: boolean } | null>(null);

  async function charger() {
    const r = await appels.lister(username, password);
    if (r.succes) {
      setComptes(r.resultat.comptes);
      setSource(r.resultat.source);
    } else {
      setComptes([]);
      setErreur(r.message);
    }
    setARefaire(await appels.aRefaire());
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boutiques = useMemo(
    () => [...new Set((comptes ?? []).map((c) => c.boutiqueNom).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [comptes],
  );
  const compteurs = useMemo(() => {
    const liste = comptes ?? [];
    return {
      tous: liste.length,
      patrons: liste.filter((c) => c.role === "Patron").length,
      provisoires: liste.filter((c) => c.doitChangerMotDePasse).length,
      aRefaire: liste.filter((c) => aRefaire.includes(c.username)).length,
      desactives: liste.filter((c) => !c.actif).length,
    } satisfies Record<Filtre, number>;
  }, [comptes, aRefaire]);
  const filtres = useMemo(() => {
    const texte = recherche.trim().toLowerCase();
    const liste = (comptes ?? []).filter(
      (c) =>
        (!filtreBoutique || c.boutiqueNom === filtreBoutique) &&
        (filtre === "tous" ||
          (filtre === "patrons" && c.role === "Patron") ||
          (filtre === "provisoires" && c.doitChangerMotDePasse) ||
          (filtre === "aRefaire" && aRefaire.includes(c.username)) ||
          (filtre === "desactives" && !c.actif)) &&
        (!texte || [c.username, c.nom, c.boutiqueNom, c.role, c.telephone].some((v) => (v ?? "").toLowerCase().includes(texte))),
    );
    return [...liste].sort((a, b) =>
      tri === "nom"
        ? a.username.localeCompare(b.username)
        : tri === "boutique"
          ? (a.boutiqueNom || "").localeCompare(b.boutiqueNom || "") || a.username.localeCompare(b.username)
          : (b.derniereConnexion ?? "").localeCompare(a.derniereConnexion ?? ""),
    );
  }, [comptes, recherche, filtreBoutique, filtre, tri, aRefaire]);

  function aller(r: Rubrique) {
    setErreur(null);
    setRubrique(r);
  }

  function choisir(c: CompteAdmin) {
    setCible(c);
    setErreur(null);
    setMotDePasse("");
    setConfirmation("");
    setRubrique("motDePasse");
  }

  async function reinitialiser() {
    setErreur(null);
    if (!cible) return setErreur("Choisissez le compte.");
    const solidite = soliditeMotDePasse(motDePasse, cible.username);
    if (solidite.manques.length) return setErreur(`Mot de passe : ${solidite.manques.join(", ")}.`);
    if (motDePasse !== confirmation) return setErreur("Les deux mots de passe ne sont pas identiques.");
    setEnCours(true);
    const r = await appels.reinitialiser(username, password, cible.username, motDePasse, doitChanger);
    setEnCours(false);
    if (!r.succes) return setErreur(r.message);
    setResultat({ compte: cible, motDePasse, statut: r.resultat.statut, provisoire: doitChanger });
    setARefaire(await appels.aRefaire());
  }

  function recommencer() {
    setResultat(null);
    setCible(null);
    setMotDePasse("");
    setConfirmation("");
    setDoitChanger(true);
    setRubrique("compte");
    charger();
  }

  function pastilleEtat(c: CompteAdmin) {
    if (!c.actif) return <span className="pastille-etat-reseau">Désactivé</span>;
    if (aRefaire.includes(c.username)) return <span className="pastille-etat-reseau">À refaire en ligne</span>;
    if (c.doitChangerMotDePasse) return <span className="pastille-etat-reseau">Mot de passe provisoire</span>;
    return <span className="pastille-etat-reseau pastille-etat-reseau--relie">Actif</span>;
  }

  function contenu() {
    if (resultat) {
      const texte = `Vos accès Gestion Stock${resultat.compte.boutiqueNom ? ` (${resultat.compte.boutiqueNom})` : ""} :\nIdentifiant : ${resultat.compte.username}\nMot de passe${resultat.provisoire ? " provisoire" : ""} : ${resultat.motDePasse}${resultat.provisoire ? "\nVous choisirez votre propre mot de passe à la connexion." : ""}`;
      return (
        <>
          <div className="carte-etat-serveur carte-etat-serveur--marche">
            <div className="entete-vue-ensemble">
              <span className="icone-vue-ensemble">✅</span>
              <div>
                <strong className="etat-serveur-titre">Mot de passe réinitialisé</strong>
                <span className="sous-info ligne-detail-article">
                  {resultat.statut === "enLigne"
                    ? "Sur le serveur et sur cet appareil : le compte peut se connecter partout."
                    : "Sur cet appareil seulement (pas d'internet)."}
                </span>
              </div>
            </div>
          </div>
          {resultat.statut === "local" && (
            <div className="prochaine-etape prochaine-etape--attention">
              <div>
                <span className="libelle-prochaine-etape">À refaire en ligne</span>
                <p>
                  Le serveur garde l'ancien mot de passe : sur un autre appareil, ou en ligne, c'est encore l'ancien qui
                  marche. Refaites cette réinitialisation quand internet sera là (le compte est noté ici).
                </p>
              </div>
            </div>
          )}
          <FicheAcces
            titre="Nouveaux accès"
            details={[
              ...(resultat.compte.boutiqueNom ? [{ libelle: "Boutique", valeur: resultat.compte.boutiqueNom }] : []),
              ...(resultat.compte.nom ? [{ libelle: "Nom", valeur: resultat.compte.nom }] : []),
              { libelle: "Date", valeur: new Date().toLocaleDateString("fr-FR") },
            ]}
            identifiant={resultat.compte.username}
            motDePasse={resultat.motDePasse}
            provisoire={resultat.provisoire}
            texteAPartager={texte}
            telephone={resultat.compte.telephone}
            onWhatsapp={appels.whatsapp}
            onImprimer={appels.imprimer}
            actionPrincipale={
              <button type="button" onClick={recommencer}>
                ↺ Réinitialiser un autre compte
              </button>
            }
          />
        </>
      );
    }
    switch (rubrique) {
      case "motDePasse":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🔑 Nouveau mot de passe</h4>
            {!cible ? (
              <div className="prochaine-etape prochaine-etape--neutre">
                <div>
                  <span className="libelle-prochaine-etape">Aucun compte choisi</span>
                  <p>Choisissez d'abord le compte dans la liste.</p>
                </div>
                <button type="button" className="bouton-primaire" onClick={() => aller("compte")}>
                  👤 Choisir le compte
                </button>
              </div>
            ) : (
              <>
                <div className="carte-compte-choisi">
                  <span className="icone-option-admin">👤</span>
                  <div className="textes-option-admin">
                    <strong>{cible.username}</strong>
                    <span className="sous-info">
                      {[cible.nom, cible.boutiqueNom, cible.role, cible.telephone].filter(Boolean).join(" · ")}
                    </span>
                    {pastilleEtat(cible)}
                  </div>
                  <button type="button" className="lien" onClick={() => aller("compte")}>
                    Changer de compte
                  </button>
                </div>
                {!cible.actif && (
                  <p className="message-erreur">Ce compte est désactivé : réactivez-le d'abord (Informations boutique → Utilisateurs).</p>
                )}
                <div className="champs-sauvegarde">
                  <ChampNouveauMotDePasse
                    valeur={motDePasse}
                    confirmation={confirmation}
                    identifiant={cible.username}
                    onChange={(v, c) => {
                      setMotDePasse(v);
                      setConfirmation(c);
                    }}
                  />
                  <label className="carte-option-boutique">
                    <input type="checkbox" checked={doitChanger} onChange={(e) => setDoitChanger(e.target.checked)} />
                    <span>
                      <strong>Mot de passe provisoire</strong>
                      <span className="note-aide">
                        Recommandé : l'utilisateur choisit le sien à sa prochaine connexion ; vous seul connaissez celui-ci.
                      </span>
                    </span>
                  </label>
                </div>
                <div className="actions-formulaire">
                  <button type="button" className="bouton-primaire" disabled={enCours || !cible.actif} onClick={reinitialiser}>
                    {enCours ? "Enregistrement…" : "🔑 Réinitialiser"}
                  </button>
                </div>
              </>
            )}
          </>
        );
      case "aRefaire":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🔁 À refaire en ligne</h4>
            <p className="note-aide">
              Comptes réinitialisés sans internet sur cet appareil : le serveur garde leur ancien mot de passe. Refaites-les
              une fois connecté.
            </p>
            {aRefaire.length === 0 ? (
              <p className="sous-titre">Rien à refaire.</p>
            ) : (
              <ul className="liste-a-refaire">
                {aRefaire.map((u) => {
                  const compte = comptes?.find((c) => c.username === u);
                  return (
                    <li key={u}>
                      <span>
                        <strong>{u}</strong>
                        {compte?.boutiqueNom && <span className="sous-info"> · {compte.boutiqueNom}</span>}
                      </span>
                      {compte && source === "serveur" ? (
                        <button type="button" className="bouton-primaire" onClick={() => choisir(compte)}>
                          Refaire
                        </button>
                      ) : (
                        <span className="sous-info">{source === "poste" ? "internet nécessaire" : ""}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        );
      default:
        return (
          <>
            <h4 className="titre-rubrique-reseau">👤 Choisir le compte</h4>
            {source === "poste" && (
              <div className="prochaine-etape prochaine-etape--neutre">
                <div>
                  <span className="libelle-prochaine-etape">Sans connexion au serveur</span>
                  <p>
                    Seuls les comptes déjà connus de cet appareil sont affichés. La réinitialisation ne vaudra que sur cet
                    appareil (le serveur gardera l'ancien mot de passe) : à refaire une fois connecté.
                  </p>
                </div>
                <button type="button" onClick={() => charger()}>
                  ⟳ Réessayer
                </button>
              </div>
            )}
            <div className="puces-filtres-comptes">
              {FILTRES.map((f) => (
                <button
                  key={f.cle}
                  type="button"
                  className={`puce-nom-poste${filtre === f.cle ? " choisi" : ""}`}
                  onClick={() => setFiltre(f.cle)}
                >
                  {f.libelle} <span className="compteur-puce">{compteurs[f.cle]}</span>
                </button>
              ))}
            </div>
            <div className="barre-filtres-comptes">
              <input
                type="search"
                className="champ-recherche-comptes"
                placeholder="🔍 Rechercher : identifiant, nom, boutique, rôle, téléphone…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                autoFocus
              />
              <select value={filtreBoutique} onChange={(e) => setFiltreBoutique(e.target.value)}>
                <option value="">Toutes les boutiques ({boutiques.length})</option>
                {boutiques.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <select value={tri} onChange={(e) => setTri(e.target.value as Tri)} aria-label="Trier">
                <option value="connexion">Trier : dernière connexion</option>
                <option value="nom">Trier : identifiant</option>
                <option value="boutique">Trier : boutique</option>
              </select>
            </div>
            <div className="zone-tableau-scroll zone-comptes-admin">
              <table className="tableau-catalogue carte-mobile tableau-appareils-reseau">
                <thead>
                  <tr>
                    <th>Compte</th>
                    <th>Boutique</th>
                    <th>Rôle</th>
                    <th>Dernière connexion</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {comptes === null && (
                    <tr>
                      <td colSpan={5} className="liste-vide">
                        Chargement…
                      </td>
                    </tr>
                  )}
                  {filtres.map((c) => (
                    <tr
                      key={c.username}
                      className={`ligne-cliquable${cible?.username === c.username ? " ligne-copie-choisie" : ""}`}
                      onClick={() => choisir(c)}
                    >
                      <td data-label="Compte">
                        <strong>{c.username}</strong>
                        {c.nom && <span className="sous-info ligne-detail-article">{c.nom}</span>}
                      </td>
                      <td data-label="Boutique">{c.boutiqueNom || "—"}</td>
                      <td data-label="Rôle">{c.role || "—"}</td>
                      <td data-label="Dernière connexion" className="nowrap">
                        {dateCourte(c.derniereConnexion)}
                      </td>
                      <td data-label="État">{pastilleEtat(c)}</td>
                    </tr>
                  ))}
                  {comptes !== null && filtres.length === 0 && (
                    <tr>
                      <td colSpan={5} className="liste-vide">
                        Aucun compte ne correspond.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <span className="note-aide">
              {filtres.length} compte{filtres.length > 1 ? "s" : ""}
              {source === "serveur" ? " · tous les comptes de vos boutiques (jamais les administrateurs)" : " · connus de cet appareil"}
              {" · cliquez sur un compte pour le choisir"}
            </span>
          </>
        );
    }
  }

  const rubriques: { cle: Rubrique; label: string; compteur?: string }[] = [
    { cle: "compte", label: "👤 Choisir le compte" },
    { cle: "motDePasse", label: "🔑 Nouveau mot de passe" },
    { cle: "aRefaire", label: "🔁 À refaire en ligne", compteur: aRefaire.length ? String(aRefaire.length) : undefined },
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>🔑 Réinitialiser mot de passe</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="disposition-parametres">
            <nav className="barre-laterale-parametres barre-laterale-reseau">
              <div className={`role-reseau role-reseau--${source === "poste" || aRefaire.length ? "alerte" : "ok"}`}>
                <span className="sous-info">Comptes</span>
                <strong>{comptes === null ? "…" : `${comptes.length} compte(s)`}</strong>
                <span className="sous-info">{source === "serveur" ? "🌐 lus sur le serveur" : "📴 connus de cet appareil"}</span>
                {cible && <span className="sous-info">Choisi : {cible.username}</span>}
              </div>
              {rubriques.map((r) => (
                <button
                  key={r.cle}
                  type="button"
                  className={`item-nav-parametres${rubrique === r.cle && !resultat ? " actif" : ""}`}
                  onClick={() => {
                    setResultat(null);
                    aller(r.cle);
                  }}
                >
                  {r.label}
                  {r.compteur && <span className="compteur-nav-reseau">{r.compteur}</span>}
                </button>
              ))}
            </nav>
            <div className="contenu-parametres contenu-reseau">
              {erreur && <div className="message-erreur">{erreur}</div>}
              {contenu()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
