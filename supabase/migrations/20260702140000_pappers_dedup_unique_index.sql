-- CONCURRENCE + INTÉGRITÉ : dédoublonnage Pappers au niveau base de données.
--
-- fetch-pappers dédoublonne en amont (SELECT ... siren + signal_type avant INSERT), mais
-- deux scans concurrents (cron quotidien + déclenchement manuel, ou deux crons qui se
-- chevauchent) peuvent passer le SELECT « ça n'existe pas » EN MÊME TEMPS puis insérer
-- deux fois le même signal (race condition). Le dédoublonnage applicatif seul ne peut pas
-- fermer cette fenêtre ; seule une contrainte d'unicité en base le garantit.
--
-- Pour les types SANS fenêtre temporelle — anniversary et creation — le couple
-- (siren, signal_type) est un identifiant unique métier (le dédoublonnage applicatif de
-- fetch-pappers les traite déjà comme tels, sans borne de date). On le verrouille par un
-- index UNIQUE partiel.
--
-- Les types BODACC (nomination, capital_increase, transfer) peuvent légitimement se
-- répéter dans le temps (une société peut renommer un dirigeant plusieurs fois) : leur
-- dédoublonnage applicatif est fenêtré à 7 jours -> PAS d'unicité stricte, seulement un
-- index de lecture pour accélérer ce dédoublonnage.

-- 1) Purge des doublons EXISTANTS sur (siren, signal_type) pour anniversary/creation,
--    en gardant en priorité la ligne déjà transférée vers signals (pour ne pas casser le
--    lien signal_id) puis, à défaut, la plus ancienne. Les lignes supprimées ici sont des
--    doublons Pappers bruts : les contacts/enrichissements sont rattachés à la table
--    signals (pas à pappers_signals), donc aucune donnée aval n'est perdue.
DELETE FROM public.pappers_signals p
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY siren, signal_type
           ORDER BY transferred_to_signals DESC, detected_at ASC, id ASC
         ) AS rn
  FROM public.pappers_signals
  WHERE siren IS NOT NULL AND signal_type IN ('anniversary', 'creation')
) d
WHERE p.id = d.id AND d.rn > 1;

-- 2) Index UNIQUE partiel : empêche tout FUTUR doublon (siren, signal_type) sur ces types,
--    y compris en cas de scans concurrents. La 2e insertion échouera proprement (23505),
--    ce que fetch-pappers ignore déjà comme un simple doublon.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pappers_signals_siren_type_stable
  ON public.pappers_signals (siren, signal_type)
  WHERE siren IS NOT NULL AND signal_type IN ('anniversary', 'creation');

-- 3) Index de lecture pour les dédoublonnages fenêtrés BODACC
--    (SELECT ... siren = X AND signal_type = Y AND detected_at >= now()-7j).
CREATE INDEX IF NOT EXISTS idx_pappers_signals_siren_type_detected
  ON public.pappers_signals (siren, signal_type, detected_at DESC);
