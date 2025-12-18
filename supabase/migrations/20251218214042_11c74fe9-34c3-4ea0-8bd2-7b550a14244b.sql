-- Ajouter le paramètre d'enrichissement automatique
INSERT INTO settings (key, value) 
VALUES ('auto_enrich_enabled', 'true')
ON CONFLICT (key) DO NOTHING;