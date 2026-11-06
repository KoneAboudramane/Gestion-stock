import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { BASE_URL } from "../api/transport";

/** Même serveur que l'API (relative « /api » en production : servie par Django). */
function adresseAppliAndroid(): string {
  const base = new URL(BASE_URL, window.location.origin).href.replace(/\/api\/?$/, "");
  return `${base}/telecharger/android/`;
}

/**
 * Réglages > carte « 📱 Appli mobile » : modale du QR code de téléchargement
 * de l'appli Android (WhatsApp, copier le lien, imprimer une affiche).
 * Le QR code contient l'adresse FIXE /telecharger/android/ du serveur (pas le
 * fichier) : un QR imprimé reste valable quand l'APK change ou passe au Play Store.
 * Même modale dans client-electron (seules l'adresse et l'ouverture de lien diffèrent).
 */
export default function ModaleAppliMobile({ nomBoutique, onFermer }: { nomBoutique: string; onFermer: () => void }) {
  const [url] = useState(adresseAppliAndroid);
  const [qr, setQr] = useState("");
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    if (!url) return;
    // Couleurs figées (noir sur blanc) : le QR doit rester lisible en thème sombre et à l'impression.
    QRCode.toDataURL(url, { width: 480, margin: 2, color: { dark: "#000000", light: "#ffffff" } }).then(setQr);
  }, [url]);

  const texteWhatsapp = `Installe l'appli « ${nomBoutique || "Gestion Stock"} » sur ton téléphone Android : ${url}`;

  async function copierLien() {
    await navigator.clipboard.writeText(url);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  }

  function imprimer() {
    document.body.classList.add("impression-affiche-appli");
    window.print();
    document.body.classList.remove("impression-affiche-appli");
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>📱 Appli mobile</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps appli-mobile">
          <p className="note-aide">
            Scannez ce code avec l'appareil photo d'un téléphone Android : l'appli se télécharge, il reste à
            l'ouvrir et autoriser l'installation si Android le demande.
          </p>
          {qr ? <img src={qr} alt="QR code de téléchargement de l'appli Android" className="qr-appli-mobile" /> : <p>…</p>}
          <code className="lien-appli-mobile">{url}</code>
          <div className="actions-appli-mobile">
            <button
              type="button"
              disabled={!url}
              onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(texteWhatsapp)}`, "_blank", "noopener")}
            >
              💬 WhatsApp
            </button>
            <button type="button" disabled={!url} onClick={copierLien}>
              {copie ? "✓ Copié" : "📋 Copier le lien"}
            </button>
            <button type="button" className="bouton-primaire" disabled={!qr} onClick={imprimer}>
              🖨️ Imprimer une affiche
            </button>
          </div>
        </div>
      </div>
      {qr &&
        createPortal(
          <div className="zone-impression-affiche-appli">
            <h1>{nomBoutique}</h1>
            <h2>📱 Téléchargez notre appli</h2>
            <img src={qr} alt="" />
            <ol>
              <li>Ouvrez l'appareil photo de votre téléphone Android et visez ce code.</li>
              <li>Touchez le lien qui s'affiche : le fichier d'installation se télécharge.</li>
              <li>Ouvrez-le et autorisez l'installation si Android le demande.</li>
            </ol>
            <p className="lien-affiche">{url}</p>
          </div>,
          document.body,
        )}
    </div>
  );
}
