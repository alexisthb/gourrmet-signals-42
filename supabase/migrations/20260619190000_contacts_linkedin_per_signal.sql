-- =========================================================================
-- P1 (perte de contacts) : l'index unique GLOBAL sur contacts.linkedin_url
-- (migration 20260118161322) imposait qu'un linkedin_url n'existe qu'UNE fois
-- dans toute la base. Conséquence : un décideur présent sur plusieurs
-- entreprises/signaux (ou ré-engagé sur un autre signal) voyait sa 2e
-- occurrence SILENCIEUSEMENT rejetée -> le signal terminait 'completed' à 0
-- contact, sans aucune trace. C'est une vraie perte de prospects.
--
-- Correctif : on scope l'unicité au SIGNAL. Un même contact peut exister pour
-- plusieurs signaux (légitime), mais pas en double sur un même signal.
--
-- Sûr : l'ancien index garantissait l'unicité globale, donc (signal_id,
-- linkedin_url) est déjà unique dans les données existantes -> aucune collision
-- à la création du nouvel index.
-- =========================================================================

DROP INDEX IF EXISTS contacts_linkedin_url_unique;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_signal_linkedin_unique
  ON contacts (signal_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;
