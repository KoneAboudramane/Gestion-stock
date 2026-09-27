import { useEffect, useState } from "react";

import { api, type Session } from "../api";

/**
 * Nom affichable d'un utilisateur à partir de son identifiant (colonnes « Fait
 * par » des historiques). Les comptes ne sont pas synchronisés localement :
 * l'annuaire (/utilisateurs/annuaire/, noms seulement) est lu en ligne puis
 * gardé dans le navigateur pour rester lisible hors-ligne.
 */
export function useNomsUtilisateurs(session: Session): (utilisateurId: string | number | null | undefined) => string {
  const cle = `annuaire-utilisateurs:${session.boutiqueId}`;
  const [noms, setNoms] = useState<Map<string, string>>(() => {
    try {
      const cache = localStorage.getItem(cle);
      return new Map(cache ? (JSON.parse(cache) as [string, string][]) : []);
    } catch {
      return new Map();
    }
  });

  useEffect(() => {
    api.comptes.annuaireUtilisateurs().then((resultat) => {
      if (!resultat.succes) return;
      const entrees = resultat.resultat.map((u) => [String(u.id), u.nom] as [string, string]);
      setNoms(new Map(entrees));
      try {
        localStorage.setItem(cle, JSON.stringify(entrees));
      } catch {
        // Stockage indisponible : on garde simplement les noms en mémoire.
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  return (utilisateurId) => {
    if (utilisateurId === null || utilisateurId === undefined || utilisateurId === "") return "—";
    const id = String(utilisateurId);
    if (id === String(session.utilisateurId)) return "Vous";
    return noms.get(id) ?? `Utilisateur n°${id}`;
  };
}
