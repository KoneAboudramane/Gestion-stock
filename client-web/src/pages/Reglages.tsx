import { useEffect, useState } from "react";
import { ModaleAttributsCourants, ModaleUnitesCourantes } from "../components/CatalogueCourant";
import type { CSSProperties } from "react";

import { api } from "../api";
import type { RoleResume, Session, UtilisateurResume } from "../api";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useRafraichirDevise } from "../contexts/DeviseContext";
import { useSession } from "../contexts/SessionContext";
import { useSynchro } from "../contexts/SynchroContext";
import {
  lireAbonnementEnAttente,
  soumettreAbonnement,
  type AbonnementEnAttente,
} from "../services/abonnementAdmin";
import { ErreurBoutique, modifierBoutique, obtenirBoutique, type BoutiqueDetail } from "../services/boutique";
import { definirParametre, ErreurConfiguration, listerParametres } from "../services/configuration";
import {
  CLE_PARAMETRE_DELAI_VERROUILLAGE,
  useDelaiVerrouillage,
  useRafraichirDelaiVerrouillage,
} from "../contexts/VerrouillageContext";
import {
  activerEnLigne,
  lireBoutiqueLocaleEnAttente,
  type BoutiqueLocaleEnAttente,
} from "../services/inscriptionLocale";
import {
  creerAttribut,
  creerUnite,
  ErreurProduit,
  creerValeurAttribut,
  listerAttributs,
  listerValeursAttribut,
  modifierValeurAttribut,
  supprimerValeurAttribut,
  listerUnites,
  modifierAttribut,
  modifierUnite,
  supprimerAttribut,
  supprimerUnite,
  type ReferenceNommee,
  type UniteResume,
} from "../services/produits";
import {
  creerDepot,
  ErreurStock,
  listerDepotsDetail,
  modifierDepot,
  supprimerDepot,
  type DepotResume,
} from "../services/stock";
import { appliquerTheme, themeActuel, type Theme } from "../lib/theme";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { listerClientsDetail } from "../services/clients";
import { listerArticlesBoutique, usagesCatalogue, type UsagesCatalogue } from "../services/produits";
import { depotsSupprimesAvecStock, listerStock, transfererToutLeStock, type DepotSupprimeAvecStock } from "../services/stock";
import { compterEnAttente } from "../sync";
import { CLE_PARAMETRE_FABRICATION_PROPRE } from "../hooks/useFabricationPropre";
import { fabricationPropreActive } from "../services/stock";

/**
 * Port simplifié de client-electron/src/pages/Reglages.tsx. Non repris ici :
 * - Le logo de la boutique : c'est un ImageField (upload multipart) côté
 *   serveur, pas un base64 en JSON comme le stockage local Electron — hors
 *   périmètre de ce premier passage.
 *
 * L'onglet "Paramètres > Général" (clé/valeur) s'appuie sur un nouvel
 * endpoint côté serveur (configuration.Parametre n'avait aucune route REST
 * avant cette page — ajouté dans ce même changement, même permission que le
 * reste de Réglages).
 */

/**
 * Ronds défilants du fond (même patron que Accueil.tsx) : tailles/vitesses/
 * délais variés, trajectoire propre à chacun (départ → arrivée en vw/vh),
 * couleur --cercle-N (index.css — cycle des teintes sémantiques par défaut,
 * réassorti à l'identité propre de certains thèmes comme Orange).
 */
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

function formaterDateSynchro(iso: string | null): string {
  if (!iso) return "jamais";
  return new Date(iso).toLocaleString("fr-FR");
}

/** Noms lisibles des types de données synchronisés. */
const LIBELLES_TABLES_SYNCHRO: Record<string, string> = {
  "comptes.Boutique": "Boutique",
  "catalogue.Categorie": "Catégories",
  "catalogue.Unite": "Unités",
  "catalogue.Produit": "Articles",
  "catalogue.Attribut": "Attributs",
  "catalogue.ValeurAttribut": "Valeurs d'attributs",
  "catalogue.Variante": "Variantes d'articles",
  "catalogue.VarianteValeur": "Variantes d'articles (valeurs)",
  "stock.Depot": "Dépôts",
  "stock.Stock": "Stock",
  "stock.MouvementStock": "Mouvements de stock",
  "stock.TransfertStock": "Transferts",
  "stock.PerteStock": "Pertes",
  "stock.Inventaire": "Inventaires",
  "stock.LigneInventaire": "Lignes d'inventaire",
  "stock.Destockage": "Déstockages",
  "clients.Client": "Clients",
  "clients.Credit": "Crédits clients",
  "clients.PaiementCredit": "Paiements de crédits",
  "ventes.Vente": "Ventes",
  "ventes.LigneVente": "Lignes de vente",
  "ventes.Paiement": "Paiements de ventes",
  "achats.CommandeAchat": "Commandes fournisseurs",
  "achats.LigneAchat": "Lignes de commande",
  "achats.Reception": "Réceptions",
  "fournisseurs.Fournisseur": "Fournisseurs",
  "fournisseurs.DetteFournisseur": "Dettes fournisseurs",
  "configuration.Parametre": "Paramètres",
  "notifications.Notification": "Notifications",
  "notifications.Message": "Messages",
  "tresorerie.MouvementCaisse": "Mouvements de caisse",
  "tresorerie.Depense": "Dépenses",
  "tresorerie.Transfert": "Transferts mobile money",
  "paiements.TransactionMobileMoney": "Paiements mobile money",
  "tresorerie.ClotureCaisse": "Clôtures de caisse",
  "achats.EvenementCommande": "Suivi des commandes",
  "achats.RetourFournisseur": "Retours fournisseurs",
  "achats.LigneRetourFournisseur": "Lignes de retour fournisseur",
  "fournisseurs.PaiementDetteFournisseur": "Remboursements fournisseurs",
  "fournisseurs.EcheanceDette": "Échéanciers fournisseurs",
  "clients.EcheanceCredit": "Échéanciers clients",
  "stock.OperationDestockage": "Opérations de déstockage",
  "stock.ReleveDormants": "Relevés des produits dormants",
};

const LIBELLES_FORMAT_TICKET: Record<string, string> = {
  a4: "Facture A4",
  "80mm": "Ticket 80 mm",
  "58mm": "Ticket 58 mm",
};

const SECTIONS = [
  { cle: "profil", label: "Informations boutique", icone: "🏪" },
  { cle: "utilisateurs", label: "Utilisateurs & rôles", icone: "👥" },
  { cle: "parametres", label: "Paramètres", icone: "⚙️" },
  { cle: "synchronisation", label: "Synchronisation", icone: "🔄" },
] as const;

type Section = (typeof SECTIONS)[number]["cle"];

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

// --- Onglet Informations boutique ---

