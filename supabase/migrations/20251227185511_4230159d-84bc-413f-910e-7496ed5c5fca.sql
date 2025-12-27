-- Table des présentations
CREATE TABLE public.presentations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    file_url TEXT,
    thumbnail_url TEXT,
    file_type TEXT DEFAULT 'pdf',
    slides_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.presentations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Allow all for anon users" ON public.presentations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.presentations FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_presentations_updated_at
    BEFORE UPDATE ON public.presentations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for presentations
INSERT INTO storage.buckets (id, name, public) VALUES ('presentations', 'presentations', true);

-- Storage policies for presentations bucket
CREATE POLICY "Public read access for presentations" ON storage.objects FOR SELECT USING (bucket_id = 'presentations');
CREATE POLICY "Allow uploads for anon" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'presentations');
CREATE POLICY "Allow updates for anon" ON storage.objects FOR UPDATE USING (bucket_id = 'presentations');
CREATE POLICY "Allow deletes for anon" ON storage.objects FOR DELETE USING (bucket_id = 'presentations');