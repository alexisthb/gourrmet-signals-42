-- Enable pg_net extension only (pg_cron is likely already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;