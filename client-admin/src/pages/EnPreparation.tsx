import type { Rubrique } from "../menu";

/** Rubrique prévue mais pas encore construite (lots 3 à 5). */
export default function EnPreparation({ rubrique }: { rubrique: Rubrique }) {
  return (
    <section className="carte carte-vide">
      <p className="icone-vide" aria-hidden>
        {rubrique.icone}
      </p>
      <h2>{rubrique.libelle}</h2>
      <p>Cette rubrique arrive au lot {rubrique.lot}.</p>
    </section>
  );
}
