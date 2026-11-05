import { type FormEvent, useEffect, useState } from "react";

import { api, ErreurApi } from "../api";
import { Erreur } from "../composants/Commun";
import { date, motDePasseProvisoire } from "../format";
import type { ResumeBoutique } from "../types";

const VIDE = {
  boutique_nom: "",
  boutique_adresse: "",
  boutique_telephone: "",
  boutique_email: "",
  boutique_devise: "FCFA",
  formule: "essentiel",
  synchro_autorisee: false,
  first_name: "",
  last_name: "",
  username: "",
  email: "",
  telephone: "",
  password: "",
  doit_changer_mot_de_passe: true,
};

type Champs = typeof VIDE;

export default function CreerBoutique() {
  const [champs, setChamps] = useState<Champs>(VIDE);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [creee, setCreee] = useState<{ boutique: ResumeBoutique; identifiant: string; motDePasse: string } | null>(null);

  // Disponibilité de l'identifiant, vérifiée pendant la saisie.
  useEffect(() => {
    const identifiant = champs.username.trim();
    setDisponible(null);
    if (!identifiant) return;
    const minuteur = setTimeout(async () => {
      try {
        const r = await api<{ disponible: boolean }>(
          `/admin/identifiant-disponible/?identifiant=${encodeURIComponent(identifiant)}`,
        );
        setDisponible(r.disponible);
      } catch {
        setDisponible(null);
      }
    }, 400);
    return () => clearTimeout(minuteur);
  }, [champs.username]);

  function maj<K extends keyof Champs>(cle: K, valeur: Champs[K]) {
    setChamps((c) => ({ ...c, [cle]: valeur }));
    setErreurs((e) => ({ ...e, [cle]: "" }));
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur("");
    setErreurs({});
    setEnCours(true);
    try {
      const boutique = await api<ResumeBoutique>("/admin/boutiques/creer/", {
        method: "POST",
        body: JSON.stringify(champs),
      });
      setCreee({ boutique, identifiant: champs.username.trim(), motDePasse: champs.password });
      setChamps(VIDE);
    } catch (err) {
      const champsEnErreur = err instanceof ErreurApi ? err.champs : {};
      setErreurs(champsEnErreur);
      setErreur(
        Object.keys(champsEnErreur).length > 0 ? "Corrigez les champs signalés en rouge." : (err as Error).message,
      );
    } finally {
      setEnCours(false);
    }
  }

  if (creee) {
    return (
      <section className="carte carte-succes">
        <h2>✅ Boutique « {creee.boutique.nom} » créée</h2>
        <p>Remettez ces identifiants au commerçant :</p>
        <dl className="infos identifiants-remis">
          <div className="info">
            <dt>Identifiant</dt>
            <dd>
              <code>{creee.identifiant}</code>
            </dd>
          </div>
          <div className="info">
            <dt>Mot de passe</dt>
            <dd>
              <code>{creee.motDePasse}</code>
            </dd>
          </div>
        </dl>
        <p className="aide">
          Essai gratuit jusqu'au {date(creee.boutique.date_expiration_abonnement)}. Ce mot de passe n'est plus
          affiché après avoir quitté cette page.
        </p>
        <div className="actions">
          <a className="bouton-secondaire-lien" href={`#/boutiques/${creee.boutique.id}`}>
            Ouvrir sa fiche
          </a>
          <button type="button" className="bouton-principal" onClick={() => setCreee(null)}>
            Créer une autre boutique
          </button>
        </div>
      </section>
    );
  }

  const champ = (cle: keyof Champs, libelle: string, options: { type?: string; requis?: boolean } = {}) => (
    <label>
      {libelle}
      {options.requis && <span className="requis"> *</span>}
      <input
        type={options.type ?? "text"}
        value={champs[cle] as string}
        onChange={(e) => maj(cle, e.target.value as never)}
        required={options.requis}
      />
      {erreurs[cle] && <small className="erreur-champ">{erreurs[cle]}</small>}
    </label>
  );

  return (
    <form className="pile formulaire" onSubmit={soumettre}>
      <p className="aide">
        Pour un commerçant rencontré sur le terrain : la boutique et son compte Patron sont créés tout de suite, avec
        l'essai gratuit. Pour une demande faite depuis l'appli, passez plutôt par « Inscriptions ».
      </p>

      <section className="carte">
        <h3>Boutique</h3>
        <div className="grille-champs">
          {champ("boutique_nom", "Nom de la boutique", { requis: true })}
          {champ("boutique_telephone", "Téléphone", { type: "tel" })}
          {champ("boutique_adresse", "Adresse")}
          {champ("boutique_email", "E-mail", { type: "email" })}
          {champ("boutique_devise", "Devise", { requis: true })}
          <label>
            Formule
            <select value={champs.formule} onChange={(e) => maj("formule", e.target.value)}>
              <option value="essentiel">Essentiel</option>
              <option value="pro">Pro</option>
            </select>
          </label>
        </div>
        <label className="interrupteur">
          <input
            type="checkbox"
            checked={champs.synchro_autorisee}
            onChange={(e) => maj("synchro_autorisee", e.target.checked)}
          />
          Activer la synchronisation en ligne dès maintenant
        </label>
      </section>

      <section className="carte">
        <h3>Compte Patron</h3>
        <div className="grille-champs">
          {champ("first_name", "Prénom")}
          {champ("last_name", "Nom")}
          <label>
            Identifiant de connexion<span className="requis"> *</span>
            <input
              value={champs.username}
              onChange={(e) => maj("username", e.target.value.replace(/\s/g, ""))}
              autoComplete="off"
              required
            />
            {disponible === true && <small className="ok-champ">✓ Identifiant libre</small>}
            {disponible === false && <small className="erreur-champ">Identifiant déjà pris</small>}
            {erreurs.username && <small className="erreur-champ">{erreurs.username}</small>}
          </label>
          {champ("telephone", "Téléphone", { type: "tel" })}
          {champ("email", "E-mail", { type: "email", requis: true })}
          <label>
            Mot de passe<span className="requis"> *</span>
            <span className="champ-avec-bouton">
              <input
                value={champs.password}
                onChange={(e) => maj("password", e.target.value)}
                autoComplete="new-password"
                required
              />
              <button type="button" className="bouton-secondaire" onClick={() => maj("password", motDePasseProvisoire())}>
                Générer
              </button>
            </span>
            {erreurs.password && <small className="erreur-champ">{erreurs.password}</small>}
          </label>
        </div>
        <label className="interrupteur">
          <input
            type="checkbox"
            checked={champs.doit_changer_mot_de_passe}
            onChange={(e) => maj("doit_changer_mot_de_passe", e.target.checked)}
          />
          Lui faire choisir son propre mot de passe à la première connexion
        </label>
      </section>

      {erreur && <Erreur message={erreur} />}
      <div className="actions">
        <button type="submit" className="bouton-principal" disabled={enCours || disponible === false}>
          {enCours ? "Création…" : "Créer la boutique"}
        </button>
      </div>
    </form>
  );
}
