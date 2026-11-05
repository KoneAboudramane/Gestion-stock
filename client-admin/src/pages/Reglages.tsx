import { type FormEvent, useEffect, useState } from "react";

import { api, ErreurApi } from "../api";
import { Chargement, Erreur } from "../composants/Commun";
import { montant } from "../format";
import type { Reglages as Donnees } from "../types";
import { useChargement } from "../useChargement";

type Champs = Omit<Donnees, "grille_tarifs">;

const NUMEROS: [keyof Champs, string][] = [
  ["numero_wave", "Numéro Wave"],
  ["numero_orange_money", "Numéro Orange Money"],
  ["numero_mtn", "Numéro MTN Mobile Money"],
  ["numero_moov", "Numéro Moov Money"],
];

export default function Reglages() {
  const { donnees, setDonnees, erreur: erreurChargement, enCours, recharger } = useChargement(() =>
    api<Donnees>("/admin/reglages/"),
  );
  const [f, setF] = useState<Champs | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  useEffect(() => {
    if (donnees) {
      const { grille_tarifs: _grille, ...champs } = donnees;
      setF(Object.fromEntries(Object.entries(champs).map(([k, v]) => [k, v ?? ""])) as Champs);
    }
  }, [donnees]);

  if (erreurChargement) return <Erreur message={erreurChargement} reessayer={recharger} />;
  if (enCours || !donnees || !f) return <Chargement />;

  const maj = (cle: keyof Champs, valeur: string) => {
    setF((x) => (x ? { ...x, [cle]: valeur } : x));
    setErreurs((e) => ({ ...e, [cle]: "" }));
    setEnregistre(false);
  };

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Enregistrer ces réglages ? Les commerçants verront les nouveaux tarifs et numéros dans l'appli.")) return;
    setEnregistrement(true);
    setErreur("");
    setErreurs({});
    try {
      // Champ prix vide = pas de tarif affiché (null côté serveur).
      const corps = { ...f, prix_mensuel_essentiel: f!.prix_mensuel_essentiel || null, prix_mensuel_pro: f!.prix_mensuel_pro || null };
      setDonnees(await api<Donnees>("/admin/reglages/", { method: "PATCH", body: JSON.stringify(corps) }));
      setEnregistre(true);
    } catch (err) {
      const champs = err instanceof ErreurApi ? err.champs : {};
      setErreurs(champs);
      setErreur(Object.keys(champs).length ? "Corrigez les champs signalés en rouge." : (err as Error).message);
    } finally {
      setEnregistrement(false);
    }
  }

  const champ = (cle: keyof Champs, libelle: string, aide?: string, numerique = false) => (
    <label>
      {libelle}
      <input
        inputMode={numerique ? "decimal" : undefined}
        value={(f[cle] as string) ?? ""}
        onChange={(e) => maj(cle, numerique ? e.target.value.replace(/[^0-9.,]/g, "").replace(",", ".") : e.target.value)}
      />
      {aide && <small className="aide">{aide}</small>}
      {erreurs[cle] && <small className="erreur-champ">{erreurs[cle]}</small>}
    </label>
  );

  return (
    <form className="pile formulaire" onSubmit={soumettre}>
      <p className="aide">Ce que les commerçants voient dans la fenêtre « Abonnement » de l'appli.</p>

      <section className="carte">
        <h3>Où payer</h3>
        <div className="grille-champs">
          {NUMEROS.map(([cle, libelle]) => champ(cle, libelle))}
          {champ("whatsapp", "WhatsApp", "Numéro international sans « + » ni espaces, ex. 22507000000.")}
        </div>
        <label className="champ-plein">
          Instructions affichées au commerçant
          <textarea rows={3} value={f.instructions} onChange={(e) => maj("instructions", e.target.value)} />
        </label>
      </section>

      <section className="carte">
        <h3>Tarifs</h3>
        <div className="grille-champs">
          {champ("prix_mensuel_essentiel", "Prix mensuel Essentiel (FCFA)", "Vide : tarif non affiché.", true)}
          {champ("prix_mensuel_pro", "Prix mensuel Pro (FCFA)", "Vide : tarif non affiché.", true)}
          {champ("remise_3_mois", "Remise sur 3 mois (%)", undefined, true)}
          {champ("remise_6_mois", "Remise sur 6 mois (%)", undefined, true)}
          {champ("remise_12_mois", "Remise sur 12 mois (%)", undefined, true)}
        </div>
        {donnees.grille_tarifs.length > 0 && (
          <>
            <h3>Grille enregistrée</h3>
            <table className="tableau tableau-compact">
              <thead>
                <tr>
                  <th>Formule</th>
                  <th className="nombre">1 mois</th>
                  <th className="nombre">3 mois</th>
                  <th className="nombre">6 mois</th>
                  <th className="nombre">12 mois</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set(donnees.grille_tarifs.map((t) => t.formule_libelle))].map((formule) => (
                  <tr key={formule}>
                    <td>{formule}</td>
                    {[1, 3, 6, 12].map((m) => {
                      const t = donnees.grille_tarifs.find((x) => x.formule_libelle === formule && x.duree_mois === m);
                      return (
                        <td key={m} className="nombre">
                          {t ? montant(t.prix) : "—"}
                          {t && Number(t.remise) > 0 && <small className="sous-ligne">−{Number(t.remise)} %</small>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {erreur && <Erreur message={erreur} />}
      <div className="actions">
        {enregistre && <span className="ok-champ">✓ Enregistré</span>}
        <button type="submit" className="bouton-principal" disabled={enregistrement}>
          {enregistrement ? "Enregistrement…" : "Enregistrer les réglages"}
        </button>
      </div>
    </form>
  );
}
