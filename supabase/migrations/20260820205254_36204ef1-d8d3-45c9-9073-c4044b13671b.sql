-- Truthful commercial-email delivery state.
--
-- New outreach is recorded as queued before dispatch, accepted only after
-- Resend returns an email id, then advanced by signed provider webhooks.
-- Existing Lovable auth/transactional queues remain supported.

ALTER TABLE public.emails_sent
  ALTER COLUMN sent_at DROP NOT NULL,
  ALTER COLUMN sent_at DROP DEFAULT;

ALTER TABLE public.emails_sent
  ADD COLUMN IF NOT EXISTS queue_message_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sending_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kpi_eligible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_delivery_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.emails_sent
SET queued_at = COALESCE(queued_at, sent_at, created_at, now()),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE queued_at IS NULL OR updated_at IS NULL;

ALTER TABLE public.emails_sent
  ALTER COLUMN queued_at SET DEFAULT now(),
  ALTER COLUMN queued_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.emails_sent
  DROP CONSTRAINT IF EXISTS emails_sent_status_check;

-- No pre-migration row has provider acceptance evidence: the former code put
-- its local queue UUID in provider_message_id and defaulted sent_at at INSERT.
-- Preserve that raw local history, then remove it from delivery fields and
-- from every verified-delivery KPI instead of guessing which rows were sent.
UPDATE public.emails_sent
SET legacy_delivery_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'recorded_status', status,
      'recorded_provider', provider,
      'local_reference', provider_message_id,
      'recorded_sent_at', sent_at,
      'recorded_at', created_at
    )),
    status = 'legacy_unverifiable',
    kpi_eligible = false,
    provider_message_id = NULL,
    sent_at = NULL,
    updated_at = now();

ALTER TABLE public.emails_sent
  ADD CONSTRAINT emails_sent_status_check
  CHECK (status IN (
    'queued', 'sending', 'sent', 'failed', 'delivered',
    'bounced', 'complained', 'replied', 'suppressed',
    'legacy_unverifiable'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emails_sent_attempt_count_check'
      AND conrelid = 'public.emails_sent'::regclass
  ) THEN
    ALTER TABLE public.emails_sent
      ADD CONSTRAINT emails_sent_attempt_count_check CHECK (attempt_count >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emails_sent_legacy_unverifiable_check'
      AND conrelid = 'public.emails_sent'::regclass
  ) THEN
    ALTER TABLE public.emails_sent
      ADD CONSTRAINT emails_sent_legacy_unverifiable_check CHECK (
        status <> 'legacy_unverifiable'
        OR (
          kpi_eligible = false
          AND provider_message_id IS NULL
          AND sent_at IS NULL
          AND legacy_delivery_snapshot IS NOT NULL
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emails_sent_provider_message_nonempty_check'
      AND conrelid = 'public.emails_sent'::regclass
  ) THEN
    ALTER TABLE public.emails_sent
      ADD CONSTRAINT emails_sent_provider_message_nonempty_check
      CHECK (provider_message_id IS NULL OR btrim(provider_message_id) <> '');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_sent_queue_message_unique
  ON public.emails_sent(queue_message_id)
  WHERE queue_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_sent_idempotency_unique
  ON public.emails_sent(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_sent_provider_message_unique
  ON public.emails_sent(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_status_check;
ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_status_check
  CHECK (status IN (
    'pending', 'queued', 'sending', 'sent', 'delivered', 'suppressed',
    'failed', 'bounced', 'complained', 'rate_limited', 'dlq'
  ));

ALTER TABLE public.suppressed_emails
  DROP CONSTRAINT IF EXISTS suppressed_emails_reason_check;
ALTER TABLE public.suppressed_emails
  ADD CONSTRAINT suppressed_emails_reason_check
  CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'provider_suppression'));

ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS outreach_email_ttl_minutes INTEGER NOT NULL DEFAULT 1440;

CREATE TABLE IF NOT EXISTS public.email_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('resend')),
  event_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_status TEXT NOT NULL CHECK (
    event_status IN ('sent', 'delivered', 'failed', 'bounced', 'complained', 'suppressed')
  ),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, event_id)
);

ALTER TABLE public.email_provider_events
  DROP CONSTRAINT IF EXISTS email_provider_events_event_status_check;
ALTER TABLE public.email_provider_events
  ADD CONSTRAINT email_provider_events_event_status_check
  CHECK (event_status IN ('sent', 'delivered', 'failed', 'bounced', 'complained', 'suppressed'));

