UPDATE public.apify_plan_settings
SET plan_name = 'Budget 200 USD/mois',
    monthly_run_limit = 200,
    quota_unit = 'actor_runs',
    current_period_start = date_trunc('month', current_date)::date,
    current_period_end   = (date_trunc('month', current_date) + interval '1 month - 1 day')::date;