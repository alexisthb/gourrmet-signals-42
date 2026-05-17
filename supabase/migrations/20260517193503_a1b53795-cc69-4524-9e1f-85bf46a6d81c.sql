CREATE TABLE IF NOT EXISTS emails_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'bounced', 'replied')),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_sent_signal_id ON emails_sent(signal_id);
CREATE INDEX IF NOT EXISTS idx_emails_sent_contact_id ON emails_sent(contact_id);
CREATE INDEX IF NOT EXISTS idx_emails_sent_recipient ON emails_sent(recipient_email);
CREATE INDEX IF NOT EXISTS idx_emails_sent_sent_at ON emails_sent(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_sent_status ON emails_sent(status);

ALTER TABLE emails_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emails_sent_read_authenticated" ON emails_sent;
CREATE POLICY "emails_sent_read_authenticated" ON emails_sent
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "emails_sent_insert_service" ON emails_sent;
CREATE POLICY "emails_sent_insert_service" ON emails_sent
  FOR INSERT TO service_role WITH CHECK (TRUE);

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL,
  name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signal_type, name)
);

CREATE INDEX IF NOT EXISTS idx_email_templates_signal_type ON email_templates(signal_type);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_templates_read_authenticated" ON email_templates;
CREATE POLICY "email_templates_read_authenticated" ON email_templates
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "email_templates_write_authenticated" ON email_templates;
CREATE POLICY "email_templates_write_authenticated" ON email_templates
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

INSERT INTO settings (key, value)
VALUES ('email_sender', 'Clotilde Gautier <clotilde@gourrmet.com>')
ON CONFLICT (key) DO NOTHING;

INSERT INTO email_templates (signal_type, name, subject_template, body_template, is_default)
VALUES
  ('anniversaire', 'Anniversaire entreprise',
   'Félicitations pour les {{event_detail}} de {{company_name}}',
   'Bonjour {{contact_first_name}},

Toutes mes félicitations à {{company_name}} pour {{event_detail}} ! C''est une étape importante qui mérite d''être célébrée.

Chez Gourrmet, nous accompagnons les entreprises dans leurs moments-clés avec des créations gastronomiques d''exception : coffrets personnalisés, champagnes et grands crus, créations sur-mesure.

Si vous souhaitez marquer cet anniversaire d''une attention élégante pour vos équipes ou vos clients, je serais ravie d''en discuter.

Bien cordialement,
Clotilde Gautier
Gourrmet',
   TRUE),

  ('levee', 'Levée de fonds',
   'Bravo pour votre levée — {{company_name}}',
   'Bonjour {{contact_first_name}},

Toutes mes félicitations pour {{event_detail}}. Cette étape ouvre de belles perspectives.

Beaucoup d''équipes profitent de ce type de jalon pour marquer le coup auprès de leurs collaborateurs, investisseurs ou clients. Chez Gourrmet, nous créons des coffrets gastronomiques sur-mesure pensés pour ces moments.

Si l''envie vous prend de célébrer cette levée avec élégance, je serais ravie d''échanger.

Bien cordialement,
Clotilde Gautier
Gourrmet',
   TRUE),

  ('nomination', 'Nomination',
   'Bienvenue à {{contact_first_name}} chez {{company_name}}',
   'Bonjour {{contact_first_name}},

Toutes mes félicitations pour votre nomination chez {{company_name}}. {{event_detail}}.

Chez Gourrmet, nous accompagnons fréquemment les prises de poste avec des coffrets gastronomiques signature — un geste élégant pour marquer votre arrivée auprès de vos équipes ou de vos partenaires.

Disponible si vous souhaitez en discuter,
Clotilde Gautier
Gourrmet',
   TRUE),

  ('distinction', 'Distinction / Prix',
   'Bravo pour cette distinction, {{company_name}}',
   'Bonjour {{contact_first_name}},

Quel plaisir de lire {{event_detail}} concernant {{company_name}} — toutes mes félicitations.

C''est le genre de reconnaissance qui mérite d''être partagée avec les équipes. Nous créons chez Gourrmet des coffrets gastronomiques sur-mesure pour souligner ce type d''étape avec élégance.

Si vous souhaitez en faire un moment marquant, je serais ravie d''en parler.

Bien cordialement,
Clotilde Gautier
Gourrmet',
   TRUE),

  ('expansion', 'Expansion / Nouveau bureau',
   '{{event_detail}} — félicitations à {{company_name}}',
   'Bonjour {{contact_first_name}},

Beau projet que celui de {{company_name}} : {{event_detail}}. Bravo pour cette nouvelle étape.

Chez Gourrmet, nous accompagnons régulièrement les inaugurations et les emménagements avec des créations gastronomiques d''exception. Un geste qui marque les esprits, côté équipe comme côté partenaires.

Si vous souhaitez célébrer ce moment, je suis à votre écoute.

Bien cordialement,
Clotilde Gautier
Gourrmet',
   TRUE),

  ('ma', 'Fusion / Acquisition',
   'Félicitations pour l''opération {{company_name}}',
   'Bonjour {{contact_first_name}},

Toutes mes félicitations pour {{event_detail}}. Ce sont souvent des moments charnières, et il y a beaucoup à célébrer.

Chez Gourrmet, nous concevons des coffrets gastronomiques sur-mesure pour marquer ce type d''étape — auprès des équipes intégrées, des conseils ou des partenaires.

Disponible pour en discuter si vous le souhaitez,
Clotilde Gautier
Gourrmet',
   TRUE)
ON CONFLICT (signal_type, name) DO NOTHING;