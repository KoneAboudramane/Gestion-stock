import { useEffect, useMemo, useState } from "react";

import { listerComptesAdmin, lireReinitialisationsARefaire, reinitialiserMotDePasseAdmin, type CompteAdmin } from "../api/auth";
import ChampNouveauMotDePasse from "../components/ChampNouveauMotDePasse";
import { soliditeMotDePasse } from "../lib/motDePasse";

/**
 * Port navigateur de client-electron/src/pages/ReinitialiserMotDePasseAdmin.tsx.
 * Carte « Réinitialiser mot de passe » de l'Espace Admin (voir
 * AccesCreationBoutique.tsx) : n'importe quel compte de boutique (patron,
 * gérant, vendeur — jamais un administrateur), choisi dans la liste de toutes
 * les boutiques (recherche, filtre) — rien n'est deviné. Identifiants de
 * l'Espace Admin réutilisés, revérifiés par le serveur.
 *
 * Mot de passe provisoire (« changer à la prochaine connexion », proposé coché) :
 * l'utilisateur choisit le sien en se connectant. À la fin : copier, WhatsApp,
 * imprimer les nouveaux accès.
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
  const [recherche, setRecherche] = useState("");
  const [filtreBoutique, setFiltreBoutique] = useState("");
  const [cible, setCible] = useState<CompteAdmin | null>(null);
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [doitChanger, setDoitChanger] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<{ compte: CompteAdmin; motDePasse: string; statut: "enLigne" | "local" } | null>(null);
  const [copie, setCopie] = useState(false);

  async function charger() {
    const r = await listerComptesAdmin(username, password);
    if (r.succes) {
      setComptes(r.resultat.comptes);
      setSource(r.resultat.source);
    } else {
      setComptes([]);
      setErreur(r.message);
    }
    setARefaire(lireReinitialisationsARefaire());
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boutiques = useMemo(
    () => [...new Set((comptes ?? []).map((c) => c.boutiqueNom).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [comptes],
  );
  const filtres = useMemo(() => {
    const texte = recherche.trim().toLowerCase();
    return (comptes ?? []).filter(
      (c) =>
        (!filtreBoutique || c.boutiqueNom === filtreBoutique) &&
        (!texte || [c.username, c.nom, c.boutiqueNom, c.role, c.telephone].some((v) => v.toLowerCase().includes(texte))),
    );
  }, [comptes, recherche, filtreBoutique]);

  async function reinitialiser() {
    setErreur(null);
    if (!cible) return setErreur("Choisissez le compte.");
    const solidite = soliditeMotDePasse(motDePasse, cible.username);
    if (solidite.manques.length) return setErreur(`Mot de passe : ${solidite.manques.join(", ")}.`);
    if (motDePasse !== confirmation) return setErreur("Les deux mots de passe ne sont pas identiques.");
    setEnCours(true);
    const r = await reinitialiserMotDePasseAdmin(username, password, cible.username, motDePasse, doitChanger);
    setEnCours(false);
    if (!r.succes) return setErreur(r.message);
    setResultat({ compte: cible, motDePasse, statut: r.resultat.statut });
    setARefaire(lireReinitialisationsARefaire());
  }

  function recommencer() {
    setResultat(null);
    setCible(null);
    setMotDePasse("");
    setConfirmation("");
    setDoitChanger(true);
    setCopie(false);
    charger();
  }

  const texteAcces = resultat
    ? `Vos accès Gestion Stock${resultat.compte.boutiqueNom ? ` (${resultat.compte.boutiqueNom})` : ""} :\nIdentifiant : ${resultat.compte.username}\nMot de passe${doitChanger ? " provisoire" : ""} : ${resultat.motDePasse}${doitChanger ? "\nVous choisirez votre propre mot de passe à la connexion." : ""}`
    : "";

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-mot-de-passe-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>🔑 Réinitialiser mot de passe</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps contenu-reseau">
          {erreur && <div className="message-erreur">{erreur}</div>}

          {resultat ? (
            <>
              <div className="carte-etat-serveur carte-etat-serveur--marche">
                <div className="entete-vue-ensemble">
                  <span className="icone-vue-ensemble">✅</span>
                  <div>
                    <strong className="etat-serveur-titre">Mot de passe réinitialisé</strong>
                    <span className="sous-info ligne-detail-article">
                      {resultat.statut === "enLigne"
                        ? "Sur le serveur et sur cet ordinateur : le compte peut se connecter partout."
                        : "Sur cet ordinateur seulement (pas d'internet)."}
                    </span>
                  </div>
                </div>
              </div>
              {resultat.statut === "local" && (
                <div className="prochaine-etape prochaine-etape--attention">
                  <div>
                    <span className="libelle-prochaine-etape">À refaire en ligne</span>
                    <p>
                      Le serveur garde l'ancien mot de passe : sur un autre appareil, ou en ligne, c'est encore l'ancien
                      qui marche. Refaites cette réinitialisation quand internet sera là (le compte est noté ici).
                    </p>
                  </div>
                </div>
              )}
              <div className="fiches-recuperation">
                <div className="fiche-recuperation">
                  <h3>Nouveaux accès</h3>
                  <p>
                    {resultat.compte.boutiqueNom && (
                      <>
                        <strong>Boutique :</strong> {resultat.compte.boutiqueNom}
                        <br />
                      </>
                    )}
                    <strong>Identifiant :</strong> {resultat.compte.username}
                    <br />
                    <strong>Date :</strong> {new Date().toLocaleDateString("fr-FR")}
                  </p>
                  <p className="fiche-recuperation-mot-de-passe">
                    Mot de passe{doitChanger ? " provisoire" : ""} : <strong>{resultat.motDePasse}</strong>
                  </p>
                  <p>
                    {doitChanger
                      ? "À la première connexion, l'application vous demandera de choisir votre propre mot de passe."
                      : "Gardez ce mot de passe pour vous ; ne le communiquez à personne."}
                  </p>
                </div>
              </div>
              <div className="actions-code-reseau actions-activation-reseau">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(texteAcces);
                    setCopie(true);
                  }}
                >
                  {copie ? "✓ Copié" : "📋 Copier"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `https://wa.me/${resultat.compte.telephone.replace(/\D/g, "")}?text=${encodeURIComponent(texteAcces)}`,
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  💬 WhatsApp{resultat.compte.telephone ? ` (${resultat.compte.telephone})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    document.body.classList.add("impression-fiche");
                    window.print();
                    document.body.classList.remove("impression-fiche");
                  }}
                >
                  🖨️ Imprimer
                </button>
                <button type="button" className="bouton-primaire" onClick={recommencer}>
                  Réinitialiser un autre compte
                </button>
              </div>
            </>
          ) : (
            <>
              {source === "poste" && (
                <div className="prochaine-etape prochaine-etape--neutre">
                  <div>
                    <span className="libelle-prochaine-etape">Sans connexion au serveur</span>
                    <p>
                      Seuls les comptes déjà connus de cet ordinateur sont affichés. La réinitialisation ne vaudra que sur
                      cet ordinateur (le serveur gardera l'ancien mot de passe) : à refaire une fois connecté.
                    </p>
                  </div>
                  <button type="button" onClick={() => charger()}>
                    ⟳ Réessayer
                  </button>
                </div>
              )}
              {source === "serveur" && aRefaire.length > 0 && (
                <div className="prochaine-etape prochaine-etape--attention">
                  <div>
                    <span className="libelle-prochaine-etape">À refaire en ligne</span>
                    <p>
                      Réinitialisé{aRefaire.length > 1 ? "s" : ""} sans internet sur cet ordinateur : {aRefaire.join(", ")}.
                      Choisissez-le{aRefaire.length > 1 ? "s" : ""} ci-dessous pour envoyer un nouveau mot de passe au serveur.
                    </p>
                  </div>
                </div>
              )}

              <div className="etape-reseau">
                <span className="numero-etape-reseau">1</span>
                <div className="champ-etape-reseau">
                  <strong>Choisir le compte</strong>
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
                            onClick={() => {
                              setCible(c);
                              setErreur(null);
                            }}
                          >
                            <td data-label="Compte">
                              <strong>{c.username}</strong>
                              {c.nom && <span className="sous-info ligne-detail-article">{c.nom}</span>}
                            </td>
                            <td data-label="Boutique">{c.boutiqueNom || "—"}</td>
                            <td data-label="Rôle">{c.role || "—"}</td>
                            <td data-label="Dernière connexion" className="nowrap">{c.derniereConnexion ? new Date(c.derniereConnexion).toLocaleDateString("fr-FR") : "—"}</td>
                            <td data-label="État">
                              {!c.actif ? (
                                <span className="pastille-etat-reseau">Désactivé</span>
                              ) : aRefaire.includes(c.username) ? (
                                <span className="pastille-etat-reseau">À refaire en ligne</span>
                              ) : c.doitChangerMotDePasse ? (
                                <span className="pastille-etat-reseau">Mot de passe provisoire</span>
                              ) : (
                                <span className="pastille-etat-reseau pastille-etat-reseau--relie">Actif</span>
                              )}
                            </td>
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
                    {source === "serveur" ? " · tous les comptes de vos boutiques (jamais les administrateurs)" : " · connus de cet ordinateur"}
                  </span>
                </div>
              </div>

              <div className="etape-reseau">
                <span className="numero-etape-reseau">2</span>
                <div className="champ-etape-reseau champs-sauvegarde">
                  <strong>
                    Nouveau mot de passe{cible ? ` pour « ${cible.username} »` : ""}
                    {cible?.boutiqueNom ? ` (${cible.boutiqueNom})` : ""}
                  </strong>
                  {cible && !cible.actif && (
                    <span className="texte-erreur">Ce compte est désactivé : réactivez-le d'abord (Informations boutique → Utilisateurs).</span>
                  )}
                  <ChampNouveauMotDePasse
                    valeur={motDePasse}
                    confirmation={confirmation}
                    identifiant={cible?.username}
                    onChange={(v, c) => {
                      setMotDePasse(v);
                      setConfirmation(c);
                    }}
                  />
                  <label className="case-secours-sauvegarde">
                    <span>
                      <input type="checkbox" checked={doitChanger} onChange={(e) => setDoitChanger(e.target.checked)} /> Obliger
                      à choisir son propre mot de passe à la prochaine connexion
                    </span>
                    <span className="note-aide">
                      Recommandé : vous seul connaissez ce mot de passe provisoire ; l'utilisateur le remplace aussitôt.
                    </span>
                  </label>
                </div>
              </div>

              <div className="actions-formulaire">
                <button type="button" className="bouton-primaire" disabled={enCours || !cible || !cible.actif} onClick={reinitialiser}>
                  {enCours ? "Enregistrement…" : "🔑 Réinitialiser"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
