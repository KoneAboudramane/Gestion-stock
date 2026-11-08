import { useEffect, useMemo, useState } from "react";

import { api, ErreurApi } from "../api";
import OngletsRubriques from "../composants/OngletsRubriques";
import { Chargement, Erreur } from "../composants/Commun";
import FicheAcces from "../composants/FicheAcces";
import { date, dateHeure, motDePasseProvisoire } from "../format";
import type { CompteBoutique } from "../types";
import { useChargement } from "../useChargement";

/**
 * Comptes et mots de passe, au même design que « 🔑 Réinitialiser mot de passe »
 * de l'Espace Admin du bureau : filtres rapides dans la barre de gauche, tri,
 * compte choisi dans une carte, mot de passe provisoire, fiche d'accès.
 * Tous les comptes des boutiques, jamais les administrateurs.
 */

type Filtre = "tous" | "patrons" | "provisoires" | "desactives";
type Tri = "boutique" | "connexion" | "nom";

const FILTRES: { cle: Filtre; label: string }[] = [
  { cle: "tous", label: "👥 Tous" },
  { cle: "patrons", label: "👑 Patrons" },
  { cle: "provisoires", label: "⏳ Provisoires" },
  { cle: "desactives", label: "⛔ Désactivés" },
];

export default function Comptes() {
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [tri, setTri] = useState<Tri>("boutique");
  const [choisi, setChoisi] = useState<CompteBoutique | null>(null);

  useEffect(() => {
    const minuteur = setTimeout(() => setRecherche(saisie.trim()), 300);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  const { donnees, setDonnees, erreur, enCours, recharger } = useChargement(
    () => api<CompteBoutique[]>(`/admin/comptes/?${new URLSearchParams({ recherche })}`),
    [recherche],
  );

  const compteurs = useMemo(() => {
    const l = donnees ?? [];
    return {
      tous: l.length,
      patrons: l.filter((c) => c.role === "Patron").length,
      provisoires: l.filter((c) => c.actif && c.doit_changer_mot_de_passe).length,
      desactives: l.filter((c) => !c.actif).length,
    } satisfies Record<Filtre, number>;
  }, [donnees]);

  const liste = useMemo(() => {
    const l = (donnees ?? []).filter(
      (c) =>
        filtre === "tous" ||
        (filtre === "patrons" && c.role === "Patron") ||
        (filtre === "provisoires" && c.actif && c.doit_changer_mot_de_passe) ||
        (filtre === "desactives" && !c.actif),
    );
    return [...l].sort((a, b) =>
      tri === "nom"
        ? a.username.localeCompare(b.username)
        : tri === "connexion"
          ? (b.derniere_connexion ?? "").localeCompare(a.derniere_connexion ?? "")
          : (a.boutique?.nom ?? "").localeCompare(b.boutique?.nom ?? "") || a.username.localeCompare(b.username),
    );
  }, [donnees, filtre, tri]);

  function pastille(c: CompteBoutique) {
    if (!c.actif) return <span className="pastille-etat-reseau">Désactivé</span>;
    if (c.doit_changer_mot_de_passe) return <span className="pastille-etat-reseau">Mot de passe provisoire</span>;
    return <span className="pastille-etat-reseau pastille-etat-reseau--relie">Actif</span>;
  }

  return (
    <div className="ecran-admin-commun page-onglets">
      <OngletsRubriques
        etiquette="Comptes des boutiques"
        etat={donnees ? `${donnees.length} compte(s)` : "…"}
        details={["jamais les administrateurs", choisi ? `Choisi : ${choisi.username}` : null]}
        rubriques={FILTRES.map((f) => ({ cle: f.cle, label: f.label, compteur: compteurs[f.cle] }))}
        active={choisi ? null : filtre}
        onChoisir={(cle) => {
          setChoisi(null);
          setFiltre(cle);
        }}
      />
      <div className="contenu-onglet contenu-reseau">
        {choisi ? (
          <Reinitialiser
            compte={choisi}
            surRetour={() => setChoisi(null)}
            surFait={(c) => {
              setDonnees((l) => l?.map((x) => (x.id === c.id ? c : x)) ?? null);
            }}
          />
        ) : (
          <>
            <h4 className="titre-rubrique-reseau">{FILTRES.find((f) => f.cle === filtre)?.label}</h4>
            <p className="note-aide">
              Pour un mot de passe oublié : choisissez le compte, donnez un mot de passe provisoire ; le commerçant choisit le
              sien à la connexion suivante.
            </p>
            <div className="barre-filtres-comptes">
              <input
                type="search"
                className="champ-recherche-comptes"
                placeholder="🔍 Rechercher : identifiant, nom, téléphone, e-mail, boutique…"
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
              />
              <select value={tri} onChange={(e) => setTri(e.target.value as Tri)} aria-label="Trier">
                <option value="boutique">Trier : boutique</option>
                <option value="connexion">Trier : dernière connexion</option>
                <option value="nom">Trier : identifiant</option>
              </select>
            </div>
            {erreur && <Erreur message={erreur} reessayer={recharger} />}
            {enCours && !donnees ? (
              <Chargement />
            ) : liste.length === 0 ? (
              <p className="vide">Aucun compte ne correspond.</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Compte</th>
                      <th>Boutique</th>
                      <th>Rôle</th>
                      <th>Contact</th>
                      <th>Dernière connexion</th>
                      <th>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liste.map((c) => (
                      <tr key={c.id} className={`ligne-cliquable${c.actif ? "" : " ligne-inactive"}`} onClick={() => setChoisi(c)}>
                        <td>
                          <strong>{c.username}</strong>
                          {c.nom && <small className="sous-ligne">{c.nom}</small>}
                        </td>
                        <td>
                          {c.boutique ? (
                            <a href={`#/boutiques/${c.boutique.id}`} onClick={(e) => e.stopPropagation()}>
                              {c.boutique.nom}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{c.role || "—"}</td>
                        <td>
                          {c.telephone || "—"}
                          {c.email && <small className="sous-ligne">{c.email}</small>}
                        </td>
                        <td>{date(c.derniere_connexion)}</td>
                        <td>{pastille(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <span className="note-aide">{liste.length} compte(s) · cliquez sur un compte pour changer son mot de passe</span>
          </>
        )}
      </div>
    </div>
  );
}

function Reinitialiser({
  compte,
  surRetour,
  surFait,
}: {
  compte: CompteBoutique;
  surRetour: () => void;
  surFait: (c: CompteBoutique) => void;
}) {
  const [motDePasse, setMotDePasse] = useState(motDePasseProvisoire);
  const [doitChanger, setDoitChanger] = useState(true);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [fait, setFait] = useState<{ motDePasse: string; provisoire: boolean } | null>(null);

  async function soumettre() {
    setEnCours(true);
    setErreur("");
    try {
      const c = await api<CompteBoutique>(`/admin/comptes/${compte.id}/mot-de-passe/`, {
        method: "POST",
        body: JSON.stringify({ nouveau_mot_de_passe: motDePasse, doit_changer: doitChanger }),
      });
      surFait(c);
      setFait({ motDePasse, provisoire: doitChanger });
    } catch (err) {
      setErreur(err instanceof ErreurApi && err.champs.nouveau_mot_de_passe ? err.champs.nouveau_mot_de_passe : (err as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  if (fait) {
    const texte = `Vos accès Gestion Stock${compte.boutique ? ` (${compte.boutique.nom})` : ""} :\nIdentifiant : ${compte.username}\nMot de passe${fait.provisoire ? " provisoire" : ""} : ${fait.motDePasse}${fait.provisoire ? "\nVous choisirez votre propre mot de passe à la connexion." : ""}`;
    return (
      <>
        <div className="carte-etat-serveur carte-etat-serveur--marche">
          <div className="entete-vue-ensemble">
            <span className="icone-vue-ensemble">✅</span>
            <div>
              <strong className="etat-serveur-titre">Mot de passe changé</strong>
              <span className="sous-info ligne-detail-article">Le compte peut se connecter avec ce mot de passe dès maintenant.</span>
            </div>
          </div>
        </div>
        <FicheAcces
          titre="Nouveaux accès"
          details={[
            ...(compte.boutique ? [{ libelle: "Boutique", valeur: compte.boutique.nom }] : []),
            ...(compte.nom ? [{ libelle: "Nom", valeur: compte.nom }] : []),
            { libelle: "Date", valeur: new Date().toLocaleDateString("fr-FR") },
          ]}
          identifiant={compte.username}
          motDePasse={fait.motDePasse}
          provisoire={fait.provisoire}
          texteAPartager={texte}
          telephone={compte.telephone}
          onWhatsapp={(t, tel) => window.open(`https://wa.me/${tel.replace(/\D/g, "")}?text=${encodeURIComponent(t)}`, "_blank", "noopener")}
          onImprimer={() => {
            document.body.classList.add("impression-fiche");
            window.print();
            document.body.classList.remove("impression-fiche");
          }}
          actionPrincipale={
            <button type="button" onClick={surRetour}>
              ↺ Choisir un autre compte
            </button>
          }
        />
      </>
    );
  }

  return (
    <>
      <h4 className="titre-rubrique-reseau">🔑 Nouveau mot de passe</h4>
      <div className="carte-compte-choisi">
        <span className="icone-option-admin">👤</span>
        <div className="textes-option-admin">
          <strong>{compte.username}</strong>
          <span className="sous-info">
            {[compte.nom, compte.boutique?.nom, compte.role, compte.telephone].filter(Boolean).join(" · ")}
          </span>
          <span className="sous-info">Dernière connexion : {dateHeure(compte.derniere_connexion)}</span>
        </div>
        <button type="button" className="lien" onClick={surRetour}>
          Changer de compte
        </button>
      </div>
      {!compte.actif ? (
        <p className="message-erreur">Ce compte est désactivé : le patron doit d'abord le réactiver (Informations boutique → Utilisateurs).</p>
      ) : (
        <>
          <label className="champ-plein">
            Nouveau mot de passe
            <span className="champ-avec-bouton">
              <input value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="off" />
              <button type="button" onClick={() => setMotDePasse(motDePasseProvisoire())}>
                🎲 Générer
              </button>
            </span>
          </label>
          <label className="carte-option-boutique">
            <input type="checkbox" checked={doitChanger} onChange={(e) => setDoitChanger(e.target.checked)} />
            <span>
              <strong>Mot de passe provisoire</strong>
              <span className="note-aide">Recommandé : l'utilisateur choisit le sien à sa prochaine connexion.</span>
            </span>
          </label>
          {erreur && <Erreur message={erreur} />}
          <div className="actions-formulaire">
            <button type="button" className="lien" onClick={surRetour}>
              Annuler
            </button>
            <button type="button" className="bouton-primaire" disabled={enCours || !motDePasse} onClick={soumettre}>
              {enCours ? "Enregistrement…" : "🔑 Changer le mot de passe"}
            </button>
          </div>
        </>
      )}
    </>
  );
}