CREATE INDEX IF NOT EXISTS idx_email_provider_events_message
  ON public.email_provider_events(provider, provider_message_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_email_provider_events_pending
  ON public.email_provider_events(received_at)
  WHERE processed_at IS NULL;

GRANT ALL ON public.email_provider_events TO service_role;
ALTER TABLE public.email_provider_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Service role can manage email provider events"
    ON public.email_provider_events
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Insert the truth row and PGMQ message in the same database transaction.
-- Reusing an idempotency key returns the original row and never enqueues a
-- second message. Reusing it with a different payload is rejected.
CREATE OR REPLACE FUNCTION public.enqueue_tracked_email(
  p_message_id TEXT,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT,
  p_provider TEXT,
  p_template_name TEXT,
  p_recipient_email TEXT,
  p_sender_email TEXT,
  p_subject TEXT,
  p_body TEXT,
  p_signal_id UUID,
  p_contact_id UUID,
  p_user_id UUID,
  p_metadata JSONB,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_email public.emails_sent%ROWTYPE;
  retry_payload JSONB;
BEGIN
  IF p_message_id IS NULL OR p_message_id = '' THEN
    RAISE EXCEPTION 'message id is required' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'idempotency key must contain 1 to 256 characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid request fingerprint' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('resend', 'lovable_email') THEN
    RAISE EXCEPTION 'unsupported email provider' USING ERRCODE = '22023';
  END IF;
  IF p_template_name = 'outreach-message' AND p_provider <> 'resend' THEN
    RAISE EXCEPTION 'commercial outreach must use Resend' USING ERRCODE = '22023';
  END IF;
  IF p_payload->>'message_id' IS DISTINCT FROM p_message_id THEN
    RAISE EXCEPTION 'queue payload message id mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO existing_email
  FROM public.emails_sent
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_email.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'idempotency key already used for a different email'
        USING ERRCODE = '22000';
    END IF;

    -- A failure before provider acceptance can be retried with the same local
    -- and provider idempotency keys. Provider-side terminal failures retain
    -- their provider id and require an explicit new outreach attempt instead.
    IF existing_email.status = 'failed'
       AND existing_email.provider_message_id IS NULL THEN
      retry_payload := jsonb_set(
        p_payload,
        '{message_id}',
        to_jsonb(existing_email.queue_message_id),
        true
      );
      UPDATE public.emails_sent
      SET status = 'queued',
          error_message = NULL,
          sending_started_at = NULL,
          updated_at = now()
      WHERE id = existing_email.id;
      PERFORM public.enqueue_email('transactional_emails', retry_payload);
      INSERT INTO public.email_send_log (
        message_id, template_name, recipient_email, status, metadata
      ) VALUES (
        existing_email.queue_message_id,
        p_template_name,
        lower(p_recipient_email),
        'queued',
        jsonb_build_object('provider', p_provider, 'retry', true)
      );
      RETURN jsonb_build_object(
        'email_id', existing_email.id,
        'message_id', existing_email.queue_message_id,
        'status', 'queued',
        'queued', true
      );
    END IF;

    RETURN jsonb_build_object(
      'email_id', existing_email.id,
      'message_id', existing_email.queue_message_id,
      'status', existing_email.status,
      'queued', false
    );
  END IF;

  BEGIN
    INSERT INTO public.emails_sent (
      signal_id,
      contact_id,
      recipient_email,
      sender_email,
      subject,
      body,
      status,
      provider,
      provider_message_id,
      queue_message_id,
      idempotency_key,
      request_fingerprint,
      sent_at,
      queued_at,
      user_id,
      metadata,
      updated_at
    ) VALUES (
      p_signal_id,
      p_contact_id,
      lower(p_recipient_email),
      p_sender_email,
      p_subject,
      p_body,
      'queued',
      p_provider,
      NULL,
      p_message_id,
      p_idempotency_key,
      p_request_fingerprint,
      NULL,
      now(),
      p_user_id,
      COALESCE(p_metadata, '{}'::jsonb),
      now()
    )
    RETURNING * INTO existing_email;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO existing_email
    FROM public.emails_sent
    WHERE idempotency_key = p_idempotency_key;

    IF NOT FOUND THEN
      RAISE;
    END IF;
    IF existing_email.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'idempotency key already used for a different email'
        USING ERRCODE = '22000';
    END IF;
    RETURN jsonb_build_object(
      'email_id', existing_email.id,
      'message_id', existing_email.queue_message_id,
      'status', existing_email.status,
      'queued', false
    );
  END;

  PERFORM public.enqueue_email('transactional_emails', p_payload);

  INSERT INTO public.email_send_log (
    message_id, template_name, recipient_email, status, metadata
  ) VALUES (
    p_message_id,
    p_template_name,
    lower(p_recipient_email),
    'queued',
    jsonb_build_object('provider', p_provider)
  );

  RETURN jsonb_build_object(
    'email_id', existing_email.id,
    'message_id', existing_email.queue_message_id,
    'status', existing_email.status,
    'queued', true
  );
END;
$$;

-- Atomic worker claim. A fresh `sending` row is busy; a stale one can be
-- reclaimed safely because Resend receives the same provider idempotency key.
CREATE OR REPLACE FUNCTION public.claim_tracked_email(
  p_message_id TEXT,
  p_stale_after_seconds INTEGER DEFAULT 120
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tracked_email public.emails_sent%ROWTYPE;
  stale_after INTERVAL := make_interval(
    secs => LEAST(GREATEST(COALESCE(p_stale_after_seconds, 120), 30), 3600)
  );
BEGIN
  SELECT * INTO tracked_email
  FROM public.emails_sent
  WHERE queue_message_id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;

  IF tracked_email.status IN (
    'sent', 'delivered', 'bounced', 'complained', 'replied', 'suppressed',
    'legacy_unverifiable'
  ) OR (
    tracked_email.status = 'failed'
    AND tracked_email.provider_message_id IS NOT NULL
  ) THEN
    RETURN 'terminal';
  END IF;

  IF tracked_email.status = 'sending'
     AND tracked_email.sending_started_at > now() - stale_after THEN
    RETURN 'busy';
  END IF;

  UPDATE public.emails_sent
  SET status = 'sending',
      sending_started_at = now(),
      attempt_count = attempt_count + 1,
      error_message = NULL,
      updated_at = now()
  WHERE id = tracked_email.id;

  RETURN 'claimed';
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_tracked_email_status(
  p_email_id UUID,
  p_status TEXT,
  p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_status TEXT;
  next_status TEXT;
  event_time TIMESTAMPTZ := COALESCE(p_occurred_at, now());
BEGIN
  SELECT status INTO current_status
  FROM public.emails_sent
  WHERE id = p_email_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF p_status NOT IN ('sent', 'delivered', 'failed', 'bounced', 'complained', 'suppressed') THEN
    RAISE EXCEPTION 'unsupported email status transition' USING ERRCODE = '22023';
  END IF;

  next_status := current_status;

  -- Delivery state is monotone even when provider webhooks arrive out of
  -- order. More specific terminal evidence may supersede a generic failure;
  -- a late `sent` event can never resurrect any terminal state.
  IF current_status IN (
    'replied', 'suppressed', 'legacy_unverifiable', 'complained'
  ) THEN
    next_status := current_status;
  ELSIF current_status = 'bounced' THEN
    next_status := CASE
      WHEN p_status = 'complained' THEN 'complained'
      ELSE 'bounced'
    END;
  ELSIF current_status = 'failed' THEN
    next_status := CASE
      WHEN p_status = 'complained' THEN 'complained'
      WHEN p_status = 'bounced' THEN 'bounced'
      WHEN p_status = 'suppressed' THEN 'suppressed'
      ELSE 'failed'
    END;
  ELSIF current_status = 'delivered' THEN
    next_status := CASE
      WHEN p_status = 'complained' THEN 'complained'
      WHEN p_status = 'bounced' THEN 'bounced'
      ELSE 'delivered'
    END;
  ELSIF p_status = 'complained' THEN
    next_status := 'complained';
  ELSIF p_status = 'bounced' THEN
    next_status := 'bounced';
  ELSIF p_status = 'suppressed' THEN
    next_status := 'suppressed';
  ELSIF p_status = 'failed' THEN
    next_status := 'failed';
  ELSIF p_status = 'delivered' THEN
    next_status := 'delivered';
  ELSIF p_status = 'sent' AND current_status IN ('queued', 'sending') THEN
    next_status := 'sent';
  END IF;

  UPDATE public.emails_sent
  SET status = next_status,
      sent_at = CASE
        WHEN next_status IN ('sent', 'delivered', 'bounced', 'complained')
          THEN COALESCE(sent_at, event_time)
        ELSE sent_at
      END,
      delivered_at = CASE
        WHEN p_status = 'delivered' AND next_status = 'delivered'
          THEN COALESCE(delivered_at, event_time)
        ELSE delivered_at
      END,
      failed_at = CASE
        WHEN p_status IN ('failed', 'suppressed') AND next_status = p_status
          THEN COALESCE(failed_at, event_time)
        ELSE failed_at
      END,
      bounced_at = CASE
        WHEN p_status = 'bounced' AND next_status = 'bounced'
          THEN COALESCE(bounced_at, event_time)
        ELSE bounced_at
      END,
      complained_at = CASE
        WHEN p_status = 'complained' AND next_status = 'complained'
          THEN COALESCE(complained_at, event_time)
        ELSE complained_at
      END,
      error_message = CASE
        WHEN p_status = next_status
          AND next_status IN ('failed', 'bounced', 'complained', 'suppressed')
          THEN 'Resend event: ' || p_status
        WHEN p_status = next_status
          AND next_status IN ('sent', 'delivered') THEN NULL
        ELSE error_message
      END,
      updated_at = now()
  WHERE id = p_email_id;

  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_resend_email_event(
  p_event_id TEXT,
  p_provider_message_id TEXT,
  p_event_type TEXT,
  p_status TEXT,
  p_occurred_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_event public.email_provider_events%ROWTYPE;
  tracked_email RECORD;
  resulting_status TEXT;
  was_inserted BOOLEAN := false;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = ''
     OR p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'provider event identifiers are required' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('sent', 'delivered', 'failed', 'bounced', 'complained', 'suppressed') THEN
    RAISE EXCEPTION 'unsupported Resend event status' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.email_provider_events (
    provider,
    event_id,
    provider_message_id,
    event_type,
    event_status,
    occurred_at
  ) VALUES (
    'resend',
    p_event_id,
    p_provider_message_id,
    p_event_type,
    p_status,
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT (provider, event_id) DO NOTHING
  RETURNING * INTO stored_event;

  IF FOUND THEN
    was_inserted := true;
  ELSE
    SELECT * INTO stored_event
    FROM public.email_provider_events
    WHERE provider = 'resend' AND event_id = p_event_id;

    IF stored_event.provider_message_id IS DISTINCT FROM p_provider_message_id
       OR stored_event.event_type IS DISTINCT FROM p_event_type
       OR stored_event.event_status IS DISTINCT FROM p_status THEN
      RAISE EXCEPTION 'provider event id was reused with different content'
        USING ERRCODE = '22000';
    END IF;
  END IF;

  SELECT id, recipient_email INTO tracked_email
  FROM public.emails_sent
  WHERE provider = 'resend'
    AND provider_message_id = p_provider_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', NOT was_inserted,
      'applied', false,
      'status', NULL
    );
  END IF;

  resulting_status := public.transition_tracked_email_status(
    tracked_email.id,
    p_status,
    stored_event.occurred_at
  );

  UPDATE public.email_provider_events
  SET processed_at = COALESCE(processed_at, now())
  WHERE id = stored_event.id;

  IF p_status IN ('bounced', 'complained', 'suppressed') THEN
    INSERT INTO public.suppressed_emails (email, reason, metadata)
    VALUES (
      lower(tracked_email.recipient_email),
      CASE p_status
        WHEN 'bounced' THEN 'bounce'
        WHEN 'complained' THEN 'complaint'
        ELSE 'provider_suppression'
      END,
      jsonb_build_object(
        'provider', 'resend',
        'provider_message_id', p_provider_message_id,
        'provider_event_id', p_event_id
      )
    )
    ON CONFLICT (email) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'duplicate', NOT was_inserted,
    'applied', true,
    'status', resulting_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_resend_email_events(
  p_provider_message_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending_event public.email_provider_events%ROWTYPE;
  application_result JSONB;
  applied_count INTEGER := 0;
BEGIN
  FOR pending_event IN
    SELECT *
    FROM public.email_provider_events
    WHERE provider = 'resend'
      AND provider_message_id = p_provider_message_id
      AND processed_at IS NULL
    ORDER BY occurred_at, received_at
  LOOP
    application_result := public.apply_resend_email_event(
      pending_event.event_id,
      pending_event.provider_message_id,
      pending_event.event_type,
      pending_event.event_status,
      pending_event.occurred_at
    );
    IF COALESCE((application_result->>'applied')::boolean, false) THEN
      applied_count := applied_count + 1;
    END IF;
  END LOOP;

  RETURN applied_count;
END;
$$;

-- Provider acceptance and its send log are committed atomically. If this RPC
-- fails, the queue message is retained and a retry uses the same Resend key.
CREATE OR REPLACE FUNCTION public.complete_tracked_email(
  p_message_id TEXT,
  p_provider_message_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tracked_email RECORD;
  recover_local_failure BOOLEAN := false;
BEGIN
  IF p_message_id IS NULL OR btrim(p_message_id) = '' THEN
    RAISE EXCEPTION 'message id is required' USING ERRCODE = '22023';
  END IF;
  IF p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'provider message id is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, recipient_email, metadata, status, provider_message_id INTO tracked_email
  FROM public.emails_sent
  WHERE queue_message_id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF tracked_email.provider_message_id IS NOT NULL
     AND tracked_email.provider_message_id IS DISTINCT FROM p_provider_message_id THEN
    RAISE EXCEPTION 'email already has a different provider message id'
      USING ERRCODE = '22000';
  END IF;

  -- Un autre worker peut avoir déclaré l'essai localement failed pendant que
  -- le premier attendait la réponse Resend. L'acceptation fournisseur est la
  -- preuve la plus forte uniquement tant qu'aucun provider id n'existait : un
  -- failed issu d'un webhook conserve son provider id et reste terminal.
  recover_local_failure := tracked_email.status = 'failed'
    AND tracked_email.provider_message_id IS NULL;

  UPDATE public.emails_sent
  SET provider_message_id = p_provider_message_id,
      status = CASE WHEN recover_local_failure THEN 'sending' ELSE status END,
      failed_at = CASE WHEN recover_local_failure THEN NULL ELSE failed_at END,
      error_message = CASE WHEN recover_local_failure THEN NULL ELSE error_message END,
      updated_at = now()
  WHERE id = tracked_email.id;

  PERFORM public.transition_tracked_email_status(tracked_email.id, 'sent', now());

  INSERT INTO public.email_send_log (
    message_id, template_name, recipient_email, status, metadata
  )
  SELECT
    p_message_id,
    COALESCE(tracked_email.metadata->>'template_name', 'outreach-message'),
    tracked_email.recipient_email,
    'sent',
    jsonb_build_object(
      'provider', 'resend',
      'provider_message_id', p_provider_message_id
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.email_send_log
    WHERE message_id = p_message_id AND status = 'sent'
  );

  PERFORM public.reconcile_resend_email_events(p_provider_message_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_tracked_email(
  p_message_id TEXT,
  p_error_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.emails_sent
  SET status = 'failed',
      error_message = left(COALESCE(p_error_message, 'Provider request failed'), 1000),
      failed_at = now(),
      updated_at = now()
  WHERE queue_message_id = p_message_id
    AND status IN ('queued', 'sending', 'failed');

  RETURN FOUND;
END;
$$;

-- Pipeline progress now reacts to the provider-acceptance UPDATE, not to the
-- initial queued INSERT.
CREATE OR REPLACE FUNCTION public.auto_transition_sent_on_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('sent', 'delivered', 'bounced', 'complained')
     AND NEW.signal_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.signals
    SET pipeline_status = 'sent',
        pipeline_updated_at = now()
    WHERE id = NEW.signal_id
      AND pipeline_status IN ('detected', 'enriched', 'drafted', 'ready');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emails_sent_pipeline_sync ON public.emails_sent;
CREATE TRIGGER emails_sent_pipeline_sync
  AFTER INSERT OR UPDATE ON public.emails_sent
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_transition_sent_on_email();

REVOKE EXECUTE ON FUNCTION public.enqueue_tracked_email(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  UUID, UUID, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_tracked_email(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  UUID, UUID, UUID, JSONB, JSONB
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_tracked_email(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tracked_email(TEXT, INTEGER)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.transition_tracked_email_status(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.apply_resend_email_event(
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_resend_email_event(
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reconcile_resend_email_events(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_resend_email_events(TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_tracked_email(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_tracked_email(TEXT, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.fail_tracked_email(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_tracked_email(TEXT, TEXT)
  TO service_role;