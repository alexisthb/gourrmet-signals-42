-- Add geo_zone_id foreign key to linkedin_engagers table
ALTER TABLE public.linkedin_engagers
ADD COLUMN geo_zone_id UUID REFERENCES public.geo_zones(id) ON DELETE SET NULL;

-- Add geo_zone_id foreign key to pappers_signals table
ALTER TABLE public.pappers_signals
ADD COLUMN geo_zone_id UUID REFERENCES public.geo_zones(id) ON DELETE SET NULL;

-- Add geo_zone_id foreign key to raw_articles table
ALTER TABLE public.raw_articles
ADD COLUMN geo_zone_id UUID REFERENCES public.geo_zones(id) ON DELETE SET NULL;

-- Create indexes for better query performance
CREATE INDEX idx_linkedin_engagers_geo_zone ON public.linkedin_engagers(geo_zone_id);
CREATE INDEX idx_pappers_signals_geo_zone ON public.pappers_signals(geo_zone_id);
CREATE INDEX idx_raw_articles_geo_zone ON public.raw_articles(geo_zone_id);