
-- Add company_logo_url to signals
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS company_logo_url text;

-- Add company_logo_url to contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS company_logo_url text;

-- Create gift_templates table
CREATE TABLE public.gift_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  image_url text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read gift_templates" ON public.gift_templates FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert gift_templates" ON public.gift_templates FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated users can update gift_templates" ON public.gift_templates FOR UPDATE USING (true);
CREATE POLICY "Authenticated users can delete gift_templates" ON public.gift_templates FOR DELETE USING (true);

CREATE TRIGGER update_gift_templates_updated_at
  BEFORE UPDATE ON public.gift_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create generated_gifts table
CREATE TABLE public.generated_gifts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.gift_templates(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  company_logo_url text,
  original_image_url text,
  generated_image_url text,
  prompt_used text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.generated_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read generated_gifts" ON public.generated_gifts FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert generated_gifts" ON public.generated_gifts FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated users can update generated_gifts" ON public.generated_gifts FOR UPDATE USING (true);
CREATE POLICY "Authenticated users can delete generated_gifts" ON public.generated_gifts FOR DELETE USING (true);

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos', 'company-logos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('gift-templates', 'gift-templates', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('generated-gifts', 'generated-gifts', true) ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies: public read for all 3 buckets
CREATE POLICY "Public read company-logos" ON storage.objects FOR SELECT USING (bucket_id = 'company-logos');
CREATE POLICY "Authenticated upload company-logos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'company-logos');
CREATE POLICY "Authenticated update company-logos" ON storage.objects FOR UPDATE USING (bucket_id = 'company-logos');
CREATE POLICY "Authenticated delete company-logos" ON storage.objects FOR DELETE USING (bucket_id = 'company-logos');

CREATE POLICY "Public read gift-templates" ON storage.objects FOR SELECT USING (bucket_id = 'gift-templates');
CREATE POLICY "Authenticated upload gift-templates" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'gift-templates');
CREATE POLICY "Authenticated update gift-templates" ON storage.objects FOR UPDATE USING (bucket_id = 'gift-templates');
CREATE POLICY "Authenticated delete gift-templates" ON storage.objects FOR DELETE USING (bucket_id = 'gift-templates');

CREATE POLICY "Public read generated-gifts" ON storage.objects FOR SELECT USING (bucket_id = 'generated-gifts');
CREATE POLICY "Authenticated upload generated-gifts" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'generated-gifts');
CREATE POLICY "Authenticated update generated-gifts" ON storage.objects FOR UPDATE USING (bucket_id = 'generated-gifts');
CREATE POLICY "Authenticated delete generated-gifts" ON storage.objects FOR DELETE USING (bucket_id = 'generated-gifts');
