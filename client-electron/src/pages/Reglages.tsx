import { useEffect, useState } from "react";

import { api } from "../api/client";
import { useRafraichirDevise } from "../contexts/DeviseContext";
import { useRafraichirLogoBoutique } from "../contexts/LogoContext";
import type {
  BoutiqueDetail,
  DepotResume,
  ParametreResume,
  ReferenceNommee,
  RoleResume,
  Session,
  UniteResume,
  UtilisateurResume,
} from "../api/client";

const CLES_PERMISSIONS: { cle: string; label: string }[] = [
  { cle: "vendre", label: "Vendre / encaisser" },
  { cle: "consulter_stock", label: "Consulter le stock" },
  { cle: "gerer_clients", label: "Gérer les clients" },
  { cle: "gerer_produits_stock_achats", label: "Gérer produits / stock / achats" },
  { cle: "voir_benefices_achat", label: "Voir les bénéfices et prix d'achat" },
  { cle: "modifier_prix", label: "Modifier les prix" },
  { cle: "annuler_vente", label: "Annuler une vente" },
  { cle: "voir_rapports_complets", label: "Voir les rapports complets" },
  { cle: "gerer_utilisateurs_reglages", label: "Gérer les utilisateurs et réglages" },
];

// --- Onglet Informations boutique ---

