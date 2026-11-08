import { useEffect, useState, type ReactNode } from "react";

import { lireReinitialisationsARefaire } from "../api/auth";
import { obtenirEtatAbonnement, type EtatAbonnement } from "../services/abonnement";
import {
  detailAbonnementAdmin,
  etatReseauAdmin,
  lireAbonnementEnAttente,
  obtenirBoutiqueInstallee,
  type AbonnementBoutique,
} from "../services/abonnementAdmin";
import { lireBoutiqueLocaleEnAttente } from "../services/inscriptionLocale";
import { estAppliMobile } from "../lib/appliAndroid";
import { etatReseauComplet, type EtatReseau } from "../services/reseau";
import { etatSauvegarde, type EtatSauvegarde } from "../services/sauvegarde";

export type CarteAdmin =
  | "inscription"
  | "reinitialiserMotDePasse"
  | "abonnement"
  | "options"
  | "sauvegarde"
  | "reseau"
  | "laissezPasser";

interface EtatPoste {
  boutique: AbonnementBoutique | null;
  abonnement: EtatAbonnement | null;
  /** null : pas de réponse du serveur (pas d'internet ou serveur arrêté). */
  paiementsEnAttente: number | null;
  demandeReseau: boolean | null;
  modificationEnAttente: boolean;
  aRefaire: string[];
  activationEnAttente: boolean;
  /** Appli mobile seulement (null dans un navigateur). */
  sauvegarde: EtatSauvegarde | null;
  reseau: EtatReseau | null;
}

type Ton = "ok" | "attention" | "alerte" | "neutre";

