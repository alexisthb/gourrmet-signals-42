-- Table des Maisons partenaires
CREATE TABLE public.partner_houses (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    logo_url TEXT,
    website_url TEXT,
    linkedin_url TEXT,
    instagram_url TEXT,
    description TEXT,
    category TEXT DEFAULT 'champagne',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table des actualités des Maisons
CREATE TABLE public.partner_news (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    house_id UUID NOT NULL REFERENCES public.partner_houses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    news_type TEXT NOT NULL CHECK (news_type IN ('product', 'event', 'press', 'social')),
    image_url TEXT,
    source_url TEXT,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    event_date DATE,
    event_location TEXT,
    product_name TEXT,
    product_category TEXT,
    is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.partner_houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_news ENABLE ROW LEVEL SECURITY;

-- RLS Policies for partner_houses
CREATE POLICY "Allow all for anon users" ON public.partner_houses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.partner_houses FOR ALL USING (true) WITH CHECK (true);

-- RLS Policies for partner_news  
CREATE POLICY "Allow all for anon users" ON public.partner_news FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.partner_news FOR ALL USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_partner_houses_updated_at
    BEFORE UPDATE ON public.partner_houses
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_partner_news_updated_at
    BEFORE UPDATE ON public.partner_news
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();