function OngletProfilBoutique({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_utilisateurs_reglages;
  const [boutique, setBoutique] = useState<BoutiqueDetail | null>(null);
  const [logo, setLogo] = useState("");
  const [moi, setMoi] = useState<UtilisateurResume | null>(null);
  const [emailCompte, setEmailCompte] = useState("");
  const [telephoneCompte, setTelephoneCompte] = useState("");
  const [modeEdition, setModeEdition] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const rafraichirDevise = useRafraichirDevise();
  const rafraichirLogo = useRafraichirLogoBoutique();

  async function charger() {
    const [b, l, resultatUtilisateurs] = await Promise.all([
      api.reglages.obtenirBoutique(session.boutiqueId),
      api.reglages.obtenirLogoBoutique(session.boutiqueId),
      api.comptes.listerUtilisateurs(session),
    ]);
    setBoutique(b ?? null);
    setLogo(l);
    if (resultatUtilisateurs.succes) {
      const moiTrouve = resultatUtilisateurs.resultat.find((u) => u.id === Number(session.utilisateurId)) ?? null;
      setMoi(moiTrouve);
      setEmailCompte(moiTrouve?.email ?? "");
      setTelephoneCompte(moiTrouve?.telephone ?? "");
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
      if (moi) {
        const resultatCompte = await api.comptes.modifierUtilisateur(session, moi.id, {
          email: emailCompte,
          telephone: telephoneCompte,
        });
        if (!resultatCompte.succes) {
          setErreur(resultatCompte.message);
          return;
        }
      }
      await api.reglages.definirLogoBoutique(session.boutiqueId, logo);
      setMessage("Informations enregistrées.");
      rafraichirDevise();
      rafraichirLogo();
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
              </div>
            </div>
          )}
        </div>
        {peutGerer && (
          <div className="actions-formulaire">
            <button type="button" onClick={() => setModeEdition(true)}>
              Modifier
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enregistrer} className="formulaire-catalogue formulaire-profil-boutique">
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
            </div>
          </div>
        )}
      </div>
      <div className="actions-formulaire">
        <button type="button" onClick={annuler}>
          Annuler
        </button>
        <button type="submit" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
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
        <h4>Utilisateur créé</h4>
        <p className="note-aide">
          Note ce mot de passe maintenant et transmets-le à {utilisateurCree.username} : il ne sera plus affiché
          ensuite.
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
          <button
            type="button"
            className="lien-icone"
            title="Retirer"
            disabled={enCours}
            onClick={() => setConfirmationSuppression(true)}
          >
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

  if (afficherForm) {
    return (
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
    );
  }

  return (
    <div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="barre-onglets">
        {SOUS_ONGLETS_UTILISATEURS.map((o) => (
          <button
            key={o.cle}
            className={`onglet ${sousOnglet === o.cle ? "actif" : ""}`}
            onClick={() => setSousOnglet(o.cle)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="contenu-onglet">
        {sousOnglet === "roles" &&
          roles.map((r) => <CarteRole key={r.id} role={r} session={session} onModifie={rafraichir} />)}

        {sousOnglet === "utilisateurs" && (
          <>
            <div className="barre-actions">
              <button type="button" onClick={() => setAfficherForm(true)}>
                + Nouvel utilisateur
              </button>
            </div>
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
  );
}

// --- Onglet Paramètres ---

function OngletParametres({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_utilisateurs_reglages;
  const [parametres, setParametres] = useState<ParametreResume[]>([]);
  const [cle, setCle] = useState("");
  const [valeur, setValeur] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmationSuppressionId, setConfirmationSuppressionId] = useState<string | null>(null);

  async function rafraichir() {
    setParametres(await api.reglages.listerParametres(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!cle.trim()) return;
    const resultat = await api.reglages.definirParametre(session.boutiqueId, cle.trim(), valeur);
    if (resultat.succes) {
      setCle("");
      setValeur("");
      setErreur(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  async function supprimer(id: string) {
    const resultat = await api.reglages.supprimerParametre(id);
    setConfirmationSuppressionId(null);
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  return (
    <div className="reglage-catalogue">
      {peutGerer && (
        <form onSubmit={enregistrer} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Clé" value={cle} onChange={(e) => setCle(e.target.value)} />
          <input placeholder="Valeur" value={valeur} onChange={(e) => setValeur(e.target.value)} />
          <button type="submit">Enregistrer</button>
        </form>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      <ul className="liste-simple">
        {parametres.map((p) => (
          <li key={p.id} className="ligne-liste-simple">
            <span
              onClick={() => {
                if (!peutGerer) return;
                setCle(p.cle);
                setValeur(p.valeur);
              }}
            >
              <strong>{p.cle}</strong> = {p.valeur}
            </span>
            {peutGerer &&
              (confirmationSuppressionId === p.id ? (
                <div className="confirmation-retrait">
                  <span>Supprimer ?</span>
                  <button type="button" onClick={() => setConfirmationSuppressionId(null)}>
                    Non
                  </button>
                  <button type="button" onClick={() => supprimer(p.id)}>
                    Oui
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="lien-icone"
                  title="Supprimer"
                  onClick={() => setConfirmationSuppressionId(p.id)}
                >
                  ×
                </button>
              ))}
          </li>
        ))}
        {parametres.length === 0 && <li className="liste-vide">Aucun paramètre.</li>}
      </ul>
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
              {peutGerer &&
                (confirmationSuppressionId === u.id ? (
                  <div className="confirmation-retrait">
                    <span>Supprimer ?</span>
                    <button type="button" onClick={() => setConfirmationSuppressionId(null)}>
                      Non
                    </button>
                    <button type="button" onClick={() => supprimer(u.id)}>
                      Oui
                    </button>
                  </div>
                ) : (
                  <div className="actions-ligne-simple">
                    <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(u)}>
                      ✎
                    </button>
                    <button
                      type="button"
                      className="lien-icone"
                      title="Supprimer"
                      onClick={() => setConfirmationSuppressionId(u.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </li>
          ),
        )}
        {unites.length === 0 && <li className="liste-vide">Aucune unité.</li>}
      </ul>
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
        variante, dans la fiche du produit.
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
              {peutGerer &&
                (confirmationSuppressionId === a.id ? (
                  <div className="confirmation-retrait">
                    <span>Supprimer ?</span>
                    <button type="button" onClick={() => setConfirmationSuppressionId(null)}>
                      Non
                    </button>
                    <button type="button" onClick={() => supprimer(a.id)}>
                      Oui
                    </button>
                  </div>
                ) : (
                  <div className="actions-ligne-simple">
                    <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(a)}>
                      ✎
                    </button>
                    <button
                      type="button"
                      className="lien-icone"
                      title="Supprimer"
                      onClick={() => setConfirmationSuppressionId(a.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </li>
          ),
        )}
        {attributs.length === 0 && <li className="liste-vide">Aucun attribut.</li>}
      </ul>
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
              {peutGerer &&
                (confirmationSuppressionId === d.id ? (
                  <div className="confirmation-retrait">
                    <span>Supprimer ?</span>
                    <button type="button" onClick={() => setConfirmationSuppressionId(null)}>
                      Non
                    </button>
                    <button type="button" onClick={() => supprimer(d.id)}>
                      Oui
                    </button>
                  </div>
                ) : (
                  <div className="actions-ligne-simple">
                    <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(d)}>
                      ✎
                    </button>
                    <button
                      type="button"
                      className="lien-icone"
                      title="Supprimer"
                      onClick={() => setConfirmationSuppressionId(d.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </li>
          ),
        )}
        {depots.length === 0 && <li className="liste-vide">Aucun dépôt.</li>}
      </ul>
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
    <div>
      <div className="barre-onglets">
        {SOUS_ONGLETS_PARAMETRES.map((o) => (
          <button
            key={o.cle}
            className={`onglet ${sousOnglet === o.cle ? "actif" : ""}`}
            onClick={() => setSousOnglet(o.cle)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="contenu-onglet">
        {sousOnglet === "general" && <OngletParametres session={session} />}
        {sousOnglet === "unites" && <OngletUnites session={session} />}
        {sousOnglet === "attributs" && <OngletAttributs session={session} />}
        {sousOnglet === "depots" && <OngletDepots session={session} />}
      </div>
    </div>
  );
}

// --- Page principale ---

const ONGLETS = [
  { cle: "profil", label: "Informations boutique" },
  { cle: "utilisateurs", label: "Utilisateurs & rôles" },
  { cle: "parametres", label: "Paramètres" },
] as const;

type Onglet = (typeof ONGLETS)[number]["cle"];

export default function Reglages({ session }: { session: Session }) {
  const [onglet, setOnglet] = useState<Onglet>("profil");

  return (
    <div className="page-produits">
      <div className="entete-page-onglets">
        <h2>Informations boutique</h2>
        <div className="barre-onglets">
          {ONGLETS.map((o) => (
            <button key={o.cle} className={`onglet ${onglet === o.cle ? "actif" : ""}`} onClick={() => setOnglet(o.cle)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="contenu-onglet">
        {onglet === "profil" && <OngletProfilBoutique session={session} />}
        {onglet === "utilisateurs" && <OngletUtilisateursRoles session={session} />}
        {onglet === "parametres" && <OngletParametresGeneraux session={session} />}
      </div>
    </div>
  );
}
