import { useEffect, useState } from "react";

import { api } from "../api";
import type { DepotResume, RoleResume, Session, UtilisateurResume } from "../api";

/**
 * Extrait de client-electron/src/pages/Reglages.tsx (CLES_PERMISSIONS, CarteRole,
 * FormulaireUtilisateur, LigneUtilisateur, OngletUtilisateursRoles) : cette partie
 * parlait déjà directement à Django côté Electron (comptes.Utilisateur/Role sont
 * hors synchro), donc la logique est portée telle quelle, seuls les appels api.*
 * perdent leur paramètre `session` (géré globalement par la couche de transport ici).
 */

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
  onModifie,
}: {
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
  const depotActuel = depots.find((d) => d.id === utilisateur.depot);

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

export default function UtilisateursRoles({ session }: { session: Session }) {
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

    const resultatDepots = await api.depots.lister();
    if (resultatDepots.succes) setDepots(resultatDepots.resultat);

    const resultatUtilisateurs = await api.comptes.listerUtilisateurs();
    if (resultatUtilisateurs.succes) {
      // Le Patron connecté gère ses propres infos ailleurs, pas dans cette liste
      // des utilisateurs qu'il a créés.
      setUtilisateurs(resultatUtilisateurs.resultat.filter((u) => u.id !== Number(session.utilisateurId)));
    } else setErreur(resultatUtilisateurs.message);
  }

  useEffect(() => {
    if (!peutGerer) return;
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peutGerer]);

  if (!peutGerer) {
    return (
      <div className="page-produits">
        <h2>Utilisateurs & rôles</h2>
        <p className="note-aide">Réservé au Patron.</p>
      </div>
    );
  }

  if (afficherForm) {
    return (
      <div className="page-produits">
        <h2>Utilisateurs & rôles</h2>
        <FormulaireUtilisateur
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
    );
  }

  return (
    <div className="page-produits">
      <div className="entete-page-onglets">
        <h2>Utilisateurs & rôles</h2>
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
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="contenu-onglet">
        {sousOnglet === "roles" && roles.map((r) => <CarteRole key={r.id} role={r} onModifie={rafraichir} />)}

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
                    <LigneUtilisateur key={u.id} utilisateur={u} roles={roles} depots={depots} onModifie={rafraichir} />
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
