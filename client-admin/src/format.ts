const DATE = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const DATE_HEURE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const NOMBRE = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function date(valeur: string | null | undefined): string {
  return valeur ? DATE.format(new Date(valeur)) : "—";
}

export function dateHeure(valeur: string | null | undefined): string {
  return valeur ? DATE_HEURE.format(new Date(valeur)) : "—";
}

/** « aujourd'hui », « hier », « il y a 5 jours »… ou « jamais ». */
export function depuis(valeur: string | null | undefined): string {
  if (!valeur) return "jamais";
  const jours = Math.floor((Date.now() - new Date(valeur).getTime()) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  return `il y a ${jours} jours`;
}

export function montant(valeur: string | number | null | undefined, devise = "FCFA"): string {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  return `${NOMBRE.format(Number(valeur)).replace(/ /g, " ")} ${devise}`;
}

/** Mot de passe provisoire lisible, à dicter au commerçant (sans 0/O ni 1/l). */
export function motDePasseProvisoire(): string {
  const lettres = "abcdefghjkmnpqrstuvwxyz";
  const tirage = crypto.getRandomValues(new Uint32Array(8));
  const mot = Array.from(tirage.slice(0, 6), (n) => lettres[n % lettres.length]).join("");
  return `${mot[0].toUpperCase()}${mot.slice(1)}-${(tirage[6] % 900) + 100}`;
}

/** Date du jour + n jours au format AAAA-MM-JJ (champ <input type="date">). */
export function dansNJours(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
