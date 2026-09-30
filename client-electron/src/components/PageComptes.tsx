import { useEffect, useMemo, useState } from "react";

//<adaptateur>
import { api } from "../api/client";
import type { ColonneExport, ResumeCompte, Session } from "../api/client";

const donnees = {
  /** Clients réguliers / fournisseurs de la boutique (même sans compte). */
  tiers: async (genre: GenreTiers, boutiqueId: string): Promise<Tiers[]> =>
    genre === "client" ? api.catalogue.listerClients(boutiqueId) : api.fournisseurs.lister(boutiqueId),
  resumes: (genre: GenreTiers, boutiqueId: string, depuis: string): Promise<ResumeCompte[]> =>
    genre === "client"
      ? api.comptesTiers.resumesClients(boutiqueId, depuis)
      : api.comptesTiers.resumesFournisseurs(boutiqueId, depuis),
  /** Ce qui reste dû, par id : crédit du client / notre dette envers le fournisseur. */
  dus: async (genre: GenreTiers, boutiqueId: string): Promise<Record<string, number>> => {
    const dus: Record<string, number> = {};
    if (genre === "client") {
      for (const c of await api.credits.lister(boutiqueId, undefined, "en_cours")) dus[c.clientId] = (dus[c.clientId] ?? 0) + c.solde;
    } else {
      const idParNom = new Map((await api.fournisseurs.lister(boutiqueId)).map((f) => [f.nom, f.id]));
      for (const d of await api.dettes.lister(boutiqueId, undefined, "en_cours")) {
        const id = idParNom.get(d.fournisseurNom);
        if (id) dus[id] = (dus[id] ?? 0) + d.solde;
      }
    }
    return dus;
  },
};
//</adaptateur>
import BoutonsExport from "./BoutonsExport";
import { PanneauCompte, type GenreTiers } from "./CompteTiers";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";

interface Tiers {
  id: string;
  nom: string;
  telephone: string;
}

interface LigneCompte extends Tiers {
  solde: number;
  du: number;
  derniereOperation: string | null;
}

const SECTIONS: { cle: GenreTiers; label: string; icone: string }[] = [
  { cle: "client", label: "Comptes clients", icone: "👥" },
  { cle: "fournisseur", label: "Comptes fournisseurs", icone: "🚚" },
];

/** Page « 👛 Comptes » : une carte par genre de compte, chacune ouvre sa modale. */
export default function PageComptes({ session }: { session: Session }) {
  const [ouvert, setOuvert] = useState<GenreTiers | null>(null);
  return (
    <div className="page-produits page-accueil">
      <div className="grille-documents-comptables">
        {SECTIONS.map((s) => (
          <button key={s.cle} type="button" className="carte-document-comptable" onClick={() => setOuvert(s.cle)}>
            <span className="icone-document-comptable">{s.icone}</span>
            {s.label}
          </button>
        ))}
      </div>
      {ouvert && <ModaleComptes key={ouvert} genre={ouvert} session={session} onFermer={() => setOuvert(null)} />}
    </div>
  );
}

