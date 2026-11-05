import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unResultat } from "../../electron/db/helpers";
import { activerEnLigne, creerBoutiqueLocale, lireBoutiqueLocaleEnAttente } from "../../electron/services/inscriptionLocale";
import { creerBaseDeTest } from "../setup";

// Espace Admin → Créer une boutique : une boutique créée sans internet garde ses
// options et les envoie au serveur à « Activer en ligne ».

beforeEach(async () => {
  await creerBaseDeTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("créer une boutique avec ses options", () => {
  it("sur ce poste : options appliquées ici, puis envoyées au serveur à l'activation en ligne", async () => {
    const fin = new Date(Date.now() + 90 * 86400000).toISOString();
    const session = creerBoutiqueLocale({
      boutiqueNom: "Boutique Assistant",
      telephone: "0700000000",
      adresse: "Adjamé",
      devise: "FCFA",
      username: "awa.kone",
      password: "Kalumo-Bitesa-4827",
      email: "awa@example.com",
      prenom: "Awa",
      doitChanger: true,
      options: {
        formule: "pro",
        dateFin: fin,
        nature: "paiement",
        montant: 15000,
        mode: "wave",
        reference: "W-1",
        synchroAutorisee: true,
        reseauAutorise: true,
      },
    });
    expect(session.doitChangerMotDePasse).toBe(true);
    expect(
      unResultat("SELECT formule, date_expiration_abonnement, synchro_autorisee, reseau_autorise, telephone FROM boutiques"),
    ).toMatchObject({ formule: "pro", date_expiration_abonnement: fin, synchro_autorisee: 1, reseau_autorise: 1, telephone: "0700000000" });
    expect(lireBoutiqueLocaleEnAttente()).toMatchObject({ patronPrenom: "Awa", patronDoitChanger: true, options: { formule: "pro" } });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ boutique_id: session.boutiqueId, utilisateur_id: 42 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await activerEnLigne("admin", "AdminSolide123", "Kalumo-Bitesa-4827", session);

    const corps = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(corps).toMatchObject({
      boutique_id: session.boutiqueId,
      boutique_telephone: "0700000000",
      patron_username: "awa.kone",
      patron_first_name: "Awa",
      patron_doit_changer: true,
      formule: "pro",
      date_fin: fin,
      nature: "paiement",
      montant: 15000,
      synchro_autorisee: true,
      reseau_autorise: true,
    });
    expect(lireBoutiqueLocaleEnAttente()).toBeNull();
  });

  it("par défaut : essai gratuit de 15 jours, 100 % local, réseau non activé", () => {
    creerBoutiqueLocale({ boutiqueNom: "Boutique Simple", username: "moussa", password: "Kalumo-Bitesa-4827", email: "m@example.com" });
    const ligne = unResultat<{ formule: string; date_expiration_abonnement: string; synchro_autorisee: number; reseau_autorise: number }>(
      "SELECT formule, date_expiration_abonnement, synchro_autorisee, reseau_autorise FROM boutiques",
    )!;
    expect(ligne).toMatchObject({ formule: "essentiel", synchro_autorisee: 0, reseau_autorise: 0 });
    const jours = (Date.parse(ligne.date_expiration_abonnement) - Date.now()) / 86400000;
    expect(Math.round(jours)).toBe(15);
  });
});
