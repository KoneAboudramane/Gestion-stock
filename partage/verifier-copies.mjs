// Composants communs des écrans d'administration : la source est
// partage/composants/, chaque appli en garde une COPIE identique (un import
// hors de l'appli casserait la résolution de React et des types).
//
//   node partage/verifier-copies.mjs            → recopie les sources dans les 3 applis
//   node partage/verifier-copies.mjs --verifier → signale toute copie différente (code 1)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSANTS = ["CarteOption.tsx", "BarreRubriques.tsx", "FicheAcces.tsx", "PanneauOptions.tsx"];
const DESTINATIONS = ["client-electron/src/components", "client-web/src/components", "client-admin/src/composants"];
const lire = (chemin) => readFileSync(chemin, "utf-8").replace(/\r\n/g, "\n");

const verifier = process.argv.includes("--verifier");
let ecarts = 0;
for (const nom of COMPOSANTS) {
  const source = lire(join(racine, "partage/composants", nom));
  for (const dossier of DESTINATIONS) {
    const copie = join(racine, dossier, nom);
    const identique = existsSync(copie) && lire(copie) === source;
    if (identique) continue;
    if (verifier) {
      ecarts++;
      console.log(`✕ ${dossier}/${nom} diffère de partage/composants/${nom}`);
    } else {
      writeFileSync(copie, source);
      console.log(`→ ${dossier}/${nom}`);
    }
  }
}
if (verifier) {
  console.log(ecarts ? `${ecarts} copie(s) à remettre à jour : node partage/verifier-copies.mjs` : "✓ Copies identiques");
  process.exit(ecarts ? 1 : 0);
}
