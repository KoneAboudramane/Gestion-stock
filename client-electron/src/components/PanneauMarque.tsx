const ATOUTS = [
  { icone: "📦", texte: "Stock à jour en temps réel, dépôt par dépôt" },
  { icone: "🧾", texte: "Caisse rapide, même sans connexion internet" },
  { icone: "📊", texte: "Rapports clairs sur vos ventes et bénéfices" },
];

/** Panneau de marque affiché à gauche des écrans de connexion/inscription/mot de passe oublié. */
export default function PanneauMarque() {
  return (
    <div className="panneau-marque">
      <div className="marque-logo">
        <span className="marque-logo-pastille">GS</span>
        Gestion Stock
      </div>
      <h2 className="marque-titre">Pilotez votre boutique en toute simplicité.</h2>
      <p className="marque-sous-titre">
        Stock, ventes, achats et clients réunis dans une seule application, pensée pour fonctionner même hors-ligne.
      </p>
      <ul className="marque-atouts">
        {ATOUTS.map((atout) => (
          <li key={atout.texte}>
            <span className="icone-atout">{atout.icone}</span>
            {atout.texte}
          </li>
        ))}
      </ul>
    </div>
  );
}
