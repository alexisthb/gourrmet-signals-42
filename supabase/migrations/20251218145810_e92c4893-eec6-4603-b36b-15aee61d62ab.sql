-- Ajouter la colonne description
ALTER TABLE search_queries ADD COLUMN IF NOT EXISTS description TEXT;

-- Insérer les 16 nouvelles requêtes
INSERT INTO search_queries (name, query, category, description) VALUES
-- ÉVÉNEMENTS FINANCIERS AVANCÉS (5 requêtes)
('IPO - Introduction en bourse', '("introduction en bourse" OR "entre en bourse" OR "IPO" OR "cotation" OR "fait son entrée en bourse")', 'levee', 'Détecte les introductions en bourse et cotations'),
('Résultats financiers records', '("chiffre d''affaires" OR "résultats" OR "bénéfice" OR "revenus") AND ("record" OR "historique" OR "hausse" OR "croissance" OR "progression")', 'distinction', 'Détecte les annonces de résultats financiers exceptionnels'),
('Closing fonds PE / VC', '("closing" OR "clôture" OR "levé" OR "final close") AND ("fonds" OR "fund" OR "véhicule") AND ("milliards" OR "millions" OR "Md€" OR "M€")', 'levee', 'Détecte les clôtures de fonds Private Equity et Venture Capital'),
('Exit PE - Cession participation', '("cède" OR "cession" OR "exit" OR "vend sa participation" OR "sort du capital" OR "désengagement") AND ("fonds" OR "investisseur" OR "actionnaire")', 'ma', 'Détecte les sorties d''investisseurs et cessions de participations'),
('LBO MBO - Rachat', '("LBO" OR "MBO" OR "rachat par le management" OR "reprise par" OR "OBO" OR "leverage buy-out" OR "transmission")', 'ma', 'Détecte les opérations de LBO, MBO et rachats par le management'),
-- OPÉRATIONS STRATÉGIQUES (3 requêtes)
('Partenariats stratégiques', '("partenariat stratégique" OR "accord de partenariat" OR "alliance stratégique" OR "joint-venture" OR "JV" OR "accord-cadre" OR "collaboration stratégique")', 'ma', 'Détecte les annonces de partenariats stratégiques et joint-ventures'),
('Contrats majeurs remportés', '("remporte" OR "signe" OR "décroche" OR "obtient" OR "attributaire") AND ("contrat" OR "appel d''offres" OR "marché" OR "mandat" OR "deal")', 'distinction', 'Détecte les entreprises qui remportent des contrats ou appels d''offres majeurs'),
('Rebranding - Nouvelle identité', '("change de nom" OR "devient" OR "nouvelle identité" OR "rebranding" OR "nouvelle marque" OR "se rebaptise" OR "changement de nom")', 'expansion', 'Détecte les changements de nom et nouvelles identités de marque'),
-- CERTIFICATIONS & LABELS RSE (2 requêtes)
('Certification B Corp et labels RSE', '("B Corp" OR "certification B" OR "label RSE" OR "Lucie" OR "Engagé RSE" OR "entreprise à mission" OR "société à mission" OR "raison d''être")', 'distinction', 'Détecte les certifications B Corp, labels RSE et entreprises à mission'),
('Prix innovation et trophées sectoriels', '("prix de l''innovation" OR "trophée" OR "lauréat" OR "récompensé" OR "primé" OR "distingué" OR "sacré") AND ("entreprise" OR "société" OR "groupe" OR "cabinet")', 'distinction', 'Détecte les prix, trophées et récompenses sectoriels'),
-- EXPANSION AVANCÉE (3 requêtes)
('Internationalisation - Premier bureau étranger', '("premier bureau" OR "s''implante" OR "expansion internationale" OR "se lance" OR "ouvre à l''étranger") AND ("international" OR "Europe" OR "Asie" OR "États-Unis" OR "Amérique" OR "Londres" OR "New York")', 'expansion', 'Détecte les premières implantations à l''étranger et expansions internationales'),
('Milestones croissance - Caps franchis', '("franchit le cap" OR "atteint" OR "dépasse" OR "passe la barre") AND ("employés" OR "salariés" OR "collaborateurs" OR "clients" OR "utilisateurs" OR "millions")', 'expansion', 'Détecte les caps franchis en nombre d''employés, clients ou utilisateurs'),
('Nouvelle usine - Site de production', '("nouvelle usine" OR "nouveau site" OR "centre de production" OR "inaugure son site" OR "site industriel" OR "plateforme logistique" OR "entrepôt")', 'expansion', 'Détecte les ouvertures d''usines et nouveaux sites de production'),
-- MOUVEMENTS DE PERSONNES AVANCÉS (2 requêtes)
('Promotions associés - Cabinets', '("promu associé" OR "devient associé" OR "nommé partner" OR "accède au rang d''associé" OR "cooptation" OR "nouveau partner" OR "nouveaux associés")', 'nomination', 'Détecte les promotions au rang d''associé dans les cabinets'),
('Succession entreprises familiales', '("transmission" OR "succession" OR "passe le flambeau" OR "nouvelle génération" OR "reprend les rênes" OR "succède à son père" OR "entreprise familiale") AND ("familial" OR "famille" OR "génération")', 'nomination', 'Détecte les transmissions et successions dans les entreprises familiales'),
-- RETOURNEMENTS & REBONDS (1 requête)
('Sortie de crise - Rebond', '("sort de sauvegarde" OR "sort de redressement" OR "retour à la croissance" OR "retrouve la rentabilité" OR "redressement réussi" OR "plan de relance" OR "sortie de crise")', 'distinction', 'Détecte les sorties de procédures collectives et retournements réussis');

-- Mettre à jour les descriptions des requêtes existantes
UPDATE search_queries SET description = 'Détecte les entreprises qui fêtent un anniversaire rond (10, 25, 50, 100 ans)' WHERE name LIKE 'Anniversaires%' AND description IS NULL;
UPDATE search_queries SET description = 'Détecte les levées de fonds significatives' WHERE category = 'levee' AND description IS NULL AND name NOT LIKE 'IPO%' AND name NOT LIKE 'Closing%';
UPDATE search_queries SET description = 'Détecte les fusions et acquisitions d''entreprises' WHERE category = 'ma' AND description IS NULL AND name NOT LIKE 'Exit%' AND name NOT LIKE 'LBO%' AND name NOT LIKE 'Partenariats%';
UPDATE search_queries SET description = 'Détecte les prix et récompenses d''entreprises' WHERE category = 'distinction' AND description IS NULL AND name NOT LIKE 'Résultats%' AND name NOT LIKE 'Contrats%' AND name NOT LIKE 'Certification%' AND name NOT LIKE 'Prix innovation%' AND name NOT LIKE 'Sortie%';
UPDATE search_queries SET description = 'Détecte les ouvertures de bureaux et expansions' WHERE category = 'expansion' AND description IS NULL AND name NOT LIKE 'Rebranding%' AND name NOT LIKE 'Internationalisation%' AND name NOT LIKE 'Milestones%' AND name NOT LIKE 'Nouvelle usine%';
UPDATE search_queries SET description = 'Détecte les nominations de dirigeants' WHERE category = 'nomination' AND description IS NULL AND name NOT LIKE 'Promotions%' AND name NOT LIKE 'Succession%';