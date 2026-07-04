-- PARITÉ PRESSE : auto-enrichissement Manus des signaux Pappers à fort score (4-5★).
--
-- Décidé avec l'opérateur : les signaux Pappers >= 4★ doivent, comme la Presse, déclencher
-- automatiquement la recherche de contacts par Manus dès la détection. Cela nécessite de
-- LEVER la suspension de l'enrichissement Pappers (posée précédemment) et d'activer le mode
-- automatique. fetch-pappers exécute désormais une étape post-scan qui transfère les N
-- signaux >= 4★ non traités et les met en file via enqueue-enrichment (gate + dedup +
-- cooldown + garde crédits Manus déjà en place).
--
-- Réglages (modifiables ensuite dans Settings) :
--   pappers_enrichment_enabled : master de l'enrichissement Pappers (manuel + auto).
--   pappers_auto_enrich_enabled : active spécifiquement l'auto-enrichissement au scan.
--   pappers_auto_enrich_batch  : nb max de signaux auto-enrichis par passage (throttle coût).
INSERT INTO public.settings (key, value) VALUES
  ('pappers_enrichment_enabled', 'true'),
  ('pappers_auto_enrich_enabled', 'true'),
  ('pappers_auto_enrich_batch', '10')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
