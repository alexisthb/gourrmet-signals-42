-- Cette table était présente dans le schéma live et les types générés, mais absente de
-- l'historique. Elle doit exister avant les FK ajoutées le 13 janvier 2026.
CREATE TABLE IF NOT EXISTS public.geo_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  regions text[] DEFAULT '{}',
  departments text[] DEFAULT '{}',
  cities text[] DEFAULT '{}',
  postal_prefixes text[] DEFAULT '{}',
  priority integer NOT NULL DEFAULT 99 CHECK (priority BETWEEN 1 AND 99),
  is_active boolean NOT NULL DEFAULT true,
  is_default_priority boolean NOT NULL DEFAULT false,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_geo_zones_updated_at ON public.geo_zones;
CREATE TRIGGER update_geo_zones_updated_at
  BEFORE UPDATE ON public.geo_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.geo_zones (name, slug, regions, priority, is_active, is_default_priority)
VALUES
  ('Île-de-France', 'ile-de-france', ARRAY['Île-de-France'], 1, true, true),
  ('Auvergne-Rhône-Alpes', 'auvergne-rhone-alpes', ARRAY['Auvergne-Rhône-Alpes'], 2, true, true),
  ('Provence-Alpes-Côte d''Azur', 'paca', ARRAY['Provence-Alpes-Côte d''Azur'], 3, true, true)
ON CONFLICT (slug) DO NOTHING;
