-- Ajouter une contrainte unique sur company_name pour éviter les doublons
ALTER TABLE public.salon_mariage_exposants 
ADD CONSTRAINT salon_mariage_exposants_company_name_key UNIQUE (company_name);