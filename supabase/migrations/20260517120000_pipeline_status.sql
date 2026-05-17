-- GR-008 — Pipeline brouillon : nouveau status intermediaire entre 'detected' et 'sent'.
-- Permet a Clotilde de preparer ses mails le soir, les marquer 'Pret a envoyer',
-- puis les envoyer le lendemain.
--
-- Conception : 2 niveaux de statut distincts :
--   - signals.status (deja existant) : new/contacted/meeting/proposal/won/lost/ignored
--     => statut COMMERCIAL (relation prospect)
--   - signals.pipeline_status (nouveau) : detected/enriched/drafted/ready/sent/replied/archived
--     => statut OPERATIONNEL (etat de preparation du signal)
--
-- Les deux coexistent : un signal `pipeline_status='sent'` aura un `status='contacted'`.

ALTER TABLE signals ADD COLUMN IF NOT EXISTS pipeline_status TEXT
  NOT NULL DEFAULT 'detected'
  CHECK (pipeline_status IN ('detected', 'enriched', 'drafted', 'ready', 'sent', 'replied', 'archived'));

ALTER TABLE signals ADD COLUMN IF NOT EXISTS email_draft JSONB;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_signals_pipeline_status ON signals(pipeline_status);

-- Trigger pour maj automatique de pipeline_updated_at.
CREATE OR REPLACE FUNCTION update_pipeline_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pipeline_status IS DISTINCT FROM OLD.pipeline_status THEN
    NEW.pipeline_updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signals_pipeline_status_timestamp ON signals;
CREATE TRIGGER signals_pipeline_status_timestamp
  BEFORE UPDATE ON signals
  FOR EACH ROW
  EXECUTE FUNCTION update_pipeline_status_timestamp();

-- Auto-transition `enriched` quand enrichment_status passe a 'completed'.
CREATE OR REPLACE FUNCTION auto_transition_enriched()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.enrichment_status = 'completed'
     AND OLD.enrichment_status IS DISTINCT FROM 'completed'
     AND NEW.pipeline_status = 'detected' THEN
    NEW.pipeline_status = 'enriched';
    NEW.pipeline_updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signals_auto_enriched ON signals;
CREATE TRIGGER signals_auto_enriched
  BEFORE UPDATE ON signals
  FOR EACH ROW
  EXECUTE FUNCTION auto_transition_enriched();

-- Quand un email part (emails_sent insert avec status='sent') -> pipeline_status='sent'.
CREATE OR REPLACE FUNCTION auto_transition_sent_on_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'sent' AND NEW.signal_id IS NOT NULL THEN
    UPDATE signals
    SET pipeline_status = 'sent',
        pipeline_updated_at = NOW()
    WHERE id = NEW.signal_id
      AND pipeline_status IN ('detected', 'enriched', 'drafted', 'ready');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS emails_sent_pipeline_sync ON emails_sent;
CREATE TRIGGER emails_sent_pipeline_sync
  AFTER INSERT ON emails_sent
  FOR EACH ROW
  EXECUTE FUNCTION auto_transition_sent_on_email();
