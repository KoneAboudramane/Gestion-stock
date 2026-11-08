import { useEffect, useState } from "react";

import { api, ErreurApi } from "../api";
import OngletsRubriques from "../composants/OngletsRubriques";
import CarteOption from "../composants/CarteOption";
import { Erreur } from "../composants/Commun";
import FicheAcces from "../composants/FicheAcces";
import { date, motDePasseProvisoire } from "../format";
import type { ResumeBoutique } from "../types";

/**
 * Créer une boutique depuis le site, au même design que l'assistant de l'Espace
 * Admin du bureau : étapes dans la barre de gauche (Boutique, Patron, Options,
 * Récapitulatif), essai gratuit de 7/15/30 jours dans la formule choisie,
 * interrupteurs envoi en ligne / réseau / appli mobile, puis fiche d'accès.
 * Pour une demande faite depuis l'appli, passer plutôt par « Inscriptions ».
 */

type Etape = 1 | 2 | 3 | 4;

const ETAPES: { numero: Etape; libelle: string; icone: string }[] = [
  { numero: 1, libelle: "Boutique", icone: "🏪" },
  { numero: 2, libelle: "Patron", icone: "👤" },
  { numero: 3, libelle: "Options", icone: "⚙️" },
  { numero: 4, libelle: "Récapitulatif", icone: "✅" },
];
const DUREES_ESSAI = [7, 15, 30];
const LIBELLES_FORMULE: Record<string, string> = { essentiel: "Essentiel", pro: "Pro" };

const VIDE = {
  boutique_nom: "",
  boutique_adresse: "",
  boutique_telephone: "",
  boutique_email: "",
  boutique_devise: "FCFA",
  formule: "essentiel",
  essai_jours: 15,
  synchro_autorisee: false,
  reseau_autorise: false,
  appli_mobile_autorisee: false,
  first_name: "",
  last_name: "",
  username: "",
  email: "",
  telephone: "",
  password: "",
  doit_changer_mot_de_passe: true,
};

type Champs = typeof VIDE;

const emailValide = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

function finDans(jours: number): string {
  const fin = new Date();
  fin.setDate(fin.getDate() + jours);
  return fin.toISOString();
}

