-- Ajouter le paramètre de seuil d'auto-enrichissement
INSERT INTO settings (key, value) 
VALUES ('auto_enrich_min_score', '4')
ON CONFLICT (key) DO NOTHING;