function debutDuMois(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function ModaleComptes({ genre, session, onFermer }: { genre: GenreTiers; session: Session; onFermer: () => void }) {
  const devise = useDevise();
  const client = genre === "client";
  const [lignes, setLignes] = useState<LigneCompte[]>([]);
  const [resumes, setResumes] = useState<ResumeCompte[]>([]);
  const [charge, setCharge] = useState(false);
  const [terme, setTerme] = useState("");
  const [filtre, setFiltre] = useState<"tous" | "solde">("tous");
  const [ouvert, setOuvert] = useState<LigneCompte | null>(null);

  async function rafraichir() {
    const [tiers, res, dus] = await Promise.all([
      donnees.tiers(genre, session.boutiqueId),
      donnees.resumes(genre, session.boutiqueId, debutDuMois()),
      donnees.dus(genre, session.boutiqueId),
    ]);
    const parId = new Map<string, LigneCompte>();
    for (const t of tiers) {
      parId.set(t.id, { id: t.id, nom: t.nom, telephone: t.telephone ?? "", solde: 0, du: dus[t.id] ?? 0, derniereOperation: null });
    }
    // Un client occasionnel qui a un compte apparaît aussi.
    for (const r of res) {
      parId.set(r.id, {
        id: r.id,
        nom: r.nom,
        telephone: r.telephone,
        solde: r.solde,
        du: dus[r.id] ?? 0,
        derniereOperation: r.derniereOperation,
      });
    }
    setLignes([...parId.values()]);
    setResumes(res);
    setCharge(true);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre]);

  const filtrees = useMemo(() => {
    const motif = terme.trim().toLowerCase();
    return lignes
      .filter((l) => filtre === "tous" || l.solde !== 0)
      .filter((l) => !motif || l.nom.toLowerCase().includes(motif) || l.telephone.toLowerCase().includes(motif))
      .sort((a, b) => b.solde - a.solde || a.nom.localeCompare(b.nom, "fr"));
  }, [lignes, terme, filtre]);

  const total = lignes.reduce((t, l) => t + l.solde, 0);
  const avecSolde = lignes.filter((l) => l.solde > 0).length;
  const entreesMois = resumes.reduce((t, r) => t + r.entreesPeriode, 0);
  const sortiesMois = resumes.reduce((t, r) => t + r.sortiesPeriode, 0);

  const libelleSolde = client ? "Sur son compte" : "À notre crédit";
  const libelleDu = client ? "Crédit dû" : "Nous lui devons";
  const colonnesExport: ColonneExport[] = [
    { cle: "nom", libelle: client ? "Client" : "Fournisseur" },
    { cle: "telephone", libelle: "Téléphone" },
    { cle: "solde", libelle: `${libelleSolde} (${devise})` },
    { cle: "du", libelle: `${libelleDu} (${devise})` },
    { cle: "derniere", libelle: "Dernière opération" },
  ];
  const lignesExport = filtrees.map((l) => ({
    nom: l.nom,
    telephone: l.telephone,
    solde: l.solde,
    du: l.du,
    derniere: l.derniereOperation ? new Date(l.derniereOperation).toLocaleDateString("fr-FR") : "",
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        {ouvert ? (
          <>
            <div className="modale-entete">
              <h3>
                👛 Compte — {ouvert.nom}
              </h3>
              <button type="button" className="lien bouton-retour" onClick={() => setOuvert(null)}>
                ← Retour
              </button>
            </div>
            <div className="modale-corps">
              <PanneauCompte
                genre={genre}
                tiersId={ouvert.id}
                tiersNom={ouvert.nom}
                telephone={ouvert.telephone}
                session={session}
                classeZone="zone-compte-page"
                onModifie={rafraichir}
              />
            </div>
          </>
        ) : (
          <>
            <div className="modale-entete">
              <h3>{client ? "👥 Comptes clients" : "🚚 Comptes fournisseurs"}</h3>
              <button type="button" className="lien bouton-retour" onClick={onFermer}>
                ← Retour
              </button>
            </div>
            <div className="modale-corps">
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">{client ? "👛 Total sur les comptes" : "👛 Total de nos avances et avoirs"}</span>
                  <strong className="nowrap">
                    {formaterMontant(total)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">{client ? "👥 Clients avec un solde" : "🚚 Fournisseurs avec un solde"}</span>
                  <strong>{avecSolde}</strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">{client ? "⬇️ Déposé ce mois" : "⬆️ Versé / reçu en avoir ce mois"}</span>
                  <strong className="nowrap">
                    {formaterMontant(entreesMois)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">{client ? "🛒 Utilisé / rendu ce mois" : "🧾 Utilisé / remboursé ce mois"}</span>
                  <strong className="nowrap">
                    {formaterMontant(sortiesMois)} {devise}
                  </strong>
                </div>
              </div>
              <div className="barre-actions barre-filtres-historique">
                <input
                  type="search"
                  placeholder={client ? "Client, téléphone…" : "Fournisseur, téléphone…"}
                  value={terme}
                  onChange={(e) => setTerme(e.target.value)}
                />
                <div className="bascule-vue" role="group" aria-label="Filtre">
                  <button type="button" className={filtre === "tous" ? "actif" : ""} onClick={() => setFiltre("tous")}>
                    Tous
                  </button>
                  <button type="button" className={filtre === "solde" ? "actif" : ""} onClick={() => setFiltre("solde")}>
                    Avec un solde
                  </button>
                </div>
                <span className="sous-info">Cliquez sur une ligne pour ouvrir son compte.</span>
                <BoutonsExport
                  titre={client ? "Comptes clients" : "Comptes fournisseurs"}
                  colonnes={colonnesExport}
                  lignes={lignesExport}
                  compact
                />
              </div>
              <div className="zone-tableau-scroll zone-commandes-fiche zone-liste-comptes">
                <table className="tableau-catalogue tableau-grille-journee carte-mobile">
                  <thead>
                    <tr>
                      <th>{client ? "Client" : "Fournisseur"}</th>
                      <th>Téléphone</th>
                      <th>{libelleSolde}</th>
                      <th>{libelleDu}</th>
                      <th>Dernière opération</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrees.map((l) => (
                      <tr key={l.id} className="ligne-cliquable" onClick={() => setOuvert(l)} title="Ouvrir son compte">
                        <td data-label={client ? "Client" : "Fournisseur"}>
                          <strong>{l.nom}</strong>
                        </td>
                        <td data-label="Téléphone">{l.telephone || "—"}</td>
                        <td data-label={libelleSolde} className="nowrap">
                          <strong className={l.solde > 0 ? "montant-entree" : undefined}>
                            {formaterMontant(l.solde)} {devise}
                          </strong>
                        </td>
                        <td data-label={libelleDu} className="nowrap">
                          <span className={l.du > 0 ? "montant-sortie" : undefined}>
                            {formaterMontant(l.du)} {devise}
                          </span>
                        </td>
                        <td data-label="Dernière opération" className="nowrap">
                          {l.derniereOperation ? new Date(l.derniereOperation).toLocaleDateString("fr-FR") : "—"}
                        </td>
                      </tr>
                    ))}
                    {charge && filtrees.length === 0 && (
                      <tr>
                        <td colSpan={5} className="liste-vide">
                          {filtre === "solde" ? "Aucun compte avec un solde." : "Aucun résultat."}
                        </td>
                      </tr>
                    )}
                    {Array.from({ length: Math.max(0, 10 - Math.max(1, filtrees.length)) }).map((_, i) => (
                      <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
