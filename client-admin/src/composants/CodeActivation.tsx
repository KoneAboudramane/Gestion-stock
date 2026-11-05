import { useState } from "react";

import { api } from "../api";
import { date } from "../format";
import { Erreur } from "./Commun";

/**
 * Code d'activation hors ligne : quand la boutique n'a pas internet, l'appli
 * bloquée se débloque avec ce code (envoyé par WhatsApp ou SMS). Il reprend la
 * date de fin et la formule actuelles de la boutique.
 */
export default function CodeActivation({ boutiqueId, nom }: { boutiqueId: string; nom: string }) {
  const [code, setCode] = useState<{ code: string; fin: string | null } | null>(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [copie, setCopie] = useState(false);

  async function generer() {
    setEnCours(true);
    setErreur("");
    try {
      const r = await api<{ code: string; boutique: { date_expiration_abonnement: string | null } }>(
        `/admin/boutiques/${boutiqueId}/code-activation/`,
        { method: "POST" },
      );
      setCode({ code: r.code, fin: r.boutique.date_expiration_abonnement });
      setCopie(false);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  async function copier() {
    if (!code) return;
    await navigator.clipboard.writeText(code.code);
    setCopie(true);
  }

  return (
    <div className="bloc-code">
      <p className="aide">
        Boutique sans internet ? Envoyez-lui ce code par WhatsApp ou SMS : il débloque l'appli jusqu'à la date de fin
        de l'abonnement.
      </p>
      {erreur && <Erreur message={erreur} />}
      {code ? (
        <>
          <code className="code-activation">{code.code}</code>
          <p className="aide">
            Valable pour « {nom} » jusqu'au {date(code.fin)}.
          </p>
          <div className="actions actions-gauche">
            <button type="button" className="bouton-principal" onClick={copier}>
              {copie ? "✓ Copié" : "Copier le code"}
            </button>
            <button type="button" className="bouton-secondaire" onClick={generer} disabled={enCours}>
              Nouveau code
            </button>
          </div>
        </>
      ) : (
        <div className="actions actions-gauche">
          <button type="button" className="bouton-secondaire" onClick={generer} disabled={enCours}>
            {enCours ? "Génération…" : "🔑 Générer un code d'activation"}
          </button>
        </div>
      )}
    </div>
  );
}
