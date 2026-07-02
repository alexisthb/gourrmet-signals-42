-- Suivi des tentatives logo — corrige la FAMINE du batch auto-logos (audit Fable).
--
-- CAUSE RACINE : le batch auto (cron auto-fetch-logos-tick, limit 10) selectionnait
-- company_logo_url IS NULL sans ORDER BY ni memoire de tentative. Un echec gratuit
-- (Clearbit/favicon introuvables) n'ecrivait RIEN en base : le signal restait eligible
-- et Postgres renvoyant un ordre physique quasi stable, les 10 memes echecs permanents
-- monopolisaient chaque tick -> les NOUVEAUX signaux (ex: ChapsVision) n'entraient
-- jamais dans le top-10 et n'etaient jamais logotes automatiquement.
--
-- Ces colonnes donnent au batch une memoire (backoff + plafond de tentatives) et un
-- etat diagnosticable ('jamais tente' vs 'tente et introuvable' vs 'tache en vol').
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS logo_fetch_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logo_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS logo_fetch_status text,
  ADD COLUMN IF NOT EXISTS logo_manus_started_at timestamptz;

-- Etats absorbants : les taches logo Manus en vol n'avaient AUCUN horodatage de
-- lancement -> aucun give-up par age possible (une tache morte gardait son task_id a
-- vie, excluant le signal du batch gratuit et le faisant re-poller toutes les 2 min).
-- Backfill a now() : les taches legitimes seront recoltees par cron-check-logos dans
-- les minutes qui viennent ; les fantomes seront liberes par le give-up 6h.
UPDATE public.signals
SET logo_manus_started_at = now()
WHERE logo_manus_task_id IS NOT NULL AND logo_manus_started_at IS NULL;

-- Index partiel pour la selection du batch (petite table, mais gratuit et sain).
CREATE INDEX IF NOT EXISTS idx_signals_logo_batch
  ON public.signals (logo_last_attempt_at ASC NULLS FIRST, detected_at DESC)
  WHERE company_logo_url IS NULL AND logo_manus_task_id IS NULL;