function OngletProfilBoutique({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const peutGerer = !!session.permissions.gerer_utilisateurs_reglages;
  const [boutique, setBoutique] = useState<BoutiqueDetail | null>(null);
  const [moi, setMoi] = useState<UtilisateurResume | null>(null);
  const [emailCompte, setEmailCompte] = useState("");
  const [telephoneCompte, setTelephoneCompte] = useState("");
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState("");
  const [tauxTva, setTauxTva] = useState("");
  const [formatTicket, setFormatTicket] = useState("a4");
  const [modeEdition, setModeEdition] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [chiffres, setChiffres] = useState<{ articles: number; clients: number; utilisateurs: number | null } | null>(null);
  useEffect(() => {
    Promise.all([
      listerArticlesBoutique(session.boutiqueId),
      listerClientsDetail(session.boutiqueId),
      api.comptes.listerUtilisateurs(),
    ]).then(([articles, clients, utilisateurs]) =>
      setChiffres({
        articles: new Set(articles.map((a) => a.produitId)).size,
        clients: clients.length,
        utilisateurs: utilisateurs.succes ? utilisateurs.resultat.length : null,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);
  const rafraichirDevise = useRafraichirDevise();
  const { definirSession } = useSession();

  async function charger() {
    const [boutiqueLocale, resultatUtilisateurs, listeDepots, parametres] = await Promise.all([
      obtenirBoutique(session.boutiqueId),
      api.comptes.listerUtilisateurs(),
      listerDepotsDetail(session.boutiqueId),
      listerParametres(session.boutiqueId),
    ]);
    if (boutiqueLocale) setBoutique(boutiqueLocale);
    setDepots(listeDepots);
    setTauxTva(parametres.find((p) => p.cle === "taux_tva")?.valeur ?? "");
    setFormatTicket(parametres.find((p) => p.cle === "format_ticket")?.valeur || "a4");
    if (resultatUtilisateurs.succes) {
      const moiTrouve = resultatUtilisateurs.resultat.find((u) => u.id === Number(session.utilisateurId)) ?? null;
      setMoi(moiTrouve);
      setEmailCompte(moiTrouve?.email ?? "");
      setTelephoneCompte(moiTrouve?.telephone ?? "");
      setDepotId(moiTrouve?.depot ?? "");
    }
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!boutique) return;
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      try {
        await modifierBoutique(session.boutiqueId, {
          nom: boutique.nom,
          adresse: boutique.adresse,
          telephone: boutique.telephone,
          email: boutique.email,
          devise: boutique.devise,
        });
      } catch (e) {
        setErreur(e instanceof ErreurBoutique ? e.message : "Erreur inattendue.");
        return;
      }
      const tauxSaisi = tauxTva.trim();
      if (tauxSaisi && (Number.isNaN(Number(tauxSaisi)) || Number(tauxSaisi) < 0 || Number(tauxSaisi) > 100)) {
        setErreur("Le taux de TVA doit être un nombre entre 0 et 100.");
        return;
      }
      try {
        await definirParametre(session.boutiqueId, "taux_tva", tauxSaisi);
      } catch (e) {
        setErreur(e instanceof ErreurConfiguration ? e.message : "Erreur inattendue.");
        return;
      }
      try {
        await definirParametre(session.boutiqueId, "format_ticket", formatTicket);
      } catch (e) {
        setErreur(e instanceof ErreurConfiguration ? e.message : "Erreur inattendue.");
        return;
      }
      if (moi) {
        const resultatCompte = await api.comptes.modifierUtilisateur(moi.id, {
          email: emailCompte,
          telephone: telephoneCompte,
          depotId: depotId || null,
        });
        if (!resultatCompte.succes) {
          setErreur(resultatCompte.message);
          return;
        }
        // Le dépôt de vente peut avoir changé : on rafraîchit la session
        // partagée (même appel que rafraichirPermissions au démarrage) pour
        // que Trésorerie/Caisse le reflètent immédiatement, sans rechargement.
        api.auth.rafraichirPermissions(session).then((s) => s && definirSession(s));
      }
      setMessage("Informations enregistrées.");
      rafraichirDevise();
      setModeEdition(false);
      charger();
    } finally {
      setEnCours(false);
    }
  }

  function annuler() {
    setErreur(null);
    charger();
    setModeEdition(false);
  }

  if (!boutique) return <p>Chargement…</p>;

  if (!modeEdition) {
    const joursRestants = boutique.dateExpirationAbonnement
      ? Math.ceil((new Date(boutique.dateExpirationAbonnement).getTime() - Date.now()) / 86_400_000)
      : null;
    return (
      <>
        <div className="modale-entete">
          <h3>Informations boutique</h3>
          <div className="actions-formulaire">
            {peutGerer && (
              <button type="button" className="bouton-primaire" onClick={() => setModeEdition(true)}>
                ✎ Modifier
              </button>
            )}
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
        </div>
        <div className="modale-corps">
          {message && <div className="message-succes">{message}</div>}
          <div className="entete-profil-boutique">
            <div className="apercu-logo-boutique apercu-logo-vide">{boutique.nom.charAt(0).toUpperCase()}</div>
            <div>
              <h2>{boutique.nom}</h2>
              <span className="sous-info">
                {[boutique.adresse, boutique.telephone].filter(Boolean).join(" · ") || "Coordonnées à compléter"}
              </span>
            </div>
          </div>
          <div className="tuiles-fiche">
            <div className="tuile-fiche">
              <span className="sous-info">🏷️ Articles</span>
              <strong>{chiffres ? chiffres.articles : "…"}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">👥 Clients</span>
              <strong>{chiffres ? chiffres.clients : "…"}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🏬 Dépôts</span>
              <strong>{depots.length}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🧑‍💼 Utilisateurs</span>
              <strong title={chiffres?.utilisateurs === null ? "Connexion internet nécessaire" : undefined}>
                {chiffres ? (chiffres.utilisateurs ?? "—") : "…"}
              </strong>
            </div>
          </div>
          <div className="cartes-profil">
            <section className="carte-profil">
              <h4>📇 Coordonnées</h4>
              <dl>
                <dt>Nom</dt>
                <dd>{boutique.nom || "—"}</dd>
                <dt>Adresse</dt>
                <dd>{boutique.adresse || "—"}</dd>
                <dt>Téléphone</dt>
                <dd>{boutique.telephone || "—"}</dd>
                <dt>Email</dt>
                <dd>{boutique.email || "—"}</dd>
              </dl>
            </section>
            <section className="carte-profil">
              <h4>🧾 Vente</h4>
              <dl>
                <dt>Devise</dt>
                <dd>{boutique.devise || "—"}</dd>
                <dt>TVA</dt>
                <dd>{tauxTva ? `${tauxTva} %` : "Non assujetti"}</dd>
                <dt>Ticket</dt>
                <dd>{LIBELLES_FORMAT_TICKET[formatTicket] ?? formatTicket}</dd>
              </dl>
            </section>
            <section className="carte-profil">
              <h4>⭐ Abonnement</h4>
              <dl>
                <dt>Formule</dt>
                <dd>{boutique.formule === "pro" ? "Pro" : "Essentiel"}</dd>
                <dt>Échéance</dt>
                <dd
                  className={
                    joursRestants === null ? undefined : joursRestants < 0 ? "texte-erreur" : joursRestants <= 15 ? "texte-avertissement" : undefined
                  }
                >
                  {boutique.dateExpirationAbonnement
                    ? `${new Date(boutique.dateExpirationAbonnement).toLocaleDateString("fr-FR")}${
                        joursRestants !== null && joursRestants < 0
                          ? " (expiré)"
                          : joursRestants !== null && joursRestants <= 15
                            ? ` (dans ${joursRestants} j)`
                            : ""
                      }`
                    : "Sans limite"}
                </dd>
              </dl>
            </section>
            {moi && (
              <section className="carte-profil">
                <h4>👤 Mon compte</h4>
                <dl>
                  <dt>Utilisateur</dt>
                  <dd>{moi.username}</dd>
                  <dt>Rôle</dt>
                  <dd>{session.role}</dd>
                  <dt>Téléphone</dt>
                  <dd>{moi.telephone || "—"}</dd>
                  <dt>Dépôt de vente</dt>
                  <dd>{depots.find((d) => d.id === depotId)?.nom || "Aucun"}</dd>
                </dl>
              </section>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="modale-entete">
        <h3>Informations boutique</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={annuler}>
            Annuler
          </button>
          <button type="submit" form="form-profil-boutique" className="bouton-primaire" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
      </div>
      <div className="modale-corps">
      <form id="form-profil-boutique" onSubmit={enregistrer} className="formulaire-catalogue formulaire-profil-boutique">
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="colonnes-profil-boutique">
        <div>
          <h4>Boutique</h4>
          <div className="grille-champs">
            <label>
              Nom de la boutique
              <input value={boutique.nom} onChange={(e) => setBoutique({ ...boutique, nom: e.target.value })} />
            </label>
            <label>
              Adresse
              <input value={boutique.adresse} onChange={(e) => setBoutique({ ...boutique, adresse: e.target.value })} />
            </label>
            <label>
              Téléphone
              <input value={boutique.telephone} onChange={(e) => setBoutique({ ...boutique, telephone: e.target.value })} />
            </label>
            <label>
              Email
              <input value={boutique.email} onChange={(e) => setBoutique({ ...boutique, email: e.target.value })} />
            </label>
            <label>
              Devise
              <input value={boutique.devise} onChange={(e) => setBoutique({ ...boutique, devise: e.target.value })} />
            </label>
            <label>
              Taux de TVA (%)
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="Non assujetti"
                value={tauxTva}
                onChange={(e) => setTauxTva(e.target.value)}
              />
            </label>
            <label>
              Format du ticket
              <select value={formatTicket} onChange={(e) => setFormatTicket(e.target.value)}>
                {Object.entries(LIBELLES_FORMAT_TICKET).map(([valeur, libelle]) => (
                  <option key={valeur} value={valeur}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {moi && (
          <div>
            <h4>Mon compte</h4>
            <p className="note-aide">
              Nom d'utilisateur : {moi.username} · Rôle : {session.role}
            </p>
            <div className="grille-champs">
              <label>
                Téléphone
                <input value={telephoneCompte} onChange={(e) => setTelephoneCompte(e.target.value)} />
              </label>
              <label>
                Email
                <input type="email" value={emailCompte} onChange={(e) => setEmailCompte(e.target.value)} />
              </label>
              <label>
                Dépôt de vente
                <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                  <option value="">Aucun</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nom}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
      </form>
      </div>
    </>
  );
}

// --- Onglet Utilisateurs & rôles ---

const CLES_PERMISSIONS: { cle: string; label: string }[] = [
  { cle: "vendre", label: "Vendre / encaisser" },
  { cle: "consulter_stock", label: "Consulter le stock" },
  { cle: "gerer_clients", label: "Gérer les clients" },
  { cle: "gerer_produits_stock_achats", label: "Gérer articles / stock / achats" },
  { cle: "voir_benefices_achat", label: "Voir les bénéfices et prix d'achat" },
  { cle: "modifier_prix", label: "Modifier les prix" },
  { cle: "annuler_vente", label: "Annuler une vente" },
  { cle: "voir_rapports_complets", label: "Voir les rapports complets" },
  { cle: "gerer_utilisateurs_reglages", label: "Gérer les utilisateurs et réglages" },
];

function CarteRole({ role, onModifie }: { role: RoleResume; onModifie: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const estPatron = role.nom === "Patron";

  async function basculer(cle: string) {
    if (estPatron) return;
    setEnCours(true);
    setErreur(null);
    try {
      const nouvellesPermissions = { ...role.permissions, [cle]: !role.permissions[cle] };
      const resultat = await api.comptes.modifierRole(role.id, nouvellesPermissions);
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="detail-produit">
      <h4>{role.nom}</h4>
      {erreur && <div className="message-erreur">{erreur}</div>}
      {estPatron && <p className="note-aide">Le rôle Patron a toutes les permissions et ne peut pas être modifié.</p>}
      <div className="grille-permissions">
        {CLES_PERMISSIONS.map((p) => (
          <label key={p.cle}>
            <input type="checkbox" checked={!!role.permissions[p.cle]} disabled={enCours || estPatron} onChange={() => basculer(p.cle)} />
            {p.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function genererMotDePasse(): string {
  const caracteres = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let motDePasse = "";
  for (let i = 0; i < 10; i++) {
    motDePasse += caracteres[Math.floor(Math.random() * caracteres.length)];
  }
  return motDePasse;
}

function normaliserPourIdentifiant(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function genererNomUtilisateur(prenom: string, nom: string, telephone: string, nomsExistants: Set<string>): string {
  const p = normaliserPourIdentifiant(prenom);
  const n = normaliserPourIdentifiant(nom);
  const base = p && n ? `${p}.${n}` : p || n || "utilisateur";
  if (!nomsExistants.has(base)) return base;

  const chiffresTelephone = telephone.replace(/\D/g, "").slice(-4);
  if (chiffresTelephone) {
    const avecTelephone = `${base}${chiffresTelephone}`;
    if (!nomsExistants.has(avecTelephone)) return avecTelephone;
  }

  let compteur = 2;
  while (nomsExistants.has(`${base}${compteur}`)) compteur += 1;
  return `${base}${compteur}`;
}

function FormulaireUtilisateur({
  roles,
  depots,
  nomsUtilisateursExistants,
  onAnnuler,
  onCree,
}: {
  roles: RoleResume[];
  depots: DepotResume[];
  nomsUtilisateursExistants: Set<string>;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const [username, setUsername] = useState("");
  const [usernameManuel, setUsernameManuel] = useState(false);
  const [password, setPassword] = useState(() => genererMotDePasse());
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [telephone, setTelephone] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [depotId, setDepotId] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [utilisateurCree, setUtilisateurCree] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    if (usernameManuel) return;
    setUsername(genererNomUtilisateur(firstName, lastName, telephone, nomsUtilisateursExistants));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, telephone, usernameManuel]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setErreur("Prénom et nom sont obligatoires.");
      return;
    }
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.comptes.creerUtilisateur({
        username,
        password,
        firstName,
        lastName,
        telephone,
        roleId: roleId || null,
        depotId: depotId || null,
      });
      if (resultat.succes) setUtilisateurCree({ username, password });
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  if (utilisateurCree) {
    return (
      <div className="formulaire-catalogue">
        <h4>Utilisateur créé</h4>
        <p className="note-aide">
          Note ce mot de passe maintenant et transmets-le à {utilisateurCree.username} : il ne sera plus affiché ensuite.
        </p>
        <div className="mot-de-passe-genere">
          <span>{utilisateurCree.username}</span>
          <strong>{utilisateurCree.password}</strong>
        </div>
        <div className="actions-formulaire">
          <button type="button" onClick={onCree}>
            J'ai noté le mot de passe
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={soumettre} className="formulaire-catalogue">
      <h4>Nouvel utilisateur</h4>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="grille-champs">
        <label>
          Prénom
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
        </label>
        <label>
          Nom
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </label>
        <label>
          Téléphone
          <input value={telephone} onChange={(e) => setTelephone(e.target.value)} />
        </label>
        <label>
          Nom d'utilisateur
          <div className="champ-mot-de-passe-genere">
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setUsernameManuel(true);
              }}
            />
            <button
              type="button"
              className="lien-icone"
              title="Revenir à la suggestion automatique"
              onClick={() => {
                setUsernameManuel(false);
                setUsername(genererNomUtilisateur(firstName, lastName, telephone, nomsUtilisateursExistants));
              }}
            >
              ⟳
            </button>
          </div>
        </label>
        <label>
          Mot de passe
          <div className="champ-mot-de-passe-genere">
            <input value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="lien" onClick={() => setPassword(genererMotDePasse())}>
              Régénérer
            </button>
          </div>
        </label>
        <label>
          Rôle
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nom}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dépôt assigné
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
            <option value=""></option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions-formulaire">
        <button type="button" onClick={onAnnuler}>
          Annuler
        </button>
        <button type="submit" disabled={enCours}>
          {enCours ? "Création…" : "Créer"}
        </button>
      </div>
    </form>
  );
}

function LigneUtilisateur({
  index,
  utilisateur,
  roles,
  depots,
  onModifie,
}: {
  index: number;
  utilisateur: UtilisateurResume;
  roles: RoleResume[];
  depots: DepotResume[];
  onModifie: () => void;
}) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState<string | null>(null);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);
  const roleActuel = roles.find((r) => r.id === utilisateur.role);

  async function reinitialiserMotDePasse() {
    setEnCours(true);
    setErreur(null);
    try {
      const motDePasse = genererMotDePasse();
      const resultat = await api.comptes.modifierUtilisateur(utilisateur.id, { password: motDePasse });
      if (resultat.succes) setNouveauMotDePasse(motDePasse);
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  async function changerRole(nouveauRoleId: string) {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.comptes.modifierUtilisateur(utilisateur.id, { roleId: nouveauRoleId || null });
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  async function changerDepot(nouveauDepotId: string) {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.comptes.modifierUtilisateur(utilisateur.id, { depotId: nouveauDepotId || null });
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  async function basculerActif() {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.comptes.modifierUtilisateur(utilisateur.id, { isActive: !utilisateur.is_active });
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  async function supprimer() {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.comptes.supprimerUtilisateur(utilisateur.id);
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
      setConfirmationSuppression(false);
    }
  }

  return (
    <tr>
      <td data-label="N°">{index + 1}</td>
      <td data-label="Utilisateur">{utilisateur.username}</td>
      <td data-label="Nom">
        {utilisateur.first_name} {utilisateur.last_name}
      </td>
      <td data-label="Téléphone">{utilisateur.telephone || ""}</td>
      <td data-label="Changer de rôle">
        {roleActuel?.nom === "Patron" ? (
          <span title="Le rôle Patron ne peut pas être retiré.">Patron</span>
        ) : (
          <select value={utilisateur.role ?? ""} disabled={enCours} onChange={(e) => changerRole(e.target.value)}>
            <option value=""></option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nom}
              </option>
            ))}
          </select>
        )}
        {erreur && <div className="message-erreur">{erreur}</div>}
      </td>
      <td data-label="Dépôt">
        <select value={utilisateur.depot ?? ""} disabled={enCours} onChange={(e) => changerDepot(e.target.value)}>
          <option value=""></option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nom}
            </option>
          ))}
        </select>
      </td>
      <td data-label="Statut">
        <button type="button" disabled={enCours} onClick={basculerActif}>
          {utilisateur.is_active ? "Actif" : "Inactif"}
        </button>
      </td>
      <td data-label="Mot de passe">
        {nouveauMotDePasse ? (
          <div className="mot-de-passe-genere mot-de-passe-genere-ligne">
            <strong>{nouveauMotDePasse}</strong>
            <button type="button" className="lien" onClick={() => setNouveauMotDePasse(null)}>
              OK, noté
            </button>
          </div>
        ) : (
          <button type="button" className="lien-icone" title="Réinitialiser le mot de passe" disabled={enCours} onClick={reinitialiserMotDePasse}>
            🔑
          </button>
        )}
        {confirmationSuppression ? (
          <div className="confirmation-retrait">
            <span>Confirmer ?</span>
            <button type="button" disabled={enCours} onClick={() => setConfirmationSuppression(false)}>
              Non
            </button>
            <button type="button" disabled={enCours} onClick={supprimer}>
              {enCours ? "…" : "Oui"}
            </button>
          </div>
        ) : (
          <button type="button" className="lien-icone" title="Retirer" disabled={enCours} onClick={() => setConfirmationSuppression(true)}>
            ×
          </button>
        )}
      </td>
    </tr>
  );
}

const SOUS_ONGLETS_UTILISATEURS = [
  { cle: "roles", label: "Rôles" },
  { cle: "utilisateurs", label: "Utilisateurs" },
] as const;

type SousOngletUtilisateurs = (typeof SOUS_ONGLETS_UTILISATEURS)[number]["cle"];

function OngletUtilisateursRoles({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_utilisateurs_reglages;
  const [sousOnglet, setSousOnglet] = useState<SousOngletUtilisateurs>("roles");
  const [roles, setRoles] = useState<RoleResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurResume[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [afficherForm, setAfficherForm] = useState(false);

  async function rafraichir() {
    setErreur(null);
    const resultatRoles = await api.comptes.listerRoles();
    if (resultatRoles.succes) setRoles(resultatRoles.resultat);
    else setErreur(resultatRoles.message);

    setDepots(await listerDepotsDetail(session.boutiqueId));

    const resultatUtilisateurs = await api.comptes.listerUtilisateurs();
    if (resultatUtilisateurs.succes) {
      // Le Patron connecté gère ses propres infos dans l'onglet "Informations
      // boutique", pas dans cette liste des utilisateurs qu'il a créés.
      setUtilisateurs(resultatUtilisateurs.resultat.filter((u) => u.id !== Number(session.utilisateurId)));
    } else setErreur(resultatUtilisateurs.message);
  }

  useEffect(() => {
    if (!peutGerer) return;
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peutGerer]);

  if (!peutGerer) {
    return <p className="note-aide">Réservé au Patron.</p>;
  }

  if (afficherForm) {
    return (
      <div>
        <FormulaireUtilisateur
          roles={roles}
          depots={depots}
          nomsUtilisateursExistants={new Set([session.username.toLowerCase(), ...utilisateurs.map((u) => u.username.toLowerCase())])}
          onAnnuler={() => setAfficherForm(false)}
          onCree={() => {
            setAfficherForm(false);
            rafraichir();
          }}
        />
      </div>
    );
  }

  return (
    <>

      <div className="modale-avec-menu">
        <nav className="menu-modale">
          {SOUS_ONGLETS_UTILISATEURS.map((o) => (
            <button key={o.cle} type="button" className={sousOnglet === o.cle ? "actif" : ""} onClick={() => setSousOnglet(o.cle)}>
              <span className="icone-menu-modale">{o.cle === "roles" ? "🛡️" : "👥"}</span>
              {o.label}
              <span className="compteur-menu-modale">{o.cle === "roles" ? roles.length : utilisateurs.length}</span>
            </button>
          ))}
        </nav>
        <div className="modale-corps">
          {erreur && (
            <div className="bloc-hors-ligne">
              <span>
                🌐 Cette partie se gère en ligne : vérifiez votre connexion internet.
                <br />
                <span className="sous-info">{erreur}</span>
              </span>
              <button type="button" onClick={rafraichir}>
                ⟳ Réessayer
              </button>
            </div>
          )}
          {sousOnglet === "roles" && roles.map((r) => <CarteRole key={r.id} role={r} onModifie={rafraichir} />)}
          {sousOnglet === "utilisateurs" && (
            <>
              <div className="barre-actions">
                <span className="actions-ligne">
                  <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)} disabled={!!erreur}>
                    + Nouvel utilisateur
                  </button>
                </span>
              </div>
              <div className="zone-tableau-scroll zone-commandes-fiche">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>Utilisateur</th>
                      <th>Nom</th>
                      <th>Téléphone</th>
                      <th>Rôle</th>
                      <th>Dépôt</th>
                      <th>Statut</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {utilisateurs.map((u, index) => (
                      <LigneUtilisateur key={u.id} index={index} utilisateur={u} roles={roles} depots={depots} onModifie={rafraichir} />
                    ))}
                    {utilisateurs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="liste-vide">
                          {erreur ? "Liste indisponible hors ligne." : "Aucun utilisateur."}
                        </td>
                      </tr>
                    )}
                    {Array.from({ length: Math.max(0, 10 - Math.max(1, utilisateurs.length)) }).map((_, i) => (
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
            </>
          )}
        </div>
      </div>
    </>
  );
}

// --- Onglet Paramètres > Général ---

const OPTIONS_DELAI_VERROUILLAGE = [
  { valeur: "1", label: "1 minute" },
  { valeur: "2", label: "2 minutes" },
  { valeur: "5", label: "5 minutes" },
  { valeur: "10", label: "10 minutes" },
  { valeur: "15", label: "15 minutes" },
  { valeur: "30", label: "30 minutes" },
  { valeur: "0", label: "Jamais" },
];

function OngletParametresGeneral({ session }: { session: Session }) {
  const [theme, setTheme] = useState<Theme>(() => themeActuel());
  const peutGerer = !!session.permissions.gerer_utilisateurs_reglages;
  const delaiVerrouillage = useDelaiVerrouillage();
  const rafraichirDelaiVerrouillage = useRafraichirDelaiVerrouillage();
  const [enregistrementDelai, setEnregistrementDelai] = useState(false);
  const [fabricationPropre, setFabricationPropre] = useState<boolean | null>(null);
  const [enregistrementFabrication, setEnregistrementFabrication] = useState(false);
  const [erreurFabrication, setErreurFabrication] = useState<string | null>(null);

  const [enregistre, setEnregistre] = useState(false);
  function signalerEnregistre() {
    setEnregistre(true);
    window.setTimeout(() => setEnregistre(false), 2000);
  }

  function changerTheme(nouveauTheme: Theme) {
    signalerEnregistre();
    appliquerTheme(nouveauTheme);
    setTheme(nouveauTheme);
  }

  async function changerDelaiVerrouillage(valeur: string) {
    setEnregistrementDelai(true);
    try {
      await definirParametre(session.boutiqueId, CLE_PARAMETRE_DELAI_VERROUILLAGE, valeur);
      rafraichirDelaiVerrouillage();
      signalerEnregistre();
    } finally {
      setEnregistrementDelai(false);
    }
  }

  useEffect(() => {
    fabricationPropreActive(session.boutiqueId).then(setFabricationPropre);
  }, [session.boutiqueId]);

  async function changerFabricationPropre(active: boolean) {
    setEnregistrementFabrication(true);
    setErreurFabrication(null);
    try {
      await definirParametre(session.boutiqueId, CLE_PARAMETRE_FABRICATION_PROPRE, active ? "1" : "0");
      setFabricationPropre(active);
      signalerEnregistre();
    } catch (e) {
      setErreurFabrication(e instanceof ErreurConfiguration ? e.message : "Erreur inattendue.");
    } finally {
      setEnregistrementFabrication(false);
    }
  }

  return (
    <div className="reglage-catalogue">
      {enregistre && <div className="toast-enregistre">Enregistré ✓</div>}
      {peutGerer && (
        <div className="bloc-apparence">
          <h3>Approvisionnement</h3>
          {erreurFabrication && <div className="message-erreur">{erreurFabrication}</div>}
          <label className="option-fabrication-propre">
            <input
              type="checkbox"
              checked={!!fabricationPropre}
              disabled={fabricationPropre === null || enregistrementFabrication}
              onChange={(e) => changerFabricationPropre(e.target.checked)}
            />
            <span>
              Ma boutique fabrique ses propres produits
              <span className="note-aide">
                À cocher si vous fabriquez vous-même ce que vous vendez (pain, savon, couture…) : vous pourrez
                ajouter du stock directement. Sinon, le stock s'ajoute en réceptionnant vos achats auprès de vos
                fournisseurs.
              </span>
            </span>
          </label>
        </div>
      )}
      {peutGerer && (
        <div className="bloc-apparence">
          <h3>Verrouillage automatique</h3>
          <p className="note-aide">
            Verrouille l'application après une période d'inactivité, pour protéger l'accès si un poste reste ouvert.
          </p>
          <div className="bascule-vue bascule-delai" role="group" aria-label="Délai de verrouillage">
            {OPTIONS_DELAI_VERROUILLAGE.map((o) => (
              <button
                key={o.valeur}
                type="button"
                className={String(delaiVerrouillage) === o.valeur ? "actif" : ""}
                disabled={enregistrementDelai}
                onClick={() => changerDelaiVerrouillage(o.valeur)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="bloc-apparence">
        <h3>Thème</h3>
        <div className="groupe-theme">
          {THEMES_DISPONIBLES.map((t) => (
            <button
              key={t.valeur}
              type="button"
              className={`bouton-theme ${theme === t.valeur ? "actif" : ""}`}
              onClick={() => changerTheme(t.valeur)}
            >
              <span className="apercu-theme" aria-hidden="true">
                {t.couleurs.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Thèmes proposés, avec un aperçu de leurs trois couleurs (fond, accent, surface). */
const THEMES_DISPONIBLES: { valeur: Theme; label: string; couleurs: string[] }[] = [
  { valeur: "clair", label: "Clair", couleurs: ["#ffffff", "#2563eb", "#e2e8f0"] },
  { valeur: "sombre", label: "Sombre", couleurs: ["#0f172a", "#3b82f6", "#1e293b"] },
  { valeur: "nuit", label: "Nuit", couleurs: ["#050505", "#f59e0b", "#1a1a1a"] },
  { valeur: "orange", label: "Orange", couleurs: ["#fff7ed", "#ea580c", "#fdba74"] },
  { valeur: "vert", label: "Vert", couleurs: ["#f0fdf4", "#16a34a", "#86efac"] },
  { valeur: "bleu", label: "Bleu", couleurs: ["#eff6ff", "#1d4ed8", "#93c5fd"] },
  { valeur: "gris", label: "Gris", couleurs: ["#f8fafc", "#475569", "#cbd5e1"] },
];

// --- Onglet Paramètres > Unités ---

function OngletUnites({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [unites, setUnites] = useState<UniteResume[]>([]);
  const [nom, setNom] = useState("");
  const [abreviation, setAbreviation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enEditionId, setEnEditionId] = useState<string | null>(null);
  const [nomEdition, setNomEdition] = useState("");
  const [abreviationEdition, setAbreviationEdition] = useState("");
  const [confirmationSuppressionId, setConfirmationSuppressionId] = useState<string | null>(null);
  const [courantesOuvert, setCourantesOuvert] = useState(false);
  const [usages, setUsages] = useState<UsagesCatalogue | null>(null);
  useEffect(() => {
    usagesCatalogue(session.boutiqueId).then(setUsages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  async function rafraichir() {
    setUnites(await listerUnites(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    try {
      await creerUnite(session.boutiqueId, nom.trim(), abreviation.trim());
      setNom("");
      setAbreviation("");
      setErreur(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  function commencerEdition(u: UniteResume) {
    setEnEditionId(u.id);
    setNomEdition(u.nom);
    setAbreviationEdition(u.abreviation);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    try {
      await modifierUnite(id, { nom: nomEdition.trim(), abreviation: abreviationEdition.trim() });
      setEnEditionId(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  async function supprimer(id: string) {
    try {
      await supprimerUnite(id);
      setConfirmationSuppressionId(null);
      rafraichir();
    } catch (e) {
      setConfirmationSuppressionId(null);
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  return (
    <div className="reglage-catalogue">
      {peutGerer && (
        <form onSubmit={ajouter} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Nouvelle unité" value={nom} onChange={(e) => setNom(e.target.value)} />
          <input placeholder="Abréviation" value={abreviation} onChange={(e) => setAbreviation(e.target.value)} style={{ width: "100px" }} />
          <button type="submit">Ajouter</button>
          <button type="button" className="bouton-courants" onClick={() => setCourantesOuvert(true)}>
            ➕ Unités courantes
          </button>
        </form>
      )}
      {courantesOuvert && (
        <ModaleUnitesCourantes
          session={session}
          existantes={unites.map((u) => u.nom)}
          onFermer={() => setCourantesOuvert(false)}
          onAjoute={rafraichir}
        />
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Unité</th>
              <th>Abréviation</th>
              <th>Articles qui l'utilisent</th>
              {peutGerer && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {unites.map((u) =>
              enEditionId === u.id ? (
                <tr key={u.id}>
                  <td>
                    <input value={nomEdition} onChange={(e) => setNomEdition(e.target.value)} autoFocus />
                  </td>
                  <td>
                    <input value={abreviationEdition} onChange={(e) => setAbreviationEdition(e.target.value)} style={{ width: "100px" }} />
                  </td>
                  <td>{usages?.unites[u.id] ?? 0}</td>
                  <td>
                    <span className="actions-ligne">
                      <button type="button" onClick={() => setEnEditionId(null)}>
                        Annuler
                      </button>
                      <button type="button" className="bouton-primaire" onClick={() => enregistrerEdition(u.id)}>
                        Enregistrer
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={u.id}>
                  <td>{u.nom}</td>
                  <td>{u.abreviation || "—"}</td>
                  <td>{usages ? (usages.unites[u.id] ?? 0) : "…"}</td>
                  {peutGerer && (
                    <td>
                      <span className="actions-ligne">
                        <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(u)}>
                          ✎
                        </button>
                        <button
                          type="button"
                          className="lien-icone lien-icone-danger"
                          title={(usages?.unites[u.id] ?? 0) > 0 ? "Utilisée par des articles" : "Supprimer"}
                          onClick={() => setConfirmationSuppressionId(u.id)}
                        >
                          ×
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ),
            )}
            {unites.length === 0 && (
              <tr>
                <td colSpan={4} className="liste-vide">
                  Aucune unité.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {confirmationSuppressionId && (
        <ModaleConfirmation
          titre="Supprimer cette unité ?"
          description={
            (usages?.unites[confirmationSuppressionId] ?? 0) > 0
              ? `Attention : ${usages?.unites[confirmationSuppressionId]} article(s) utilisent cette unité ; ils n'en auront plus.`
              : "Aucun article n'utilise cette unité."
          }
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setConfirmationSuppressionId(null)}
          onConfirmer={() => supprimer(confirmationSuppressionId)}
        />
      )}
    </div>
  );
}

// --- Onglet Paramètres > Attributs ---

function OngletAttributs({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [attributs, setAttributs] = useState<ReferenceNommee[]>([]);
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enEditionId, setEnEditionId] = useState<string | null>(null);
  const [nomEdition, setNomEdition] = useState("");
  const [confirmationSuppressionId, setConfirmationSuppressionId] = useState<string | null>(null);
  const [courantsOuvert, setCourantsOuvert] = useState(false);
  const [valeurs, setValeurs] = useState<Record<string, { id: string; valeur: string }[]>>({});
  const [nouvelleValeur, setNouvelleValeur] = useState<Record<string, string>>({});
  const [valeurEdition, setValeurEdition] = useState<{ id: string; texte: string } | null>(null);
  async function chargerValeurs(liste: { id: string }[]) {
    const parAttribut: Record<string, { id: string; valeur: string }[]> = {};
    for (const a of liste) parAttribut[a.id] = await listerValeursAttribut(a.id);
    setValeurs(parAttribut);
  }
  useEffect(() => {
    chargerValeurs(attributs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributs]);

  async function ajouterValeur(attributId: string) {
    const texte = (nouvelleValeur[attributId] ?? "").trim();
    if (!texte) return;
    const message = await (async () => {
      try {
        await creerValeurAttribut(attributId, texte);
        return null;
      } catch (e) {
        return e instanceof ErreurProduit ? e.message : "Erreur inattendue.";
      }
    })();
    if (message) setErreur(message);
    else {
      setNouvelleValeur({ ...nouvelleValeur, [attributId]: "" });
      chargerValeurs(attributs);
    }
  }

  async function renommerValeur() {
    if (!valeurEdition || !valeurEdition.texte.trim()) return;
    const message = await (async () => {
      try {
        await modifierValeurAttribut(valeurEdition.id, valeurEdition.texte.trim());
        return null;
      } catch (e) {
        return e instanceof ErreurProduit ? e.message : "Erreur inattendue.";
      }
    })();
    if (message) setErreur(message);
    else {
      setValeurEdition(null);
      chargerValeurs(attributs);
    }
  }

  async function retirerValeur(id: string) {
    const message = await (async () => {
      try {
        await supprimerValeurAttribut(id);
        return null;
      } catch (e) {
        return e instanceof ErreurProduit ? e.message : "Erreur inattendue.";
      }
    })();
    if (message) setErreur(message);
    else chargerValeurs(attributs);
  }
  const [usages, setUsages] = useState<UsagesCatalogue | null>(null);
  useEffect(() => {
    usagesCatalogue(session.boutiqueId).then(setUsages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  async function rafraichir() {
    setAttributs(await listerAttributs(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    try {
      await creerAttribut(session.boutiqueId, nom.trim());
      setNom("");
      setErreur(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  function commencerEdition(a: ReferenceNommee) {
    setEnEditionId(a.id);
    setNomEdition(a.nom);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    try {
      await modifierAttribut(id, nomEdition.trim());
      setEnEditionId(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  async function supprimer(id: string) {
    try {
      await supprimerAttribut(id);
      setConfirmationSuppressionId(null);
      rafraichir();
    } catch (e) {
      setConfirmationSuppressionId(null);
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  return (
    <div className="reglage-catalogue">
      {peutGerer && (
        <form onSubmit={ajouter} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Nouvel attribut (ex. Couleur)" value={nom} onChange={(e) => setNom(e.target.value)} />
          <button type="submit">Ajouter</button>
          <button type="button" className="bouton-courants" onClick={() => setCourantsOuvert(true)}>
            ➕ Attributs courants
          </button>
        </form>
      )}
      {courantsOuvert && (
        <ModaleAttributsCourants
          session={session}
          attributs={attributs}
          valeurs={valeurs}
          onFermer={() => setCourantsOuvert(false)}
          onAjoute={rafraichir}
        />
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      <p className="note-aide">Les valeurs de chaque attribut (ex. Rouge, Bleu pour Couleur) se créent directement lors de l'ajout d'une variante.</p>
      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Attribut</th>
              <th>Valeurs</th>
              <th>Articles qui l'utilisent</th>
              {peutGerer && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {attributs.map((a) =>
              enEditionId === a.id ? (
                <tr key={a.id}>
                  <td>
                    <input value={nomEdition} onChange={(e) => setNomEdition(e.target.value)} autoFocus />
                  </td>
                  <td>{(valeurs[a.id] ?? []).map((v) => v.valeur).join(", ") || "—"}</td>
                  <td>{usages?.attributs[a.id] ?? 0}</td>
                  <td>
                    <span className="actions-ligne">
                      <button type="button" onClick={() => setEnEditionId(null)}>
                        Annuler
                      </button>
                      <button type="button" className="bouton-primaire" onClick={() => enregistrerEdition(a.id)}>
                        Enregistrer
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={a.id}>
                  <td>{a.nom}</td>
                  <td>
                    <span className="pastilles-valeurs">
                      {(valeurs[a.id] ?? []).map((v) =>
                        valeurEdition?.id === v.id ? (
                          <input
                            key={v.id}
                            className="pastille-edition"
                            value={valeurEdition.texte}
                            autoFocus
                            onChange={(e) => setValeurEdition({ id: v.id, texte: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") renommerValeur();
                              if (e.key === "Escape") setValeurEdition(null);
                            }}
                            onBlur={() => setValeurEdition(null)}
                          />
                        ) : (
                          <span key={v.id} className="pastille-valeur">
                            <span
                              title={peutGerer ? "Cliquer pour renommer" : undefined}
                              onClick={() => peutGerer && setValeurEdition({ id: v.id, texte: v.valeur })}
                            >
                              {v.valeur}
                            </span>
                            {peutGerer && (
                              <button type="button" title="Retirer cette valeur" onClick={() => retirerValeur(v.id)}>
                                ×
                              </button>
                            )}
                          </span>
                        ),
                      )}
                      {peutGerer && (
                        <input
                          className="pastille-ajout"
                          placeholder="+ valeur"
                          value={nouvelleValeur[a.id] ?? ""}
                          onChange={(e) => setNouvelleValeur({ ...nouvelleValeur, [a.id]: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") ajouterValeur(a.id);
                          }}
                        />
                      )}
                    </span>
                  </td>
                  <td>{usages ? (usages.attributs[a.id] ?? 0) : "…"}</td>
                  {peutGerer && (
                    <td>
                      <span className="actions-ligne">
                        <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(a)}>
                          ✎
                        </button>
                        <button
                          type="button"
                          className="lien-icone lien-icone-danger"
                          title="Supprimer"
                          onClick={() => setConfirmationSuppressionId(a.id)}
                        >
                          ×
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ),
            )}
            {attributs.length === 0 && (
              <tr>
                <td colSpan={4} className="liste-vide">
                  Aucun attribut.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {confirmationSuppressionId && (
        <ModaleConfirmation
          titre="Supprimer cet attribut ?"
          description={
            (usages?.attributs[confirmationSuppressionId] ?? 0) > 0
              ? `Attention : ${usages?.attributs[confirmationSuppressionId]} article(s) utilisent cet attribut dans leurs variantes.`
              : "Aucun article n'utilise cet attribut."
          }
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setConfirmationSuppressionId(null)}
          onConfirmer={() => supprimer(confirmationSuppressionId)}
        />
      )}
    </div>
  );
}

// --- Onglet Paramètres > Dépôts ---

function OngletDepots({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enEditionId, setEnEditionId] = useState<string | null>(null);
  const [nomEdition, setNomEdition] = useState("");
  const [adresseEdition, setAdresseEdition] = useState("");
  const [confirmationSuppressionId, setConfirmationSuppressionId] = useState<string | null>(null);
  const [transfert, setTransfert] = useState<{ source: { id: string; nom: string }; destinationId: string } | null>(null);
  const [enCoursTransfert, setEnCoursTransfert] = useState(false);
  const [supprimes, setSupprimes] = useState<DepotSupprimeAvecStock[]>([]);
  useEffect(() => {
    depotsSupprimesAvecStock(session.boutiqueId).then(setSupprimes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depots]);

  async function confirmerTransfert() {
    if (!transfert || !transfert.destinationId) return;
    setEnCoursTransfert(true);
    const message = await (async () => {
      try {
        await transfererToutLeStock(transfert.source.id, transfert.destinationId, session.utilisateurId);
        return null;
      } catch (e) {
        return e instanceof ErreurStock ? e.message : "Erreur inattendue.";
      }
    })();
    setEnCoursTransfert(false);
    if (message) {
      setErreur(message);
      return;
    }
    setTransfert(null);
    setErreur(null);
    rafraichir();
  }

  async function rafraichir() {
    const tous = await listerDepotsDetail(session.boutiqueId);
    setDepots(peutGerer || !session.depotId ? tous : tous.filter((d) => d.id === session.depotId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const devise = useDevise();
  const [statsDepots, setStatsDepots] = useState<Record<string, { articles: number; valeur: number }>>({});
  const [utilisateursParDepot, setUtilisateursParDepot] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    (async () => {
      const stats: Record<string, { articles: number; valeur: number }> = {};
      for (const d of depots) {
        const lignes = await listerStock(session.boutiqueId, d.id);
        stats[d.id] = {
          articles: lignes.filter((l) => l.quantite > 0).length,
          valeur: lignes.reduce((t, l) => t + l.quantite * l.prixAchat, 0),
        };
      }
      setStatsDepots(stats);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depots]);
  useEffect(() => {
    api.comptes.listerUtilisateurs().then((r) => {
      if (!r.succes) return;
      const parDepot: Record<string, number> = {};
      for (const u of r.resultat) if (u.depot) parDepot[u.depot] = (parDepot[u.depot] ?? 0) + 1;
      setUtilisateursParDepot(parDepot);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    try {
      await creerDepot(session.boutiqueId, nom.trim(), adresse.trim());
      setNom("");
      setAdresse("");
      setErreur(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
    }
  }

  function commencerEdition(d: DepotResume) {
    setEnEditionId(d.id);
    setNomEdition(d.nom);
    setAdresseEdition(d.adresse);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    try {
      await modifierDepot(id, { nom: nomEdition.trim(), adresse: adresseEdition.trim() });
      setEnEditionId(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
    }
  }

  async function supprimer(id: string) {
    try {
      await supprimerDepot(id);
      setConfirmationSuppressionId(null);
      rafraichir();
    } catch (e) {
      setConfirmationSuppressionId(null);
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
    }
  }

  return (
    <div className="reglage-catalogue">
      {peutGerer && (
        <form onSubmit={ajouter} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Nouveau dépôt" value={nom} onChange={(e) => setNom(e.target.value)} />
          <input placeholder="Adresse" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
          <button type="submit">Ajouter</button>
        </form>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      {supprimes.length > 0 && peutGerer && (
        <div className="bloc-hors-ligne bloc-depots-supprimes">
          <span>
            ⚠️ Du stock est resté dans {supprimes.length > 1 ? "des dépôts supprimés" : "un dépôt supprimé"} :
            {supprimes.map((d) => (
              <span key={d.id} className="ligne-depot-supprime">
                <br />
                <strong>{d.nom}</strong> · {d.articles} article(s) · {formaterMontant(d.valeur)} {devise}{" "}
                <button
                  type="button"
                  onClick={() => setTransfert({ source: d, destinationId: depots[0]?.id ?? "" })}
                  disabled={depots.length === 0}
                >
                  Rapatrier…
                </button>
              </span>
            ))}
          </span>
        </div>
      )}
      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Dépôt</th>
              <th>Adresse</th>
              <th>Articles en stock</th>
              <th>Valeur du stock</th>
              <th>Utilisateurs</th>
              {peutGerer && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {depots.map((d) =>
              enEditionId === d.id ? (
                <tr key={d.id}>
                  <td>
                    <input value={nomEdition} onChange={(e) => setNomEdition(e.target.value)} autoFocus />
                  </td>
                  <td>
                    <input value={adresseEdition} onChange={(e) => setAdresseEdition(e.target.value)} />
                  </td>
                  <td>{statsDepots[d.id]?.articles ?? 0}</td>
                  <td className="nowrap">{formaterMontant(statsDepots[d.id]?.valeur ?? 0)} {devise}</td>
                  <td>{utilisateursParDepot === null ? "—" : (utilisateursParDepot[d.id] ?? 0)}</td>
                  <td>
                    <span className="actions-ligne">
                      <button type="button" onClick={() => setEnEditionId(null)}>
                        Annuler
                      </button>
                      <button type="button" className="bouton-primaire" onClick={() => enregistrerEdition(d.id)}>
                        Enregistrer
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={d.id}>
                  <td>{d.nom}</td>
                  <td>{d.adresse || "—"}</td>
                  <td>{statsDepots[d.id] ? statsDepots[d.id].articles : "…"}</td>
                  <td className="nowrap">{statsDepots[d.id] ? `${formaterMontant(statsDepots[d.id].valeur)} ${devise}` : "…"}</td>
                  <td title={utilisateursParDepot === null ? "Connexion internet nécessaire" : undefined}>
                    {utilisateursParDepot === null ? "—" : (utilisateursParDepot[d.id] ?? 0)}
                  </td>
                  {peutGerer && (
                    <td>
                      <span className="actions-ligne">
                        <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(d)}>
                          ✎
                        </button>
                        {(statsDepots[d.id]?.articles ?? 0) > 0 && depots.length > 1 && (
                          <button
                            type="button"
                            className="lien-icone"
                            title="Transférer tout le stock vers un autre dépôt"
                            onClick={() => setTransfert({ source: d, destinationId: depots.find((x) => x.id !== d.id)?.id ?? "" })}
                          >
                            ⇄
                          </button>
                        )}
                        <button
                          type="button"
                          className="lien-icone lien-icone-danger"
                          title="Supprimer"
                          onClick={() => setConfirmationSuppressionId(d.id)}
                        >
                          ×
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ),
            )}
            {depots.length === 0 && (
              <tr>
                <td colSpan={6} className="liste-vide">
                  Aucun dépôt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {transfert && (
        <ModaleConfirmation
          titre={`Transférer tout le stock de « ${transfert.source.nom} »`}
          description="Chaque article part vers le dépôt choisi (un transfert par article, visible dans Stock → Transferts)."
          labelConfirmer={enCoursTransfert ? "Transfert…" : "Tout transférer"}
          enCours={enCoursTransfert}
          onAnnuler={() => setTransfert(null)}
          onConfirmer={confirmerTransfert}
        >
          <label className="champ-formulaire">
            Vers le dépôt
            <select value={transfert.destinationId} onChange={(e) => setTransfert({ ...transfert, destinationId: e.target.value })}>
              {depots
                .filter((d) => d.id !== transfert.source.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
            </select>
          </label>
        </ModaleConfirmation>
      )}
      {confirmationSuppressionId && (
        <ModaleConfirmation
          titre="Supprimer ce dépôt ?"
          description={
            (statsDepots[confirmationSuppressionId]?.articles ?? 0) > 0
              ? `Ce dépôt contient encore ${statsDepots[confirmationSuppressionId].articles} article(s) : la suppression sera refusée. Utilisez d'abord ⇄ pour tout transférer.`
              : "Le dépôt est vide : il peut être supprimé."
          }
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setConfirmationSuppressionId(null)}
          onConfirmer={() => supprimer(confirmationSuppressionId)}
        />
      )}
    </div>
  );
}

// --- Sous-onglets Paramètres ---

const SOUS_ONGLETS_PARAMETRES = [
  { cle: "general", label: "Général" },
  { cle: "unites", label: "Unités" },
  { cle: "attributs", label: "Attributs" },
  { cle: "depots", label: "Dépôts" },
] as const;

type SousOngletParametres = (typeof SOUS_ONGLETS_PARAMETRES)[number]["cle"];

function OngletParametresGeneraux({ session }: { session: Session }) {
  const [sousOnglet, setSousOnglet] = useState<SousOngletParametres>("general");

  return (
    <div className="modale-avec-menu">
      <nav className="menu-modale">
        {SOUS_ONGLETS_PARAMETRES.map((o) => (
          <button key={o.cle} type="button" className={sousOnglet === o.cle ? "actif" : ""} onClick={() => setSousOnglet(o.cle)}>
            <span className="icone-menu-modale">
              {o.cle === "general" ? "⚙️" : o.cle === "unites" ? "📏" : o.cle === "attributs" ? "🎨" : "🏬"}
            </span>
            {o.label}
          </button>
        ))}
      </nav>
      <div className="modale-corps">
        {sousOnglet === "general" && <OngletParametresGeneral session={session} />}
        {sousOnglet === "unites" && <OngletUnites session={session} />}
        {sousOnglet === "attributs" && <OngletAttributs session={session} />}
        {sousOnglet === "depots" && <OngletDepots session={session} />}
      </div>
    </div>
  );
}

// --- Page principale ---
// Chaque section (Informations boutique / Utilisateurs & rôles / Paramètres)
// est un bouton-carte qui ouvre sa propre modale, même patron que
// Comptabilite.tsx et Rapports.tsx.

function ModaleProfilBoutique({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <OngletProfilBoutique session={session} onFermer={onFermer} />
      </div>
    </div>
  );
}

/**
 * Rejoue une modification d'abonnement faite hors-ligne depuis l'Espace Admin
 * (voir GererAbonnement.tsx) : par sécurité, le mot de passe admin n'est
 * jamais conservé sur le poste entre l'action hors-ligne et son envoi au
 * serveur — on le redemande donc ici, une seule fois, au retour du réseau.
 */
function BlocAbonnementEnAttente() {
  const [enAttente, setEnAttente] = useState<AbonnementEnAttente | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    setEnAttente(lireAbonnementEnAttente());
  }, []);

  if (!enAttente) return null;

  async function confirmer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!enAttente) return;
    setErreur(null);
    setEnCours(true);
    try {
      const reponse = await soumettreAbonnement(username, password, enAttente.boutiqueId, enAttente.boutiqueNom, enAttente.champs);
      if (reponse.statut === "synchronise") setEnAttente(null);
      else setErreur("Toujours hors-ligne : réessayez plus tard.");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={confirmer} className="reglage-catalogue">
      <p className="note-aide">
        Une modification d'abonnement faite hors-ligne (Espace Admin) attend d'être transmise au serveur. Ressaisissez
        les identifiants admin pour la confirmer.
      </p>
      {erreur && <p className="message-erreur">{erreur}</p>}
      <div className="grille-champs">
        <label>
          Nom d'utilisateur admin
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Mot de passe admin
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
      </div>
      <div className="actions-formulaire">
        <button type="submit" className="bouton-primaire" disabled={enCours}>
          {enCours ? "Envoi…" : "Confirmer"}
        </button>
      </div>
    </form>
  );
}

/**
 * "Créer une boutique" hors-ligne (voir Inscription.tsx, dans Espace Admin)
 * laisse ce marqueur : la boutique n'existe encore que sur ce poste, jamais
 * côté serveur. "Activer en ligne" ici l'enregistre pour de vrai — geste
 * séparé de la création, jamais un préalable (voir services/
 * inscriptionLocale.ts::activerEnLigne). Le mot de passe du Patron est
 * redemandé : jamais conservé en clair depuis la création.
 */
function BlocActivationBoutiqueLocale({ session }: { session: Session }) {
  const { definirSession } = useSession();
  const [enAttente, setEnAttente] = useState<BoutiqueLocaleEnAttente | null>(null);
  const [usernameAdmin, setUsernameAdmin] = useState("");
  const [passwordAdmin, setPasswordAdmin] = useState("");
  const [patronPassword, setPatronPassword] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    setEnAttente(lireBoutiqueLocaleEnAttente());
  }, []);

  if (!enAttente) return null;

  async function activer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!enAttente) return;
    setErreur(null);
    setEnCours(true);
    try {
      const sessionMiseAJour = await activerEnLigne(usernameAdmin, passwordAdmin, patronPassword, session);
      definirSession(sessionMiseAJour);
      setEnAttente(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={activer} className="reglage-catalogue">
      <p className="note-aide">
        Cette boutique a été créée hors-ligne : elle n'existe encore que sur ce poste. Activez-la en ligne pour
        profiter de la sauvegarde et de la synchronisation.
      </p>
      {erreur && <p className="message-erreur">{erreur}</p>}
      <div className="grille-champs">
        <label>
          Nom d'utilisateur admin
          <input value={usernameAdmin} onChange={(e) => setUsernameAdmin(e.target.value)} required />
        </label>
        <label>
          Mot de passe admin
          <input type="password" value={passwordAdmin} onChange={(e) => setPasswordAdmin(e.target.value)} required />
        </label>
        <label>
          Votre mot de passe (Patron)
          <input
            type="password"
            value={patronPassword}
            onChange={(e) => setPatronPassword(e.target.value)}
            required
          />
        </label>
      </div>
      <div className="actions-formulaire">
        <button type="submit" className="bouton-primaire" disabled={enCours}>
          {enCours ? "Activation…" : "Activer en ligne"}
        </button>
      </div>
    </form>
  );
}

function OngletSynchronisation({ session }: { session: Session }) {
  const { etat, enCours, erreur, synchroniser, verifierActivation } = useSynchro();
  const [enAttente, setEnAttente] = useState<{ table: string; nombre: number }[] | null>(null);
  useEffect(() => {
    compterEnAttente().then(setEnAttente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, etat?.derniereSynchro]);
  const totalEnAttente = (enAttente ?? []).reduce((t, l) => t + l.nombre, 0);
  const joursDepuis = etat?.derniereSynchro
    ? Math.floor((Date.now() - new Date(etat.derniereSynchro).getTime()) / 86_400_000)
    : null;
  const libelleDerniereSynchro =
    joursDepuis === null ? "Jamais" : joursDepuis === 0 ? "Aujourd'hui" : joursDepuis === 1 ? "Hier" : `Il y a ${joursDepuis} jours`;

  if (!session.synchroAutorisee) {
    return (
      <div className="reglage-catalogue">
        <BlocActivationBoutiqueLocale session={session} />
        <BlocAbonnementEnAttente />
        <p className="note-aide">
          La synchronisation n'est pas encore activée pour votre boutique. Contactez l'administrateur pour l'activer.
        </p>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" onClick={verifierActivation} disabled={enCours}>
            {enCours ? "Vérification…" : "Vérifier l'activation"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reglage-catalogue reglage-synchro">
      <BlocAbonnementEnAttente />
      <div className="tuiles-fiche">
        <div className={`tuile-fiche${etat?.enLigne ? "" : " tuile-fiche--alerte"}`}>
          <span className="sous-info">📶 État</span>
          <strong className={etat?.enLigne ? "montant-entree" : "texte-erreur"}>
            <span className={`point ${etat?.enLigne ? "point-en-ligne" : "point-hors-ligne"}`} /> {etat?.enLigne ? "En ligne" : "Hors ligne"}
          </strong>
        </div>
        <div className={`tuile-fiche${joursDepuis !== null && joursDepuis > 7 ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">🕘 Dernière synchro</span>
          <strong>{libelleDerniereSynchro}</strong>
          <span className="sous-info">{formaterDateSynchro(etat?.derniereSynchro ?? null)}</span>
        </div>
        <div className={`tuile-fiche${totalEnAttente > 0 ? " tuile-fiche--attention" : ""}`}>
          <span className="sous-info">📤 Changements à envoyer</span>
          <strong>{enAttente === null ? "…" : totalEnAttente}</strong>
        </div>
      </div>
      {erreur && <p className="message-erreur">{erreur}</p>}
      <div className="barre-actions">
        <span className="sous-info">
          {totalEnAttente > 0
            ? "Ces changements ne sont enregistrés que sur cet appareil tant qu'ils n'ont pas été envoyés."
            : "Tout est sauvegardé en ligne."}
        </span>
        <span className="actions-ligne">
          <button
            type="button"
            className="bouton-primaire"
            onClick={async () => {
              await synchroniser();
              setEnAttente(await compterEnAttente());
            }}
            disabled={enCours}
          >
            {enCours ? "Synchronisation…" : "⟳ Synchroniser maintenant"}
          </button>
        </span>
      </div>
      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Type de données</th>
              <th>Changements en attente</th>
            </tr>
          </thead>
          <tbody>
            {(enAttente ?? []).map((l) => (
              <tr key={l.table}>
                <td>{LIBELLES_TABLES_SYNCHRO[l.table] ?? l.table}</td>
                <td>{l.nombre}</td>
              </tr>
            ))}
            {enAttente !== null && enAttente.length === 0 && (
              <tr>
                <td colSpan={2} className="liste-vide">
                  Aucun changement en attente 👍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModaleSynchronisation({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Synchronisation" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletSynchronisation session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleUtilisateursRoles({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Utilisateurs & rôles" onFermer={onFermer} />
        <OngletUtilisateursRoles session={session} />
      </div>
    </div>
  );
}

function ModaleParametres({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Paramètres" onFermer={onFermer} />
        <OngletParametresGeneraux session={session} />
      </div>
    </div>
  );
}

export default function Reglages({ session }: { session: Session }) {
  const [sectionOuverte, setSectionOuverte] = useState<Section | null>(null);

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
      {sectionOuverte === "profil" && (
        <ModaleProfilBoutique session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "utilisateurs" && (
        <ModaleUtilisateursRoles session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "parametres" && (
        <ModaleParametres session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "synchronisation" && (
        <ModaleSynchronisation session={session} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