export default function CreerBoutique() {
  const [champs, setChamps] = useState<Champs>(VIDE);
  const [etape, setEtape] = useState<Etape>(1);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [creee, setCreee] = useState<{ boutique: ResumeBoutique; champs: Champs } | null>(null);

  // Disponibilité de l'identifiant, vérifiée pendant la saisie.
  useEffect(() => {
    const identifiant = champs.username.trim();
    setDisponible(null);
    if (!identifiant) return;
    const minuteur = setTimeout(async () => {
      try {
        const r = await api<{ disponible: boolean }>(`/admin/identifiant-disponible/?identifiant=${encodeURIComponent(identifiant)}`);
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

  function verifierEtape(n: Etape): string | null {
    if (n === 1 && !champs.boutique_nom.trim()) return "Indiquez le nom de la boutique.";
    if (n === 2) {
      if (!champs.username.trim()) return "Choisissez l'identifiant du patron.";
      if (disponible === false) return "Cet identifiant est déjà pris : choisissez-en un autre.";
      if (!emailValide(champs.email)) return "Adresse e-mail du patron invalide.";
      if (champs.password.length < 8) return "Mot de passe : 8 caractères au moins (ou « 🎲 Générer »).";
    }
    return null;
  }

  function aller(n: Etape) {
    setErreur("");
    for (let i = 1; i < n; i++) {
      const probleme = verifierEtape(i as Etape);
      if (probleme) {
        setEtape(i as Etape);
        return setErreur(probleme);
      }
    }
    setEtape(n);
  }

  async function creer() {
    for (const n of [1, 2] as Etape[]) {
      const probleme = verifierEtape(n);
      if (probleme) {
        setEtape(n);
        return setErreur(probleme);
      }
    }
    setErreur("");
    setErreurs({});
    setEnCours(true);
    try {
      const boutique = await api<ResumeBoutique>("/admin/boutiques/creer/", { method: "POST", body: JSON.stringify(champs) });
      setCreee({ boutique, champs });
      setChamps(VIDE);
      setEtape(1);
    } catch (err) {
      const champsEnErreur = err instanceof ErreurApi ? err.champs : {};
      setErreurs(champsEnErreur);
      const patron = ["username", "password", "email", "telephone", "first_name", "last_name"];
      if (Object.keys(champsEnErreur).some((c) => patron.includes(c))) setEtape(2);
      else if (Object.keys(champsEnErreur).some((c) => c.startsWith("boutique_"))) setEtape(1);
      setErreur(Object.keys(champsEnErreur).length > 0 ? "Corrigez les champs signalés en rouge." : (err as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  if (creee) {
    const c = creee.champs;
    const texte = `Votre boutique « ${creee.boutique.nom} » est prête sur Gestion Stock.\nIdentifiant : ${c.username.trim()}\nMot de passe${c.doit_changer_mot_de_passe ? " provisoire" : ""} : ${c.password}${c.doit_changer_mot_de_passe ? "\nVous choisirez votre propre mot de passe à la première connexion." : ""}\nAbonnement : essai gratuit ${LIBELLES_FORMULE[c.formule]} jusqu'au ${date(creee.boutique.date_expiration_abonnement)}`;
    return (
      <div className="ecran-admin-commun pile">
        <div className="carte-etat-serveur carte-etat-serveur--marche">
          <div className="entete-vue-ensemble">
            <span className="icone-vue-ensemble">🎉</span>
            <div>
              <strong className="etat-serveur-titre">« {creee.boutique.nom} » est prête</strong>
              <span className="sous-info ligne-detail-article">
                Le patron peut se connecter dès maintenant. Ce mot de passe n'est plus affiché après avoir quitté cette page.
              </span>
            </div>
          </div>
        </div>
        <FicheAcces
          titre={`Fiche de démarrage — ${creee.boutique.nom}`}
          details={[
            { libelle: "Patron", valeur: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username },
            { libelle: "Abonnement", valeur: `Essai ${LIBELLES_FORMULE[c.formule]} jusqu'au ${date(creee.boutique.date_expiration_abonnement)}` },
            { libelle: "Données en ligne", valeur: c.synchro_autorisee ? "oui" : "non (100 % local)" },
            { libelle: "Réseau · Appli mobile", valeur: `${c.reseau_autorise ? "activé" : "non"} · ${c.appli_mobile_autorisee ? "activée" : "non"}` },
          ]}
          identifiant={c.username.trim()}
          motDePasse={c.password}
          provisoire={c.doit_changer_mot_de_passe}
          texteAPartager={texte}
          telephone={c.telephone}
          onWhatsapp={(t, tel) => window.open(`https://wa.me/${tel.replace(/\D/g, "")}?text=${encodeURIComponent(t)}`, "_blank", "noopener")}
          onImprimer={() => {
            document.body.classList.add("impression-fiche");
            window.print();
            document.body.classList.remove("impression-fiche");
          }}
          actionPrincipale={
            <>
              <a className="bouton-secondaire-lien" href={`#/boutiques/${creee.boutique.id}`}>
                Ouvrir sa fiche
              </a>
              <button type="button" onClick={() => setCreee(null)}>
                🚀 Créer une autre boutique
              </button>
            </>
          }
        />
      </div>
    );
  }

  const champ = (cle: keyof Champs, libelle: string, options: { type?: string; requis?: boolean; indice?: string } = {}) => (
    <label>
      {libelle}
      {options.requis && <span className="requis"> *</span>}
      <input
        type={options.type ?? "text"}
        value={champs[cle] as string}
        placeholder={options.indice}
        onChange={(e) => maj(cle, e.target.value as never)}
      />
      {erreurs[cle] && <small className="erreur-champ">{erreurs[cle]}</small>}
    </label>
  );

  return (
    <div className="ecran-admin-commun page-onglets">
      <OngletsRubriques
        etiquette="Nouvelle boutique"
        etat={champs.boutique_nom.trim() || "sans nom"}
        details={[
          champs.username.trim() ? `👤 ${champs.username.trim()}` : null,
          `🎁 essai ${LIBELLES_FORMULE[champs.formule]} ${champs.essai_jours} j`,
        ]}
        rubriques={ETAPES.map((e) => ({
          cle: String(e.numero),
          label: (
            <>
              <span className={`numero-etape-nav${e.numero < etape ? " fait" : ""}`}>{e.numero < etape ? "✓" : e.numero}</span>
              {e.icone} {e.libelle}
            </>
          ),
        }))}
        active={String(etape)}
        onChoisir={(cle) => aller(Number(cle) as Etape)}
      />
      <div className="contenu-onglet contenu-reseau">
        {erreur && <Erreur message={erreur} />}

        {etape === 1 && (
          <>
            <h4 className="titre-rubrique-reseau">🏪 La boutique</h4>
            <p className="note-aide">
              Pour un commerçant rencontré sur le terrain. Pour une demande faite depuis l'appli, passez plutôt par «
              Inscriptions ».
            </p>
            <div className="grille-champs">
              {champ("boutique_nom", "Nom de la boutique", { requis: true, indice: "ex. Boutique Awa" })}
              {champ("boutique_telephone", "Téléphone", { type: "tel", indice: "ex. 07 00 00 00 00" })}
              {champ("boutique_adresse", "Adresse", { indice: "ex. Marché d'Adjamé, Abidjan" })}
              {champ("boutique_email", "E-mail", { type: "email" })}
              {champ("boutique_devise", "Devise")}
            </div>
          </>
        )}

        {etape === 2 && (
          <>
            <h4 className="titre-rubrique-reseau">👤 Le patron</h4>
            <div className="grille-champs">
              {champ("first_name", "Prénom")}
              {champ("last_name", "Nom")}
              <label>
                Identifiant de connexion<span className="requis"> *</span>
                <input
                  value={champs.username}
                  onChange={(e) => maj("username", e.target.value.replace(/\s/g, ""))}
                  autoComplete="off"
                  placeholder="ex. awa.kone"
                />
                {disponible === true && <small className="ok-champ">✓ Identifiant libre</small>}
                {disponible === false && <small className="erreur-champ">Identifiant déjà pris</small>}
                {erreurs.username && <small className="erreur-champ">{erreurs.username}</small>}
              </label>
              {champ("email", "E-mail", { type: "email", requis: true })}
              {champ("telephone", "Téléphone (WhatsApp)", { type: "tel" })}
              <label>
                Mot de passe<span className="requis"> *</span>
                <span className="champ-avec-bouton">
                  <input value={champs.password} onChange={(e) => maj("password", e.target.value)} autoComplete="new-password" />
                  <button type="button" onClick={() => maj("password", motDePasseProvisoire())}>
                    🎲 Générer
                  </button>
                </span>
                {erreurs.password && <small className="erreur-champ">{erreurs.password}</small>}
              </label>
            </div>
            <label className="carte-option-boutique">
              <input
                type="checkbox"
                checked={champs.doit_changer_mot_de_passe}
                onChange={(e) => maj("doit_changer_mot_de_passe", e.target.checked)}
              />
              <span>
                <strong>Mot de passe provisoire</strong>
                <span className="note-aide">Le patron choisira son propre mot de passe à sa première connexion.</span>
              </span>
            </label>
          </>
        )}

        {etape === 3 && (
          <>
            <h4 className="titre-rubrique-reseau">⚙️ Les options</h4>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">1</span>
              <div className="champ-etape-reseau">
                <strong>Formule de l'essai gratuit</strong>
                <div className="choix-formule-abonnement">
                  {(["essentiel", "pro"] as const).map((cle) => (
                    <button
                      key={cle}
                      type="button"
                      className={`puce-nom-poste${champs.formule === cle ? " choisi" : ""}`}
                      onClick={() => maj("formule", cle)}
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
                <strong>Durée de l'essai</strong>
                <div className="grille-durees-abonnement">
                  {DUREES_ESSAI.map((jours) => (
                    <button
                      key={jours}
                      type="button"
                      className={`carte-duree-abonnement${champs.essai_jours === jours ? " choisi" : ""}`}
                      onClick={() => maj("essai_jours", jours)}
                    >
                      <strong>{jours} jours</strong>
                      <span className="sous-info">jusqu'au {date(finDans(jours))}</span>
                    </button>
                  ))}
                </div>
                <span className="note-aide">Ensuite, renouvelez depuis la fiche de la boutique (💳 Abonnement).</span>
              </div>
            </div>
            <strong>Accès de la boutique</strong>
            <p className="note-aide">
              Accès accordés sans paiement. Pour les vendre comme options payantes : après la création, fiche de la boutique →
              « 🧩 Options ». En Pro (essai compris), le réseau et l'appli mobile sont compris.
            </p>
            <div className="grille-options-admin">
              <CarteOption
                icone="🌐"
                titre="Envoi des données en ligne"
                actif={champs.synchro_autorisee}
                libelleOui="Autorisé"
                libelleNon="100 % local"
                detail={champs.synchro_autorisee ? "Ventes et stock envoyés au serveur." : "100 % local : pensez à la sauvegarde."}
                onBasculer={(v) => maj("synchro_autorisee", v)}
              />
              <CarteOption
                icone="📶"
                titre="Réseau de la boutique"
                actif={champs.reseau_autorise}
                libelleOui="Activé"
                libelleNon="Non activé"
                detail={champs.reseau_autorise ? "Appareils reliés sans internet." : "Chaque appareil travaille seul."}
                onBasculer={(v) => maj("reseau_autorise", v)}
              />
              <CarteOption
                icone="📱"
                titre="Appli mobile"
                actif={champs.appli_mobile_autorisee}
                libelleOui="Activée"
                libelleNon="Non activée"
                detail={champs.appli_mobile_autorisee ? "Carte de téléchargement dans Réglages." : "Carte de téléchargement cachée."}
                onBasculer={(v) => maj("appli_mobile_autorisee", v)}
              />
            </div>
          </>
        )}

        {etape === 4 && (
          <>
            <h4 className="titre-rubrique-reseau">✅ Récapitulatif</h4>
            <div className="grille-cartes-reseau">
              <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller(1)}>
                <span className="titre-carte-reseau">🏪 Boutique ›</span>
                <strong>{champs.boutique_nom.trim()}</strong>
                <span className="sous-info">
                  {[champs.boutique_telephone, champs.boutique_adresse, champs.boutique_devise].filter((v) => v.trim()).join(" · ")}
                </span>
              </button>
              <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller(2)}>
                <span className="titre-carte-reseau">👤 Patron ›</span>
                <strong>{champs.username.trim()}</strong>
                <span className="sous-info">
                  {[[champs.first_name, champs.last_name].filter(Boolean).join(" "), champs.email, champs.telephone].filter(Boolean).join(" · ")}
                </span>
                <span className="sous-info">
                  {champs.doit_changer_mot_de_passe ? "choisira son mot de passe à la 1re connexion" : "garde ce mot de passe"}
                </span>
              </button>
              <button type="button" className="carte-info-reseau carte-info-reseau--lien" onClick={() => aller(3)}>
                <span className="titre-carte-reseau">⚙️ Options ›</span>
                <strong>
                  Essai {LIBELLES_FORMULE[champs.formule]} de {champs.essai_jours} jours
                </strong>
                <span className="sous-info">
                  {champs.synchro_autorisee ? "🌐 en ligne" : "🔒 100 % local"} · {champs.reseau_autorise ? "📶 réseau" : "pas de réseau"} ·{" "}
                  {champs.appli_mobile_autorisee ? "📱 appli mobile" : "pas d'appli mobile"}
                </span>
              </button>
            </div>
          </>
        )}

        <div className="actions-assistant">
          {etape > 1 ? (
            <button type="button" onClick={() => aller((etape - 1) as Etape)}>
              ← Précédent
            </button>
          ) : (
            <span />
          )}
          {etape < 4 ? (
            <button type="button" className="bouton-primaire" onClick={() => aller((etape + 1) as Etape)}>
              Suivant →
            </button>
          ) : (
            <button type="button" className="bouton-primaire" disabled={enCours || disponible === false} onClick={creer}>
              {enCours ? "Création…" : "🚀 Créer la boutique"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
