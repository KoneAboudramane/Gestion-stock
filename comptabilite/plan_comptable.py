"""
Plan comptable SYSCOHADA (Système Normal) — jeu de comptes standard.

Ce fichier fournit une nomenclature large couvrant les classes 1 à 9, dans
l'esprit du plan comptable SYSCOHADA révisé (acte uniforme OHADA relatif au
droit comptable, 2017). Il n'a pas la prétention d'être une reproduction
officielle et exhaustive de l'annexe du texte : c'est un jeu de comptes de
départ, pensé pour couvrir les besoins courants d'un commerce (achats,
ventes, stocks, trésorerie, personnel, tiers). Chaque boutique peut ensuite
ajouter, renommer ou désactiver des comptes depuis l'admin, idéalement après
relecture par un comptable, avant tout usage pour une déclaration fiscale.

Format de chaque entrée : (numero, libelle, classe).
"""

CLASSE_PAR_PREFIXE = {
    "1": 1, "2": 2, "3": 3, "4": 4,
    "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
}

PLAN_COMPTABLE_SYSCOHADA = [
    # --- Classe 1 : Comptes de ressources durables ---
    ("10", "Capital"),
    ("101", "Capital social"),
    ("104", "Primes liées au capital social"),
    ("105", "Écarts de réévaluation"),
    ("106", "Réserves"),
    ("1061", "Réserve légale"),
    ("1063", "Réserves statutaires"),
    ("1068", "Autres réserves"),
    ("109", "Actionnaires, capital souscrit non appelé"),
    ("11", "Report à nouveau"),
    ("110", "Report à nouveau créditeur"),
    ("119", "Report à nouveau débiteur"),
    ("12", "Résultat net de l'exercice"),
    ("120", "Résultat net : bénéfice"),
    ("129", "Résultat net : perte"),
    ("14", "Subventions d'investissement"),
    ("141", "Subventions d'équipement"),
    ("16", "Emprunts et dettes assimilées"),
    ("161", "Emprunts obligataires"),
    ("162", "Emprunts auprès des établissements de crédit"),
    ("166", "Intérêts courus"),
    ("17", "Dettes de crédit-bail et contrats assimilés"),
    ("19", "Provisions financières pour risques et charges"),
    ("191", "Provisions pour litiges"),
    ("194", "Provisions pour charges à répartir"),

    # --- Classe 2 : Actif immobilisé ---
    ("20", "Charges immobilisées"),
    ("201", "Frais de développement et de prospection"),
    ("21", "Immobilisations incorporelles"),
    ("211", "Frais de recherche et de développement"),
    ("212", "Brevets, licences, concessions et droits similaires"),
    ("213", "Logiciels"),
    ("214", "Fonds commercial"),
    ("22", "Terrains"),
    ("221", "Terrains agricoles et forestiers"),
    ("222", "Terrains bâtis"),
    ("23", "Bâtiments, installations techniques et agencements"),
    ("231", "Bâtiments industriels, agricoles et commerciaux"),
    ("233", "Ouvrages d'infrastructure"),
    ("234", "Installations techniques"),
    ("238", "Autres installations et agencements"),
    ("24", "Matériel, mobilier et actifs biologiques"),
    ("241", "Matériel et outillage industriel et commercial"),
    ("2441", "Matériel de bureau"),
    ("2442", "Matériel informatique"),
    ("2444", "Mobilier de bureau"),
    ("245", "Matériel de transport"),
    ("25", "Avances et acomptes versés sur immobilisations"),
    ("26", "Titres de participation"),
    ("27", "Autres immobilisations financières"),
    ("275", "Dépôts et cautionnements versés"),
    ("28", "Amortissements"),
    ("2813", "Amortissements des logiciels"),
    ("2831", "Amortissements des bâtiments"),
    ("2841", "Amortissements du matériel et outillage"),
    ("2845", "Amortissements du matériel de transport"),
    ("29", "Provisions pour dépréciation des immobilisations"),

    # --- Classe 3 : Stocks ---
    ("31", "Marchandises"),
    ("311", "Marchandises A"),
    ("32", "Matières premières et fournitures liées"),
    ("33", "Autres approvisionnements"),
    ("36", "Produits finis"),
    ("37", "Stocks provenant d'immobilisations"),
    ("38", "Stocks en cours de route, en consignation ou en dépôt"),
    ("39", "Dépréciations des stocks"),

    # --- Classe 4 : Comptes de tiers ---
    ("40", "Fournisseurs et comptes rattachés"),
    ("401", "Fournisseurs, dettes en compte"),
    ("408", "Fournisseurs, factures non parvenues"),
    ("409", "Fournisseurs débiteurs (avances et acomptes versés)"),
    ("41", "Clients et comptes rattachés"),
    ("411", "Clients"),
    ("416", "Clients douteux ou litigieux"),
    ("418", "Clients, produits non encore facturés"),
    ("419", "Clients créditeurs (avances et acomptes reçus)"),
    ("42", "Personnel"),
    ("421", "Personnel, avances et acomptes"),
    ("422", "Personnel, rémunérations dues"),
    ("43", "Organismes sociaux"),
    ("431", "Sécurité sociale"),
    ("44", "État et collectivités publiques"),
    ("441", "État, impôt sur les bénéfices"),
    ("443", "État, TVA facturée"),
    ("4431", "TVA facturée sur ventes"),
    ("445", "État, TVA récupérable"),
    ("4452", "TVA récupérable sur achats"),
    ("447", "État, impôts retenus à la source"),
    ("4472", "Impôts et taxes recouvrables sur des tiers"),
    ("45", "Organismes internationaux"),
    ("46", "Associés et groupe"),
    ("47", "Débiteurs et créditeurs divers"),
    ("470", "Débiteurs divers"),
    ("471", "Créditeurs divers"),
    ("476", "Différences de conversion, actif"),
    ("477", "Différences de conversion, passif"),
    ("48", "Créances et dettes hors activités ordinaires (HAO)"),
    ("481", "Fournisseurs d'investissements"),
    ("485", "Créances sur cessions d'immobilisations"),
    ("49", "Dépréciations et risques provisionnés (comptes de tiers)"),
    ("491", "Dépréciations des comptes clients"),

    # --- Classe 5 : Trésorerie ---
    ("50", "Titres de placement"),
    ("51", "Valeurs à encaisser"),
    ("511", "Effets à encaisser"),
    ("512", "Chèques à encaisser"),
    ("52", "Banques"),
    ("521", "Banques locales"),
    ("53", "Établissements financiers et assimilés"),
    ("54", "Instruments de trésorerie"),
    ("55", "Mobile money et instruments de paiement électronique"),
    ("551", "Mobile Money Wave"),
    ("552", "Mobile Money Orange Money"),
    ("553", "Mobile Money MTN Money"),
    ("554", "Mobile Money Moov Money"),
    ("57", "Caisse"),
    ("571", "Caisse siège social"),
    ("58", "Virements internes de fonds"),
    ("59", "Dépréciations et provisions pour risques à court terme"),

    # --- Classe 6 : Charges ---
    ("60", "Achats et variations de stocks"),
    ("601", "Achats de marchandises"),
    ("6031", "Variation des stocks de marchandises"),
    ("604", "Achats stockés de matières et fournitures liées"),
    ("605", "Autres achats"),
    ("608", "Achats d'emballages"),
    ("61", "Transports"),
    ("611", "Transports sur achats"),
    ("612", "Transports sur ventes"),
    ("618", "Autres frais de transport"),
    ("62", "Services extérieurs A"),
    ("621", "Sous-traitance générale"),
    ("622", "Locations et charges locatives"),
    ("624", "Entretien, réparations et maintenance"),
    ("625", "Primes d'assurance"),
    ("626", "Études, recherches et documentation"),
    ("628", "Frais de télécommunications"),
    ("63", "Services extérieurs B"),
    ("631", "Frais bancaires"),
    ("632", "Rémunérations d'intermédiaires et de conseils"),
    ("633", "Frais de formation du personnel"),
    ("637", "Rémunération de transfert de technologie"),
    ("638", "Autres charges externes"),
    ("64", "Impôts et taxes"),
    ("641", "Impôts et taxes directs"),
    ("645", "Impôts et taxes indirects"),
    ("646", "Droits d'enregistrement"),
    ("65", "Autres charges"),
    ("658", "Charges diverses"),
    ("66", "Charges de personnel"),
    ("661", "Rémunérations directes versées au personnel national"),
    ("663", "Indemnités forfaitaires versées au personnel"),
    ("664", "Charges sociales"),
    ("667", "Rémunération de l'exploitant individuel"),
    ("67", "Frais financiers et charges assimilées"),
    ("671", "Intérêts des emprunts"),
    ("674", "Autres intérêts"),
    ("676", "Pertes de change"),
    ("68", "Dotations aux amortissements, provisions et dépréciations"),
    ("681", "Dotations aux amortissements d'exploitation"),
    ("691", "Dotations aux provisions d'exploitation"),
    ("69", "Dotations aux provisions financières / HAO"),

    # --- Classe 7 : Produits ---
    ("70", "Ventes"),
    ("701", "Ventes de marchandises"),
    ("702", "Ventes de produits finis"),
    ("706", "Services vendus"),
    ("707", "Produits accessoires"),
    ("71", "Subventions d'exploitation"),
    ("72", "Production immobilisée"),
    ("73", "Variations des stocks de biens et de services produits"),
    ("75", "Autres produits"),
    ("754", "Revenus des immeubles non affectés à l'exploitation"),
    ("758", "Produits divers"),
    ("77", "Revenus financiers et produits assimilés"),
    ("771", "Intérêts de prêts"),
    ("776", "Gains de change"),
    ("78", "Transferts de charges"),
    ("781", "Transferts de charges d'exploitation"),
    ("79", "Reprises de provisions"),

    # --- Classe 8 : Autres charges et produits (HAO) ---
    ("81", "Valeurs comptables des cessions d'immobilisations"),
    ("82", "Produits des cessions d'immobilisations"),
    ("83", "Charges hors activités ordinaires"),
    ("84", "Produits hors activités ordinaires"),
    ("85", "Dotations HAO"),
    ("86", "Reprises HAO"),
    ("87", "Participation des travailleurs"),
    ("88", "Subventions d'équilibre"),
    ("89", "Impôts sur le résultat"),

    # --- Classe 9 : Engagements hors bilan / comptabilité analytique ---
    # Réservée en V1 : peu utilisée par un commerce de détail, à peupler
    # plus tard si un suivi analytique ou des engagements hors bilan
    # deviennent nécessaires.
    ("90", "Engagements obtenus et accordés"),
]


def construire_entrees():
    """Retourne [(numero, libelle, classe), ...] à partir de PLAN_COMPTABLE_SYSCOHADA."""
    entrees = []
    for numero, libelle in PLAN_COMPTABLE_SYSCOHADA:
        classe = CLASSE_PAR_PREFIXE[numero[0]]
        entrees.append((numero, libelle, classe))
    return entrees
