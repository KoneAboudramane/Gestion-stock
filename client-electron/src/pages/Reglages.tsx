import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useRafraichirDevise } from "../contexts/DeviseContext";
import { useRafraichirLogoBoutique } from "../contexts/LogoContext";
import { useRafraichirNomBoutique } from "../contexts/NomBoutiqueContext";
import { useSynchro } from "../contexts/SynchroContext";
import type {
  AbonnementEnAttente,
  BoutiqueDetail,
  BoutiqueLocaleEnAttente,
  DepotResume,
  ReferenceNommee,
  RoleResume,
  Session,
  UniteResume,
  UtilisateurResume,
} from "../api/client";
import { appliquerTheme, themeActuel, type Theme } from "../lib/theme";

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

function formaterDateSynchro(iso: string | null): string {
  if (!iso) return "jamais";
  return new Date(iso).toLocaleString("fr-FR");
}

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

function OngletProfilBoutique({
  session,
  onSessionMiseAJour,
  onFermer,
}: {
  session: Session;
  onSessionMiseAJour: (session: Session) => void;
  onFermer: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_utilisateurs_reglages;
  const [boutique, setBoutique] = useState<BoutiqueDetail | null>(null);
  const [logo, setLogo] = useState("");
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
  const rafraichirDevise = useRafraichirDevise();
  const rafraichirLogo = useRafraichirLogoBoutique();
  const rafraichirNomBoutique = useRafraichirNomBoutique();

  async function charger() {
    const [b, l, resultatUtilisateurs, listeDepots, parametres] = await Promise.all([
      api.reglages.obtenirBoutique(session.boutiqueId),
      api.reglages.obtenirLogoBoutique(session.boutiqueId),
      api.comptes.listerUtilisateurs(session),
      api.depots.lister(session.boutiqueId),
      api.reglages.listerParametres(session.boutiqueId),
    ]);
    setBoutique(b ?? null);
    setLogo(l);
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
  }, [session.boutiqueId, session.utilisateurId]);

  function choisirLogo(fichier: File | undefined) {
    if (!fichier) return;
    const lecteur = new FileReader();
    lecteur.onload = () => setLogo(String(lecteur.result));
    lecteur.readAsDataURL(fichier);
  }

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!boutique) return;
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      const resultat = await api.reglages.modifierBoutique(boutique.id, {
        nom: boutique.nom,
        adresse: boutique.adresse,
        telephone: boutique.telephone,
        email: boutique.email,
        devise: boutique.devise,
      });
      if (!resultat.succes) {
        setErreur(resultat.message);
        return;
      }
      const tauxSaisi = tauxTva.trim();
      if (tauxSaisi && (Number.isNaN(Number(tauxSaisi)) || Number(tauxSaisi) < 0 || Number(tauxSaisi) > 100)) {
        setErreur("Le taux de TVA doit être un nombre entre 0 et 100.");
        return;
      }
      const resultatTva = await api.reglages.definirParametre(session.boutiqueId, "taux_tva", tauxSaisi);
      if (!resultatTva.succes) {
        setErreur(resultatTva.message);
        return;
      }
      const resultatFormatTicket = await api.reglages.definirParametre(
        session.boutiqueId,
        "format_ticket",
        formatTicket,
      );
      if (!resultatFormatTicket.succes) {
        setErreur(resultatFormatTicket.message);
        return;
      }
      if (moi) {
        const resultatCompte = await api.comptes.modifierUtilisateur(session, moi.id, {
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
        // que Trésorerie/Caisse le reflètent immédiatement, sans redémarrage.
        api.auth.rafraichirPermissions(session).then(onSessionMiseAJour);
      }
      await api.reglages.definirLogoBoutique(session.boutiqueId, logo);
      setMessage("Informations enregistrées.");
      rafraichirDevise();
      rafraichirLogo();
      rafraichirNomBoutique();
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
    return (
      <>
        <div className="modale-entete entete-fixe">
          <h3>Informations boutique</h3>
          <div className="actions-formulaire">
            {peutGerer && (
              <button type="button" className="bouton-primaire" onClick={() => setModeEdition(true)}>
                Modifier
              </button>
            )}
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
        </div>
        <div className="modale-corps">
        <div className="formulaire-catalogue formulaire-profil-boutique">
        {message && <p className="note-aide">{message}</p>}
        <div className="champ-logo-boutique">
          {logo ? (
            <img src={logo} alt="Logo de la boutique" className="apercu-logo-boutique" />
          ) : (
            <div className="apercu-logo-boutique apercu-logo-vide">{boutique.nom.charAt(0).toUpperCase()}</div>
          )}
        </div>
        <div className="colonnes-profil-boutique">
          <div>
            <h4>Boutique</h4>
            <div className="grille-champs">
              <div>
                <p className="note-aide">Nom de la boutique</p>
                <p>{boutique.nom || ""}</p>
              </div>
              <div>
                <p className="note-aide">Adresse</p>
                <p>{boutique.adresse || ""}</p>
              </div>
              <div>
                <p className="note-aide">Téléphone</p>
                <p>{boutique.telephone || ""}</p>
              </div>
              <div>
                <p className="note-aide">Email</p>
                <p>{boutique.email || ""}</p>
              </div>
              <div>
                <p className="note-aide">Devise</p>
                <p>{boutique.devise || ""}</p>
              </div>
              <div>
                <p className="note-aide">Taux de TVA</p>
                <p>{tauxTva ? `${tauxTva} %` : "Non assujetti"}</p>
              </div>
              <div>
                <p className="note-aide">Format du ticket</p>
                <p>{LIBELLES_FORMAT_TICKET[formatTicket] ?? formatTicket}</p>
              </div>
            </div>
          </div>
          {moi && (
            <div>
              <h4>Mon compte</h4>
              <div className="grille-champs">
                <div>
                  <p className="note-aide">Nom d'utilisateur</p>
                  <p>{moi.username}</p>
                </div>
                <div>
                  <p className="note-aide">Rôle</p>
                  <p>{session.role}</p>
                </div>
                <div>
                  <p className="note-aide">Téléphone</p>
                  <p>{moi.telephone || ""}</p>
                </div>
                <div>
                  <p className="note-aide">Email</p>
                  <p>{moi.email || ""}</p>
                </div>
                <div>
                  <p className="note-aide">Dépôt de vente</p>
                  <p>{depots.find((d) => d.id === depotId)?.nom || "Aucun"}</p>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="modale-entete entete-fixe">
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
      <div className="champ-logo-boutique">
        {logo ? (
          <img src={logo} alt="Logo de la boutique" className="apercu-logo-boutique" />
        ) : (
          <div className="apercu-logo-boutique apercu-logo-vide">{boutique.nom.charAt(0).toUpperCase()}</div>
        )}
        <label className="lien">
          Choisir un logo
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => choisirLogo(e.target.files?.[0])}
          />
        </label>
        {logo && (
          <button type="button" className="lien" onClick={() => setLogo("")}>
            Retirer
          </button>
        )}
      </div>
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
              <input
                value={boutique.adresse}
                onChange={(e) => setBoutique({ ...boutique, adresse: e.target.value })}
              />
            </label>
            <label>
              Téléphone
              <input
                value={boutique.telephone}
                onChange={(e) => setBoutique({ ...boutique, telephone: e.target.value })}
              />
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
            <p className="note-aide">Nom d'utilisateur : {moi.username} · Rôle : {session.role}</p>
            <div className="grille-champs">
              <label>
                Téléphone
                <input value={telephoneCompte} onChange={(e) => setTelephoneCompte(e.target.value)} />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={emailCompte}
                  onChange={(e) => setEmailCompte(e.target.value)}
                />
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

function CarteRole({
  role,
  session,
  onModifie,
}: {
  role: RoleResume;
  session: Session;
  onModifie: () => void;
}) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const estPatron = role.nom === "Patron";

  async function basculer(cle: string) {
    if (estPatron) return;
    setEnCours(true);
    setErreur(null);
    try {
      const nouvellesPermissions = { ...role.permissions, [cle]: !role.permissions[cle] };
      const resultat = await api.comptes.modifierRole(session, role.id, nouvellesPermissions);
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
      {estPatron && (
        <p className="note-aide">Le rôle Patron a toutes les permissions et ne peut pas être modifié.</p>
      )}
      <div className="grille-permissions">
        {CLES_PERMISSIONS.map((p) => (
          <label key={p.cle}>
            <input
              type="checkbox"
              checked={!!role.permissions[p.cle]}
              disabled={enCours || estPatron}
              onChange={() => basculer(p.cle)}
            />
            {p.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function genererMotDePasse(): string {
  // Alphabet sans caractères ambigus à l'écrit/à l'oral (0/O, 1/l/I).
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

function genererNomUtilisateur(
  prenom: string,
  nom: string,
  telephone: string,
  nomsExistants: Set<string>,
): string {
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
  session,
  roles,
  depots,
  nomsUtilisateursExistants,
  onAnnuler,
  onCree,
}: {
  session: Session;
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
      const resultat = await api.comptes.creerUtilisateur(session, {
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
        <div className="modale-entete entete-fixe">
          <h3>Utilisateur créé</h3>
        </div>
        <p className="note-aide">
          Note ce mot de passe maintenant et transmets-le à {utilisateurCree.username} : il ne sera plus affiché
          ensuite.
        </p>
        <div className="mot-de-passe-genere">
          <span>{utilisateurCree.username}</span>
          <strong>{utilisateurCree.password}</strong>
        </div>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" onClick={onCree}>
            J'ai noté le mot de passe
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={soumettre} className="formulaire-catalogue">
      <div className="modale-entete entete-fixe">
        <h3>Nouvel utilisateur</h3>
        <div className="actions-formulaire">
          <button type="submit" disabled={enCours}>
            {enCours ? "Création…" : "Créer"}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
          </button>
        </div>
      </div>
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
    </form>
  );
}

function LigneUtilisateur({
  utilisateur,
  roles,
  depots,
  session,
  onModifie,
}: {
  utilisateur: UtilisateurResume;
  roles: RoleResume[];
  depots: DepotResume[];
  session: Session;
  onModifie: () => void;
}) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState<string | null>(null);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);
  const roleActuel = roles.find((r) => r.id === utilisateur.role);
  const depotActuel = depots.find((d) => d.id === utilisateur.depot);

  async function reinitialiserMotDePasse() {
    setEnCours(true);
    setErreur(null);
    try {
      const motDePasse = genererMotDePasse();
      const resultat = await api.comptes.modifierUtilisateur(session, utilisateur.id, { password: motDePasse });
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
      const resultat = await api.comptes.modifierUtilisateur(session, utilisateur.id, {
        roleId: nouveauRoleId || null,
      });
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
      const resultat = await api.comptes.modifierUtilisateur(session, utilisateur.id, {
        depotId: nouveauDepotId || null,
      });
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
      const resultat = await api.comptes.modifierUtilisateur(session, utilisateur.id, {
        isActive: !utilisateur.is_active,
      });
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
      const resultat = await api.comptes.supprimerUtilisateur(session, utilisateur.id);
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
      setConfirmationSuppression(false);
    }
  }

  return (
    <tr>
      <td>{utilisateur.username}</td>
      <td>
        {utilisateur.first_name} {utilisateur.last_name}
      </td>
      <td>{utilisateur.telephone || ""}</td>
      <td>
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
      <td>
        <select value={utilisateur.depot ?? ""} disabled={enCours} onChange={(e) => changerDepot(e.target.value)}>
          <option value=""></option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nom}
            </option>
          ))}
        </select>
      </td>
      <td>
        <button type="button" disabled={enCours} onClick={basculerActif}>
          {utilisateur.is_active ? "Actif" : "Inactif"}
        </button>
      </td>
      <td>{roleActuel?.nom ?? ""}</td>
      <td>{depotActuel?.nom ?? ""}</td>
      <td>
        {nouveauMotDePasse ? (
          <div className="mot-de-passe-genere mot-de-passe-genere-ligne">
            <strong>{nouveauMotDePasse}</strong>
            <button type="button" className="lien" onClick={() => setNouveauMotDePasse(null)}>
              OK, noté
            </button>
          </div>
        ) : (
          <button type="button" disabled={enCours} onClick={reinitialiserMotDePasse}>
            Réinitialiser
          </button>
        )}
      </td>
      <td>
        <button
          type="button"
          className="lien-icone"
          title="Retirer"
          disabled={enCours}
          onClick={() => setConfirmationSuppression(true)}
        >
          ×
        </button>
        {confirmationSuppression && (
          <ModaleConfirmation
            titre="Retirer cet utilisateur ?"
            labelConfirmer="Retirer"
            dangereux
            enCours={enCours}
            onAnnuler={() => setConfirmationSuppression(false)}
            onConfirmer={supprimer}
          />
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
    const resultatRoles = await api.comptes.listerRoles(session);
    if (resultatRoles.succes) setRoles(resultatRoles.resultat);
    else setErreur(resultatRoles.message);

    setDepots(await api.depots.lister(session.boutiqueId));

    const resultatUtilisateurs = await api.comptes.listerUtilisateurs(session);
    if (resultatUtilisateurs.succes) {
      // Le Patron connecté gère ses propres infos dans "Informations boutique",
      // pas dans cette liste des utilisateurs qu'il a créés.
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

  return (
    <>
      {afficherForm && (
        <div className="fond-modale" onClick={() => setAfficherForm(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireUtilisateur
              session={session}
              roles={roles}
              depots={depots}
              nomsUtilisateursExistants={
                new Set([session.username.toLowerCase(), ...utilisateurs.map((u) => u.username.toLowerCase())])
              }
              onAnnuler={() => setAfficherForm(false)}
              onCree={() => {
                setAfficherForm(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="disposition-parametres">
        <nav className="barre-laterale-parametres">
          {SOUS_ONGLETS_UTILISATEURS.map((o) => (
            <button
              key={o.cle}
              type="button"
              className={`item-nav-parametres ${sousOnglet === o.cle ? "actif" : ""}`}
              onClick={() => setSousOnglet(o.cle)}
            >
              {o.label}
            </button>
          ))}
        </nav>
        <div className="contenu-onglet contenu-parametres">
          {erreur && <div className="message-erreur">{erreur}</div>}
          {sousOnglet === "utilisateurs" && (
            <div className="barre-actions">
              <span className="actions-ligne">
                <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)}>
                  + Nouvel utilisateur
                </button>
              </span>
            </div>
          )}
          {sousOnglet === "roles" &&
            roles.map((r) => <CarteRole key={r.id} role={r} session={session} onModifie={rafraichir} />)}

          {sousOnglet === "utilisateurs" && (
          <>
            <div className="zone-tableau-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Nom</th>
                  <th>Téléphone</th>
                  <th>Changer de rôle</th>
                  <th>Dépôt</th>
                  <th>Statut</th>
                  <th>Rôle actuel</th>
                  <th>Dépôt actuel</th>
                  <th>Mot de passe</th>
                  <th>Retirer</th>
                </tr>
              </thead>
              <tbody>
                {utilisateurs.map((u) => (
                  <LigneUtilisateur
                    key={u.id}
                    utilisateur={u}
                    roles={roles}
                    depots={depots}
                    session={session}
                    onModifie={rafraichir}
                  />
                ))}
                {utilisateurs.length > 0 &&
                  Array.from({ length: Math.max(0, 10 - utilisateurs.length) }).map((_, i) => (
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
                      <td>&nbsp;</td>
                    </tr>
                  ))}
                {utilisateurs.length === 0 && (
                  <tr>
                    <td colSpan={10} className="liste-vide">
                      Aucun utilisateur.
                    </td>
                  </tr>
                )}
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

// --- Onglet Paramètres ---

function OngletParametres() {
  const [theme, setTheme] = useState<Theme>(() => themeActuel());

  function changerTheme(nouveauTheme: Theme) {
    appliquerTheme(nouveauTheme);
    setTheme(nouveauTheme);
  }

  return (
    <div className="reglage-catalogue">
      <div className="bloc-apparence">
        <h3>Thème</h3>
        <div className="groupe-theme">
          <button
            type="button"
            className={`bouton-theme ${theme === "clair" ? "actif" : ""}`}
            onClick={() => changerTheme("clair")}
          >
            ☀️ Clair
          </button>
          <button
            type="button"
            className={`bouton-theme ${theme === "sombre" ? "actif" : ""}`}
            onClick={() => changerTheme("sombre")}
          >
            🌙 Sombre
          </button>
          <button
            type="button"
            className={`bouton-theme ${theme === "nuit" ? "actif" : ""}`}
            onClick={() => changerTheme("nuit")}
          >
            🕯️ Nuit
          </button>
          <button
            type="button"
            className={`bouton-theme ${theme === "orange" ? "actif" : ""}`}
            onClick={() => changerTheme("orange")}
          >
            🟠 Orange
          </button>
          <button
            type="button"
            className={`bouton-theme ${theme === "vert" ? "actif" : ""}`}
            onClick={() => changerTheme("vert")}
          >
            🟢 Vert
          </button>
          <button
            type="button"
            className={`bouton-theme ${theme === "bleu" ? "actif" : ""}`}
            onClick={() => changerTheme("bleu")}
          >
            🔵 Bleu
          </button>
          <button
            type="button"
            className={`bouton-theme ${theme === "gris" ? "actif" : ""}`}
            onClick={() => changerTheme("gris")}
          >
            ⚪ Gris
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Onglet Unités ---

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

  async function rafraichir() {
    setUnites(await api.unites.lister(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    const resultat = await api.unites.creer(session.boutiqueId, nom.trim(), abreviation.trim());
    if (resultat.succes) {
      setNom("");
      setAbreviation("");
      setErreur(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  function commencerEdition(u: UniteResume) {
    setEnEditionId(u.id);
    setNomEdition(u.nom);
    setAbreviationEdition(u.abreviation);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    const resultat = await api.unites.modifier(id, { nom: nomEdition.trim(), abreviation: abreviationEdition.trim() });
    if (resultat.succes) {
      setEnEditionId(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  async function supprimer(id: string) {
    const resultat = await api.unites.supprimer(id);
    setConfirmationSuppressionId(null);
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  return (
    <div className="reglage-catalogue">
      {peutGerer && (
        <form onSubmit={ajouter} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Nouvelle unité" value={nom} onChange={(e) => setNom(e.target.value)} />
          <input
            placeholder="Abréviation"
            value={abreviation}
            onChange={(e) => setAbreviation(e.target.value)}
            style={{ width: "100px" }}
          />
          <button type="submit">Ajouter</button>
        </form>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      <ul className="liste-simple">
        {unites.map((u) =>
          enEditionId === u.id ? (
            <li key={u.id} className="ligne-liste-simple">
              <div className="formulaire-inline">
                <input value={nomEdition} onChange={(e) => setNomEdition(e.target.value)} />
                <input
                  value={abreviationEdition}
                  onChange={(e) => setAbreviationEdition(e.target.value)}
                  style={{ width: "100px" }}
                />
              </div>
              <div className="actions-ligne-simple">
                <button type="button" onClick={() => setEnEditionId(null)}>
                  Annuler
                </button>
                <button type="button" onClick={() => enregistrerEdition(u.id)}>
                  Enregistrer
                </button>
              </div>
            </li>
          ) : (
            <li key={u.id} className="ligne-liste-simple">
              <span>
                {u.nom} {u.abreviation && `(${u.abreviation})`}
              </span>
              {peutGerer && (
                <div className="actions-ligne-simple">
                  <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(u)}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="lien-icone lien-icone-danger"
                    title="Supprimer"
                    onClick={() => setConfirmationSuppressionId(u.id)}
                  >
                    ×
                  </button>
                </div>
              )}
            </li>
          ),
        )}
        {unites.length === 0 && <li className="liste-vide">Aucune unité.</li>}
      </ul>
      {confirmationSuppressionId && (
        <ModaleConfirmation
          titre="Supprimer cette unité ?"
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setConfirmationSuppressionId(null)}
          onConfirmer={() => supprimer(confirmationSuppressionId)}
        />
      )}
    </div>
  );
}

// --- Onglet Attributs ---

function OngletAttributs({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [attributs, setAttributs] = useState<ReferenceNommee[]>([]);
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enEditionId, setEnEditionId] = useState<string | null>(null);
  const [nomEdition, setNomEdition] = useState("");
  const [confirmationSuppressionId, setConfirmationSuppressionId] = useState<string | null>(null);

  async function rafraichir() {
    setAttributs(await api.attributs.lister(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    const resultat = await api.attributs.creer(session.boutiqueId, nom.trim());
    if (resultat.succes) {
      setNom("");
      setErreur(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  function commencerEdition(a: ReferenceNommee) {
    setEnEditionId(a.id);
    setNomEdition(a.nom);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    const resultat = await api.attributs.modifier(id, nomEdition.trim());
    if (resultat.succes) {
      setEnEditionId(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  async function supprimer(id: string) {
    const resultat = await api.attributs.supprimer(id);
    setConfirmationSuppressionId(null);
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  return (
    <div className="reglage-catalogue">
      {peutGerer && (
        <form onSubmit={ajouter} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Nouvel attribut (ex. Couleur)" value={nom} onChange={(e) => setNom(e.target.value)} />
          <button type="submit">Ajouter</button>
        </form>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      <p className="note-aide">
        Les valeurs de chaque attribut (ex. Rouge, Bleu pour Couleur) se créent directement lors de l'ajout d'une
        variante, dans la fiche de l'article.
      </p>
      <ul className="liste-simple">
        {attributs.map((a) =>
          enEditionId === a.id ? (
            <li key={a.id} className="ligne-liste-simple">
              <input value={nomEdition} onChange={(e) => setNomEdition(e.target.value)} />
              <div className="actions-ligne-simple">
                <button type="button" onClick={() => setEnEditionId(null)}>
                  Annuler
                </button>
                <button type="button" onClick={() => enregistrerEdition(a.id)}>
                  Enregistrer
                </button>
              </div>
            </li>
          ) : (
            <li key={a.id} className="ligne-liste-simple">
              <span>{a.nom}</span>
              {peutGerer && (
                <div className="actions-ligne-simple">
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
                </div>
              )}
            </li>
          ),
        )}
        {attributs.length === 0 && <li className="liste-vide">Aucun attribut.</li>}
      </ul>
      {confirmationSuppressionId && (
        <ModaleConfirmation
          titre="Supprimer cet attribut ?"
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setConfirmationSuppressionId(null)}
          onConfirmer={() => supprimer(confirmationSuppressionId)}
        />
      )}
    </div>
  );
}

// --- Onglet Dépôts ---

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

  async function rafraichir() {
    const tous = await api.depots.lister(session.boutiqueId);
    setDepots(peutGerer || !session.depotId ? tous : tous.filter((d) => d.id === session.depotId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    const resultat = await api.depots.creer(session.boutiqueId, nom.trim(), adresse.trim());
    if (resultat.succes) {
      setNom("");
      setAdresse("");
      setErreur(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  function commencerEdition(d: DepotResume) {
    setEnEditionId(d.id);
    setNomEdition(d.nom);
    setAdresseEdition(d.adresse);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    const resultat = await api.depots.modifier(id, { nom: nomEdition.trim(), adresse: adresseEdition.trim() });
    if (resultat.succes) {
      setEnEditionId(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  async function supprimer(id: string) {
    const resultat = await api.depots.supprimer(id);
    setConfirmationSuppressionId(null);
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
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
      <ul className="liste-simple">
        {depots.map((d) =>
          enEditionId === d.id ? (
            <li key={d.id} className="ligne-liste-simple">
              <div className="formulaire-inline">
                <input value={nomEdition} onChange={(e) => setNomEdition(e.target.value)} />
                <input value={adresseEdition} onChange={(e) => setAdresseEdition(e.target.value)} />
              </div>
              <div className="actions-ligne-simple">
                <button type="button" onClick={() => setEnEditionId(null)}>
                  Annuler
                </button>
                <button type="button" onClick={() => enregistrerEdition(d.id)}>
                  Enregistrer
                </button>
              </div>
            </li>
          ) : (
            <li key={d.id} className="ligne-liste-simple">
              <span>
                {d.nom} {d.adresse && `(${d.adresse})`}
              </span>
              {peutGerer && (
                <div className="actions-ligne-simple">
                  <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(d)}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="lien-icone lien-icone-danger"
                    title="Supprimer"
                    onClick={() => setConfirmationSuppressionId(d.id)}
                  >
                    ×
                  </button>
                </div>
              )}
            </li>
          ),
        )}
        {depots.length === 0 && <li className="liste-vide">Aucun dépôt.</li>}
      </ul>
      {confirmationSuppressionId && (
        <ModaleConfirmation
          titre="Supprimer ce dépôt ?"
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
    <div className="disposition-parametres">
      <nav className="barre-laterale-parametres">
        {SOUS_ONGLETS_PARAMETRES.map((o) => (
          <button
            key={o.cle}
            type="button"
            className={`item-nav-parametres ${sousOnglet === o.cle ? "actif" : ""}`}
            onClick={() => setSousOnglet(o.cle)}
          >
            {o.label}
          </button>
        ))}
      </nav>
      <div className="contenu-onglet contenu-parametres">
        {sousOnglet === "general" && <OngletParametres />}
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

function ModaleProfilBoutique({
  session, onSessionMiseAJour, onFermer,
}: { session: Session; onSessionMiseAJour: (session: Session) => void; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <OngletProfilBoutique session={session} onSessionMiseAJour={onSessionMiseAJour} onFermer={onFermer} />
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
    api.admin.abonnementEnAttente().then(setEnAttente);
  }, []);

  if (!enAttente) return null;

  async function confirmer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!enAttente) return;
    setErreur(null);
    setEnCours(true);
    try {
      const reponse = await api.admin.soumettreAbonnement(
        username,
        password,
        enAttente.boutiqueId,
        enAttente.boutiqueNom,
        enAttente.champs,
      );
      if (reponse.succes && reponse.resultat.statut === "synchronise") setEnAttente(null);
      else if (reponse.succes) setErreur("Toujours hors-ligne : réessayez plus tard.");
      else setErreur(reponse.message);
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
 * séparé de la création, jamais un préalable (voir electron/services/
 * inscriptionLocale.ts::activerEnLigne). Le mot de passe du Patron est
 * redemandé : jamais conservé en clair depuis la création.
 */
function BlocActivationBoutiqueLocale({
  session,
  onSessionMiseAJour,
}: {
  session: Session;
  onSessionMiseAJour: (session: Session) => void;
}) {
  const [enAttente, setEnAttente] = useState<BoutiqueLocaleEnAttente | null>(null);
  const [usernameAdmin, setUsernameAdmin] = useState("");
  const [passwordAdmin, setPasswordAdmin] = useState("");
  const [patronPassword, setPatronPassword] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api.admin.boutiqueLocaleEnAttente().then(setEnAttente);
  }, []);

  if (!enAttente) return null;

  async function activer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const reponse = await api.admin.activerEnLigne(usernameAdmin, passwordAdmin, patronPassword, session);
      if (reponse.succes) {
        onSessionMiseAJour(reponse.resultat);
        setEnAttente(null);
      } else {
        setErreur(reponse.message);
      }
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

function OngletSynchronisation({
  session,
  onSessionMiseAJour,
}: {
  session: Session;
  onSessionMiseAJour: (session: Session) => void;
}) {
  const { etat, enCours, erreur, synchroniser, verifierActivation } = useSynchro();

  if (!session.synchroAutorisee) {
    return (
      <div className="reglage-catalogue">
        <BlocActivationBoutiqueLocale session={session} onSessionMiseAJour={onSessionMiseAJour} />
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
    <div className="reglage-catalogue">
      <BlocAbonnementEnAttente />
      <div className="grille-champs">
        <div>
          <p className="note-aide">Statut</p>
          <p>
            <span className={`point ${etat?.enLigne ? "point-en-ligne" : "point-hors-ligne"}`} />{" "}
            {etat?.enLigne ? "En ligne" : "Hors-ligne"}
          </p>
        </div>
        <div>
          <p className="note-aide">Dernière synchro</p>
          <p>{formaterDateSynchro(etat?.derniereSynchro ?? null)}</p>
        </div>
      </div>
      {erreur && <p className="message-erreur">{erreur}</p>}
      <div className="actions-formulaire">
        <button type="button" className="bouton-primaire" onClick={synchroniser} disabled={enCours}>
          {enCours ? "Synchronisation…" : "Synchroniser"}
        </button>
      </div>
    </div>
  );
}

function ModaleSynchronisation({
  session,
  onSessionMiseAJour,
  onFermer,
}: {
  session: Session;
  onSessionMiseAJour: (session: Session) => void;
  onFermer: () => void;
}) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Synchronisation" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletSynchronisation session={session} onSessionMiseAJour={onSessionMiseAJour} />
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
        <div className="modale-corps">
          <OngletUtilisateursRoles session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleParametres({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Paramètres" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletParametresGeneraux session={session} />
        </div>
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

export default function Reglages({
  session,
  onSessionMiseAJour,
}: {
  session: Session;
  onSessionMiseAJour: (session: Session) => void;
}) {
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
        <ModaleProfilBoutique
          session={session}
          onSessionMiseAJour={onSessionMiseAJour}
          onFermer={() => setSectionOuverte(null)}
        />
      )}
      {sectionOuverte === "utilisateurs" && (
        <ModaleUtilisateursRoles session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "parametres" && (
        <ModaleParametres session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "synchronisation" && (
        <ModaleSynchronisation
          session={session}
          onSessionMiseAJour={onSessionMiseAJour}
          onFermer={() => setSectionOuverte(null)}
        />
      )}
    </div>
  );
}
