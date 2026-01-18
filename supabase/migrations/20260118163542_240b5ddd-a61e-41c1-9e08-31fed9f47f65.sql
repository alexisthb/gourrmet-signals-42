-- Create table for wedding fair exhibitors (wedding planners)
CREATE TABLE public.salon_mariage_exposants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  job_title TEXT,
  email TEXT,
  phone TEXT,
  website_url TEXT,
  linkedin_url TEXT,
  instagram_url TEXT,
  description TEXT,
  specialties TEXT[],
  location TEXT,
  booth_number TEXT,
  is_priority BOOLEAN DEFAULT false,
  outreach_status TEXT DEFAULT 'new',
  notes TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.salon_mariage_exposants ENABLE ROW LEVEL SECURITY;

-- Create policy for public read (since there's no auth in this app)
CREATE POLICY "Anyone can read salon exposants" 
ON public.salon_mariage_exposants 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert salon exposants" 
ON public.salon_mariage_exposants 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update salon exposants" 
ON public.salon_mariage_exposants 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete salon exposants" 
ON public.salon_mariage_exposants 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_salon_mariage_exposants_updated_at
BEFORE UPDATE ON public.salon_mariage_exposants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();