function dateCourte(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

/**
 * Port de client-electron/src/components/AccueilAdmin.tsx. Sauvegarde et rôle de l'appareil dans
 * le réseau : dans l'appli mobile (docs/plan_mobile_complet.md, lots 2 à 4) ; grisés dans un navigateur.
 * Accueil de l'Espace Admin (après le verrou admin, voir AccesCreationBoutique.tsx) :
 * tableau de bord plein écran — l'état de cet ordinateur en un coup d'œil, la
 * liste « À faire », et les cartes groupées (Boutique de cet ordinateur,
 * Comptes, Nouvelle boutique) qui ouvrent chacune sa modale. Rechargé à chaque
 * retour d'une modale (`actualisation`).
 */
export default function AccueilAdmin({
  username,
  password,
  actualisation,
  ouvrir,
  onDeconnexion,
}: {
  username: string;
  password: string;
  actualisation: number;
  ouvrir: (carte: CarteAdmin) => void;
  onDeconnexion: () => void;
}) {
  const [etat, setEtat] = useState<EtatPoste | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      const boutique = await obtenirBoutiqueInstallee();
      const abonnement = boutique ? await obtenirEtatAbonnement(boutique.boutiqueId).catch(() => null) : null;
      const enAttente = lireAbonnementEnAttente();
      const aRefaire = lireReinitialisationsARefaire();
      const activation = lireBoutiqueLocaleEnAttente();
      const [sauvegarde, reseau] = estAppliMobile
        ? await Promise.all([etatSauvegarde().catch(() => null), etatReseauComplet().catch(() => null)])
        : [null, null];
      let paiementsEnAttente: number | null = null;
      let demandeReseau: boolean | null = null;
      if (boutique && !activation) {
        const [detail, reseauAdmin] = await Promise.all([
          detailAbonnementAdmin(username, password, boutique.boutiqueId),
          etatReseauAdmin(username, password, boutique.boutiqueId).catch(() => null),
        ]);
        if (detail.succes) paiementsEnAttente = detail.resultat.paiements_en_attente;
        if (reseauAdmin) demandeReseau = reseauAdmin.demandes.some((d) => d.statut === "en_attente");
      }
      if (!annule) {
        setEtat({
          boutique,
          abonnement,
          paiementsEnAttente,
          demandeReseau,
          modificationEnAttente: !!enAttente,
          aRefaire,
          activationEnAttente: !!activation,
          sauvegarde,
          reseau,
        });
      }
    })();
    return () => {
      annule = true;
    };
  }, [actualisation, username, password]);

  const boutique = etat?.boutique ?? null;
  const enLigne = etat ? etat.paiementsEnAttente !== null || etat.demandeReseau !== null : null;

  // --- Bandeau d'état ---
  const niveau = etat?.abonnement?.niveau;
  const pastilles: { cle: string; texte: string; ton: Ton; carte?: CarteAdmin }[] = etat
    ? boutique
      ? [
          {
            cle: "abonnement",
            carte: "abonnement",
            ton: !boutique.dateExpirationAbonnement ? "ok" : niveau === "bloque" || niveau === "grace" ? "alerte" : niveau === "bientot" ? "attention" : "ok",
            texte: !boutique.dateExpirationAbonnement
              ? "♾️ sans limite"
              : niveau === "bloque"
                ? "🔴 vente bloquée"
                : niveau === "grace"
                  ? "🟠 délai de grâce"
                  : `✅ actif ${etat.abonnement?.joursRestants ?? "?"} j`,
          },
          { cle: "synchro", carte: "options", ton: "neutre", texte: boutique.synchroAutorisee ? "🌐 en ligne" : "🔒 100 % local" },
          {
            cle: "reseau",
            carte: "reseau",
            ton: "neutre",
            texte: !boutique.reseauAutorise
              ? "📶 réseau non activé"
              : etat.reseau?.role === "principal"
                ? `🖥️ poste principal · ${etat.reseau.appareils.length} caisse(s)`
                : etat.reseau?.role === "caisse"
                  ? "📶 caisse branchée"
                  : "📶 réseau activé",
          },
          ...(estAppliMobile
            ? [
                {
                  cle: "sauvegarde",
                  carte: "sauvegarde" as CarteAdmin,
                  ton: (!etat.sauvegarde?.configuree
                    ? boutique.synchroAutorisee
                      ? "neutre"
                      : "attention"
                    : etat.sauvegarde.alerte === "aucune"
                      ? "ok"
                      : "alerte") as Ton,
                  texte: !etat.sauvegarde?.configuree
                    ? "💾 pas de sauvegarde"
                    : `💾 ${etat.sauvegarde.alerte === "aucune" ? "à jour" : "en retard"} (${dateCourte(etat.sauvegarde.derniereSauvegarde)})`,
                },
              ]
            : []),
          {
            cle: "internet",
            ton: enLigne ? "ok" : "attention",
            texte: etat.activationEnAttente ? "⏳ pas encore en ligne" : enLigne ? "🛰️ serveur joint" : "🛰️ serveur injoignable",
          },
        ]
      : [{ cle: "aucune", ton: "neutre", texte: "Aucune boutique sur cet ordinateur" }]
    : [];

  // --- À faire ---
  const aFaire: { cle: string; ton: Ton; texte: ReactNode; action?: { libelle: string; carte: CarteAdmin } }[] = [];
  if (etat) {
    if (!boutique) {
      aFaire.push({ cle: "creer", ton: "neutre", texte: "Cet ordinateur n'a pas encore de boutique.", action: { libelle: "🚀 Créer", carte: "inscription" } });
    } else {
      if (etat.paiementsEnAttente) {
        aFaire.push({
          cle: "paiements",
          ton: "attention",
          texte: `${etat.paiementsEnAttente} paiement(s) Mobile Money déclaré(s) à vérifier.`,
          action: { libelle: "Vérifier", carte: "abonnement" },
        });
      }
      if (etat.demandeReseau) {
        aFaire.push({ cle: "reseau", ton: "attention", texte: "La boutique demande l'activation du réseau.", action: { libelle: "Traiter", carte: "reseau" } });
      }
      if (boutique.dateExpirationAbonnement && (niveau === "bloque" || niveau === "grace" || niveau === "bientot")) {
        aFaire.push({
          cle: "abonnement",
          ton: niveau === "bientot" ? "attention" : "alerte",
          texte:
            niveau === "bloque"
              ? "Abonnement terminé : la vente est bloquée."
              : niveau === "grace"
                ? `Abonnement terminé : vente permise jusqu'au ${dateCourte(etat.abonnement?.finGrace)}.`
                : `Abonnement : plus que ${etat.abonnement?.joursRestants ?? "?"} jour(s).`,
          action: { libelle: "Renouveler", carte: "abonnement" },
        });
      }
      if (etat.activationEnAttente) {
        aFaire.push({
          cle: "activation",
          ton: "neutre",
          texte: "Boutique créée sans internet : à « Activer en ligne » (Réglages → Synchronisation, une fois connecté).",
        });
      }
      if (etat.modificationEnAttente) {
        aFaire.push({ cle: "envoi", ton: "neutre", texte: "Une modification d'abonnement attend d'être envoyée au serveur (Réglages → Synchronisation)." });
      }
      if (estAppliMobile && !etat.sauvegarde?.configuree && !boutique.synchroAutorisee) {
        aFaire.push({
          cle: "sauvegarde",
          ton: "attention",
          texte: "Aucune sauvegarde alors que la boutique est en 100 % local.",
          action: { libelle: "Paramétrer", carte: "sauvegarde" },
        });
      } else if (etat.sauvegarde?.configuree && etat.sauvegarde.alerte !== "aucune") {
        aFaire.push({
          cle: "sauvegarde",
          ton: "alerte",
          texte: `Sauvegarde en retard${etat.sauvegarde.derniereErreur ? ` : ${etat.sauvegarde.derniereErreur}` : ""}.`,
          action: { libelle: "Voir", carte: "sauvegarde" },
        });
      }
    }
    if (etat.aRefaire.length) {
      aFaire.push({
        cle: "mdp",
        ton: "attention",
        texte: `Mot(s) de passe réinitialisé(s) sans internet, à refaire en ligne : ${etat.aRefaire.join(", ")}.`,
        action: { libelle: "Refaire", carte: "reinitialiserMotDePasse" },
      });
    }
  }

  // --- Cartes groupées ---
  const carte = (cle: CarteAdmin, icone: string, titre: string, description: string, etatCarte?: string, desactivee?: string) => (
    <button key={cle} type="button" className="carte-accueil-admin" onClick={() => ouvrir(cle)} disabled={!!desactivee} title={desactivee}>
      <span className="icone-carte-accueil">{icone}</span>
      <span className="textes-carte-accueil">
        <strong>{titre}</strong>
        <span className="sous-info">{description}</span>
        {etatCarte && <span className="etat-carte-accueil">{etatCarte}</span>}
      </span>
    </button>
  );

  return (
    <div className="accueil-admin">
      <header className="entete-accueil-admin">
        <div>
          <h1>Espace Admin</h1>
          <span className="sous-info">Connecté : {username} · verrouillage automatique après 5 min sans activité</span>
        </div>
        <button type="button" onClick={onDeconnexion}>
          🔒 Se déconnecter
        </button>
      </header>

      <div className="bandeau-etat-admin">
        {boutique && <strong className="nom-boutique-admin">🏪 {boutique.boutiqueNom}</strong>}
        {!etat && <span className="sous-info">Chargement…</span>}
        {pastilles.map((p) =>
          p.carte ? (
            <button key={p.cle} type="button" className={`pastille-admin pastille-admin--${p.ton}`} onClick={() => ouvrir(p.carte!)}>
              {p.texte}
            </button>
          ) : (
            <span key={p.cle} className={`pastille-admin pastille-admin--${p.ton}`}>
              {p.texte}
            </span>
          ),
        )}
      </div>

      <div className="corps-accueil-admin">
        <section className="colonne-a-faire">
          <h2>À faire</h2>
          {etat && aFaire.length === 0 && <p className="a-faire-vide">✓ Rien à traiter.</p>}
          <ul>
            {aFaire.map((a) => (
              <li key={a.cle} className={`a-faire a-faire--${a.ton}`}>
                <span>{a.texte}</span>
                {a.action && (
                  <button type="button" className="lien" onClick={() => ouvrir(a.action!.carte)}>
                    {a.action.libelle} ›
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="groupes-accueil-admin">
          <section>
            <h2>Boutique de cet ordinateur</h2>
            <div className="grille-cartes-accueil">
              {carte(
                "abonnement",
                "💳",
                "Abonnement",
                "Renouveler, essai gratuit, options payantes, paiements déclarés, historique, code d'activation.",
                boutique ? (boutique.dateExpirationAbonnement ? `jusqu'au ${dateCourte(boutique.dateExpirationAbonnement)}` : "sans limite") : undefined,
                boutique ? undefined : "Aucune boutique sur cet ordinateur",
              )}
              {carte(
                "options",
                "🌐",
                "Envoi en ligne",
                "Allumer ou couper l'envoi des données au serveur (option En ligne).",
                boutique ? (boutique.synchroAutorisee ? "allumé" : "100 % local") : undefined,
                boutique ? undefined : "Aucune boutique sur cet ordinateur",
              )}
              {carte(
                "reseau",
                "📶",
                "Réseau de la boutique",
                "Activer ou désactiver, demandes de la boutique, rôle de cet ordinateur.",
                boutique ? (boutique.reseauAutorise ? "activé" : "non activé") : undefined,
                boutique ? undefined : "Aucune boutique sur cet ordinateur",
              )}
              {carte(
                "sauvegarde",
                "💾",
                "Sauvegarde",
                "Sauvegarde chiffrée quotidienne, copies, restauration, clé de secours.",
                etat?.sauvegarde?.configuree ? `dernière : ${dateCourte(etat.sauvegarde.derniereSauvegarde)}` : "non paramétrée",
                estAppliMobile ? undefined : "Dans l'appli mobile et sur ordinateur",
              )}
            </div>
          </section>
          <section>
            <h2>Comptes et nouvelle boutique</h2>
            <div className="grille-cartes-accueil">
              {carte(
                "reinitialiserMotDePasse",
                "🔑",
                "Mots de passe",
                "Réinitialiser le mot de passe de n'importe quel compte, de toutes vos boutiques.",
                etat?.aRefaire.length ? `${etat.aRefaire.length} à refaire en ligne` : undefined,
              )}
              {carte(
                "inscription",
                "🚀",
                "Créer une boutique",
                "Assistant en 4 étapes : boutique, patron, options, récapitulatif.",
                boutique ? "cet ordinateur en a déjà une" : "sur cet ordinateur",
              )}
              {carte(
                "laissezPasser",
                "🎫",
                "Laissez-passer",
                "Générer (avec internet) le code qui ouvrira l'Espace Admin d'un appareil sans internet.",
                enLigne === false ? "internet nécessaire" : undefined,
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
