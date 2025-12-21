-- Table pour les posts LinkedIn de Patrick
CREATE TABLE public.linkedin_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_url TEXT NOT NULL UNIQUE,
  title TEXT,
  content TEXT,
  published_at DATE,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  last_scraped_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table pour les engagers (personnes ayant interagi)
CREATE TABLE public.linkedin_engagers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.linkedin_posts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  headline TEXT,
  company TEXT,
  linkedin_url TEXT,
  engagement_type TEXT NOT NULL CHECK (engagement_type IN ('like', 'comment', 'share')),
  comment_text TEXT,
  is_prospect BOOLEAN DEFAULT false,
  transferred_to_contacts BOOLEAN DEFAULT false,
  contact_id UUID,
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.linkedin_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_engagers ENABLE ROW LEVEL SECURITY;

-- RLS Policies for linkedin_posts
CREATE POLICY "Allow all for anon users" ON public.linkedin_posts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.linkedin_posts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for linkedin_engagers
CREATE POLICY "Allow all for anon users" ON public.linkedin_engagers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.linkedin_engagers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_linkedin_posts_updated_at
  BEFORE UPDATE ON public.linkedin_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_linkedin_engagers_updated_at
  BEFORE UPDATE ON public.linkedin_engagers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_linkedin_engagers_post_id ON public.linkedin_engagers(post_id);
CREATE INDEX idx_linkedin_engagers_engagement_type ON public.linkedin_engagers(engagement_type);
CREATE INDEX idx_linkedin_engagers_is_prospect ON public.linkedin_engagers(is_prospect);