export default function ModaleConfirmation({
  titre,
  description,
  labelConfirmer = "Confirmer",
  dangereux = false,
  enCours = false,
  onAnnuler,
  onConfirmer,
}: {
  titre: string;
  description?: string;
  labelConfirmer?: string;
  dangereux?: boolean;
  enCours?: boolean;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-confirmation" onClick={(e) => e.stopPropagation()}>
        <h3>{titre}</h3>
        {description && <p className="note-aide">{description}</p>}
        <div className="actions-formulaire">
          <button type="button" onClick={onAnnuler} disabled={enCours}>
            Annuler
          </button>
          <button
            type="button"
            className={dangereux ? "bouton-danger" : undefined}
            onClick={onConfirmer}
            disabled={enCours}
          >
            {enCours ? "…" : labelConfirmer}
          </button>
        </div>
      </div>
    </div>
  );
}
