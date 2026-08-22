export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      apify_credit_usage: {
        Row: {
          created_at: string
          credits_used: number
          date: string
          details: Json | null
          id: string
          post_id: string | null
          scrapes_count: number
          signal_id: string | null
          source: string
        }
        Insert: {
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          id?: string
          post_id?: string | null
          scrapes_count?: number
          signal_id?: string | null
          source?: string
        }
        Update: {
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          id?: string
          post_id?: string | null
          scrapes_count?: number
          signal_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "apify_credit_usage_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "linkedin_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apify_credit_usage_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apify_credit_usage_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      apify_plan_settings: {
        Row: {
          alert_threshold_percent: number
          cost_per_scrape: number
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          monthly_credits: number
          monthly_run_limit: number
          plan_name: string
          quota_unit: string
          updated_at: string
        }
        Insert: {
          alert_threshold_percent?: number
          cost_per_scrape?: number
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          monthly_credits?: number
          monthly_run_limit?: number
          plan_name?: string
          quota_unit?: string
          updated_at?: string
        }
        Update: {
          alert_threshold_percent?: number
          cost_per_scrape?: number
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          monthly_credits?: number
          monthly_run_limit?: number
          plan_name?: string
          quota_unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_enrichment: {
        Row: {
          company_name: string
          contact_candidates_ambiguous: number
          contact_candidates_rejected: number
          contact_candidates_resolved: number
          contact_resolution_measured_at: string | null
          created_at: string | null
          description: string | null
          domain: string | null
          employee_count: string | null
          enrichment_source: string | null
          error_message: string | null
          founded_year: number | null
          headquarters_location: string | null
          id: string
          industry: string | null
          is_seed: boolean
          linkedin_company_url: string | null
          operational_profiles_count: number
          raw_data: Json | null
          resolution_attempted_at: string | null
          resolution_provenance: Json | null
          resolution_score: number | null
          resolution_status: string | null
          resolution_technical_status: string | null
          signal_id: string
          status: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          company_name: string
          contact_candidates_ambiguous?: number
          contact_candidates_rejected?: number
          contact_candidates_resolved?: number
          contact_resolution_measured_at?: string | null
          created_at?: string | null
          description?: string | null
          domain?: string | null
          employee_count?: string | null
          enrichment_source?: string | null
          error_message?: string | null
          founded_year?: number | null
          headquarters_location?: string | null
          id?: string
          industry?: string | null
          is_seed?: boolean
          linkedin_company_url?: string | null
          operational_profiles_count?: number
          raw_data?: Json | null
          resolution_attempted_at?: string | null
          resolution_provenance?: Json | null
          resolution_score?: number | null
          resolution_status?: string | null
          resolution_technical_status?: string | null
          signal_id: string
          status?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          company_name?: string
          contact_candidates_ambiguous?: number
          contact_candidates_rejected?: number
          contact_candidates_resolved?: number
          contact_resolution_measured_at?: string | null
          created_at?: string | null
          description?: string | null
          domain?: string | null
          employee_count?: string | null
          enrichment_source?: string | null
          error_message?: string | null
          founded_year?: number | null
          headquarters_location?: string | null
          id?: string
          industry?: string | null
          is_seed?: boolean
          linkedin_company_url?: string | null
          operational_profiles_count?: number
          raw_data?: Json | null
          resolution_attempted_at?: string | null
          resolution_provenance?: Json | null
          resolution_score?: number | null
          resolution_status?: string | null
          resolution_technical_status?: string | null
          signal_id?: string
          status?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_enrichment_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_enrichment_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_interactions: {
        Row: {
          action_type: string
          contact_id: string
          created_at: string
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          action_type: string
          contact_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          action_type?: string
          contact_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_logo_url: string | null
          company_revenue: number | null
          created_at: string | null
          department: string | null
          email_alternatif: string | null
          email_principal: string | null
          email_verification_confidence: number | null
          email_verification_provenance: Json | null
          email_verification_provider: string | null
          email_verification_qualification: string | null
          email_verification_status: string | null
          email_verified_at: string | null
          enrichment_id: string | null
          first_name: string | null
          full_name: string
          id: string
          is_priority_target: boolean | null
          is_seed: boolean
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          next_action_at: string | null
          next_action_note: string | null
          notes: string | null
          outreach_status: string | null
          phone: string | null
          priority_score: number | null
          raw_data: Json | null
          resolution_provenance: Json | null
          resolution_score: number | null
          resolution_status: string | null
          signal_id: string
          source: string | null
          updated_at: string | null
        }
        Insert: {
          company_logo_url?: string | null
          company_revenue?: number | null
          created_at?: string | null
          department?: string | null
          email_alternatif?: string | null
          email_principal?: string | null
          email_verification_confidence?: number | null
          email_verification_provenance?: Json | null
          email_verification_provider?: string | null
          email_verification_qualification?: string | null
          email_verification_status?: string | null
          email_verified_at?: string | null
          enrichment_id?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          is_priority_target?: boolean | null
          is_seed?: boolean
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          next_action_at?: string | null
          next_action_note?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          priority_score?: number | null
          raw_data?: Json | null
          resolution_provenance?: Json | null
          resolution_score?: number | null
          resolution_status?: string | null
          signal_id: string
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          company_logo_url?: string | null
          company_revenue?: number | null
          created_at?: string | null
          department?: string | null
          email_alternatif?: string | null
          email_principal?: string | null
          email_verification_confidence?: number | null
          email_verification_provenance?: Json | null
          email_verification_provider?: string | null
          email_verification_qualification?: string | null
          email_verification_status?: string | null
          email_verified_at?: string | null
          enrichment_id?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          is_priority_target?: boolean | null
          is_seed?: boolean
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          next_action_at?: string | null
          next_action_note?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          priority_score?: number | null
          raw_data?: Json | null
          resolution_provenance?: Json | null
          resolution_score?: number | null
          resolution_status?: string | null
          signal_id?: string
          source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_enrichment_id_fkey"
            columns: ["enrichment_id"]
            isOneToOne: false
            referencedRelation: "company_enrichment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_state: {
        Row: {
          description: string | null
          enabled: boolean
          job_name: string
          last_error: string | null
          last_run_at: string | null
          last_run_duration_ms: number | null
          last_run_status: string | null
          next_run_at: string | null
          schedule: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          job_name: string
          last_error?: string | null
          last_run_at?: string | null
          last_run_duration_ms?: number | null
          last_run_status?: string | null
          next_run_at?: string | null
          schedule: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          enabled?: boolean
          job_name?: string
          last_error?: string | null
          last_run_at?: string | null
          last_run_duration_ms?: number | null
          last_run_status?: string | null
          next_run_at?: string | null
          schedule?: string
          updated_at?: string
        }
        Relationships: []
      }
      detected_events: {
        Row: {
          created_at: string | null
          date_end: string | null
          date_start: string | null
          description: string | null
          detected_at: string | null
          event_id: string | null
          id: string
          is_added: boolean | null
          location: string | null
          name: string
          relevance_score: number | null
          source: string
          source_url: string | null
          type: string | null
        }
        Insert: {
          created_at?: string | null
          date_end?: string | null
          date_start?: string | null
          description?: string | null
          detected_at?: string | null
          event_id?: string | null
          id?: string
          is_added?: boolean | null
          location?: string | null
          name: string
          relevance_score?: number | null
          source: string
          source_url?: string | null
          type?: string | null
        }
        Update: {
          created_at?: string | null
          date_end?: string | null
          date_start?: string | null
          description?: string | null
          detected_at?: string | null
          event_id?: string | null
          id?: string
          is_added?: boolean | null
          location?: string | null
          name?: string
          relevance_score?: number | null
          source?: string
          source_url?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "detected_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      email_provider_events: {
        Row: {
          event_id: string
          event_status: string
          event_type: string
          id: string
          occurred_at: string
          processed_at: string | null
          provider: string
          provider_message_id: string
          received_at: string
        }
        Insert: {
          event_id: string
          event_status: string
          event_type: string
          id?: string
          occurred_at: string
          processed_at?: string | null
          provider: string
          provider_message_id: string
          received_at?: string
        }
        Update: {
          event_id?: string
          event_status?: string
          event_type?: string
          id?: string
          occurred_at?: string
          processed_at?: string | null
          provider?: string
          provider_message_id?: string
          received_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          outreach_email_ttl_minutes: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          outreach_email_ttl_minutes?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          outreach_email_ttl_minutes?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body_template: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          signal_type: string
          subject_template: string
          updated_at: string
        }
        Insert: {
          body_template: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          signal_type: string
          subject_template: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          signal_type?: string
          subject_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      emails_sent: {
        Row: {
          attempt_count: number
          body: string
          bounced_at: string | null
          complained_at: string | null
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          idempotency_key: string | null
          kpi_eligible: boolean
          legacy_delivery_snapshot: Json | null
          metadata: Json | null
          provider: string
          provider_message_id: string | null
          queue_message_id: string | null
          queued_at: string
          recipient_email: string
          request_fingerprint: string | null
          sender_email: string
          sending_started_at: string | null
          sent_at: string | null
          signal_id: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempt_count?: number
          body: string
          bounced_at?: string | null
          complained_at?: string | null
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          kpi_eligible?: boolean
          legacy_delivery_snapshot?: Json | null
          metadata?: Json | null
          provider?: string
          provider_message_id?: string | null
          queue_message_id?: string | null
          queued_at?: string
          recipient_email: string
          request_fingerprint?: string | null
          sender_email: string
          sending_started_at?: string | null
          sent_at?: string | null
          signal_id?: string | null
          status: string
          subject: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempt_count?: number
          body?: string
          bounced_at?: string | null
          complained_at?: string | null
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          kpi_eligible?: boolean
          legacy_delivery_snapshot?: Json | null
          metadata?: Json | null
          provider?: string
          provider_message_id?: string | null
          queue_message_id?: string | null
          queued_at?: string
          recipient_email?: string
          request_fingerprint?: string | null
          sender_email?: string
          sending_started_at?: string | null
          sent_at?: string | null
          signal_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emails_sent_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_sent_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_sent_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_jobs: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          external_task_id: string | null
          finished_at: string | null
          id: string
          job_type: string
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          max_attempts: number
          next_retry_at: string | null
          poll_expires_at: string | null
          poll_token: string | null
          priority: number
          queued_at: string
          result: Json | null
          signal_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          external_task_id?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          poll_expires_at?: string | null
          poll_token?: string | null
          priority?: number
          queued_at?: string
          result?: Json | null
          signal_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          external_task_id?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          poll_expires_at?: string | null
          poll_token?: string | null
          priority?: number
          queued_at?: string
          result?: Json | null
          signal_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_jobs_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_jobs_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_regeneration_authorizations: {
        Row: {
          authorized_at: string
          authorized_by: string
          consumed_at: string | null
          id: string
          reason: string
          signal_id: string
          superseded_job_id: string | null
        }
        Insert: {
          authorized_at?: string
          authorized_by: string
          consumed_at?: string | null
          id?: string
          reason: string
          signal_id: string
          superseded_job_id?: string | null
        }
        Update: {
          authorized_at?: string
          authorized_by?: string
          consumed_at?: string | null
          id?: string
          reason?: string
          signal_id?: string
          superseded_job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_regeneration_authorizations_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_regeneration_authorizations_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      event_contacts: {
        Row: {
          company_name: string | null
          created_at: string | null
          email: string | null
          event_id: string
          first_name: string | null
          full_name: string
          id: string
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          notes: string | null
          outreach_status: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          event_id: string
          first_name?: string | null
          full_name: string
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          event_id?: string
          first_name?: string | null
          full_name?: string
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_contacts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_exhibitors: {
        Row: {
          booth_number: string | null
          category: string | null
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          description: string | null
          event_id: string
          id: string
          is_priority: boolean | null
          linkedin_url: string | null
          notes: string | null
          outreach_status: string | null
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          booth_number?: string | null
          category?: string | null
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description?: string | null
          event_id: string
          id?: string
          is_priority?: boolean | null
          linkedin_url?: string | null
          notes?: string | null
          outreach_status?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          booth_number?: string | null
          category?: string | null
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description?: string | null
          event_id?: string
          id?: string
          is_priority?: boolean | null
          linkedin_url?: string | null
          notes?: string | null
          outreach_status?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_exhibitors_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string | null
          contacts_count: number | null
          created_at: string | null
          date_end: string | null
          date_start: string
          description: string | null
          id: string
          location: string
          name: string
          notes: string | null
          status: string | null
          type: string
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          address?: string | null
          contacts_count?: number | null
          created_at?: string | null
          date_end?: string | null
          date_start: string
          description?: string | null
          id?: string
          location: string
          name: string
          notes?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          address?: string | null
          contacts_count?: number | null
          created_at?: string | null
          date_end?: string | null
          date_start?: string
          description?: string | null
          id?: string
          location?: string
          name?: string
          notes?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      generated_gifts: {
        Row: {
          company_logo_url: string | null
          company_name: string
          created_at: string
          error_message: string | null
          generated_image_url: string | null
          id: string
          original_image_url: string | null
          prompt_used: string | null
          signal_id: string
          status: string
          template_id: string
        }
        Insert: {
          company_logo_url?: string | null
          company_name: string
          created_at?: string
          error_message?: string | null
          generated_image_url?: string | null
          id?: string
          original_image_url?: string | null
          prompt_used?: string | null
          signal_id: string
          status?: string
          template_id: string
        }
        Update: {
          company_logo_url?: string | null
          company_name?: string
          created_at?: string
          error_message?: string | null
          generated_image_url?: string | null
          id?: string
          original_image_url?: string | null
          prompt_used?: string | null
          signal_id?: string
          status?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_gifts_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_gifts_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_gifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "gift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_zones: {
        Row: {
          cities: string[] | null
          color: string | null
          created_at: string | null
          departments: string[] | null
          id: string
          is_active: boolean | null
          is_default_priority: boolean | null
          name: string
          postal_prefixes: string[] | null
          priority: number | null
          regions: string[] | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          cities?: string[] | null
          color?: string | null
          created_at?: string | null
          departments?: string[] | null
          id?: string
          is_active?: boolean | null
          is_default_priority?: boolean | null
          name: string
          postal_prefixes?: string[] | null
          priority?: number | null
          regions?: string[] | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          cities?: string[] | null
          color?: string | null
          created_at?: string | null
          departments?: string[] | null
          id?: string
          is_active?: boolean | null
          is_default_priority?: boolean | null
          name?: string
          postal_prefixes?: string[] | null
          priority?: number | null
          regions?: string[] | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      gift_templates: {
        Row: {
          created_at: string
          custom_prompt: string | null
          description: string | null
          display_order: number
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_prompt?: string | null
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_prompt?: string | null
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      internal_access_allowlist: {
        Row: {
          approved_at: string
          created_at: string
          enabled: boolean
          note: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string
          created_at?: string
          enabled?: boolean
          note?: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string
          created_at?: string
          enabled?: boolean
          note?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      linkedin_engagers: {
        Row: {
          comment_text: string | null
          company: string | null
          company_revenue: number | null
          contact_id: string | null
          created_at: string | null
          engagement_type: string
          geo_zone_id: string | null
          headline: string | null
          id: string
          is_prospect: boolean | null
          is_seed: boolean
          linkedin_url: string | null
          name: string
          post_id: string | null
          revenue_source: string | null
          scraped_at: string | null
          transferred_to_contacts: boolean | null
          updated_at: string | null
        }
        Insert: {
          comment_text?: string | null
          company?: string | null
          company_revenue?: number | null
          contact_id?: string | null
          created_at?: string | null
          engagement_type: string
          geo_zone_id?: string | null
          headline?: string | null
          id?: string
          is_prospect?: boolean | null
          is_seed?: boolean
          linkedin_url?: string | null
          name: string
          post_id?: string | null
          revenue_source?: string | null
          scraped_at?: string | null
          transferred_to_contacts?: boolean | null
          updated_at?: string | null
        }
        Update: {
          comment_text?: string | null
          company?: string | null
          company_revenue?: number | null
          contact_id?: string | null
          created_at?: string | null
          engagement_type?: string
          geo_zone_id?: string | null
          headline?: string | null
          id?: string
          is_prospect?: boolean | null
          is_seed?: boolean
          linkedin_url?: string | null
          name?: string
          post_id?: string | null
          revenue_source?: string | null
          scraped_at?: string | null
          transferred_to_contacts?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_engagers_geo_zone_id_fkey"
            columns: ["geo_zone_id"]
            isOneToOne: false
            referencedRelation: "geo_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_engagers_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "linkedin_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_posts: {
        Row: {
          comments_count: number | null
          content: string | null
          created_at: string | null
          id: string
          last_scraped_at: string | null
          likes_count: number | null
          post_url: string
          published_at: string | null
          shares_count: number | null
          source_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          last_scraped_at?: string | null
          likes_count?: number | null
          post_url: string
          published_at?: string | null
          shares_count?: number | null
          source_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          comments_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          last_scraped_at?: string | null
          likes_count?: number | null
          post_url?: string
          published_at?: string | null
          shares_count?: number | null
          source_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_posts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "linkedin_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_scan_progress: {
        Row: {
          completed_at: string | null
          contacts_enriched: number | null
          created_at: string
          engagers_found: number | null
          error_message: string | null
          id: string
          manus_task_id: string | null
          manus_task_url: string | null
          max_posts: number | null
          posts_found: number | null
          results: Json | null
          sources_count: number | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          contacts_enriched?: number | null
          created_at?: string
          engagers_found?: number | null
          error_message?: string | null
          id?: string
          manus_task_id?: string | null
          manus_task_url?: string | null
          max_posts?: number | null
          posts_found?: number | null
          results?: Json | null
          sources_count?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          contacts_enriched?: number | null
          created_at?: string
          engagers_found?: number | null
          error_message?: string | null
          id?: string
          manus_task_id?: string | null
          manus_task_url?: string | null
          max_posts?: number | null
          posts_found?: number | null
          results?: Json | null
          sources_count?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      linkedin_sources: {
        Row: {
          created_at: string | null
          engagers_count: number | null
          id: string
          is_active: boolean | null
          last_scraped_at: string | null
          linkedin_url: string
          name: string
          posts_count: number | null
          source_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          engagers_count?: number | null
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          linkedin_url: string
          name: string
          posts_count?: number | null
          source_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          engagers_count?: number | null
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          linkedin_url?: string
          name?: string
          posts_count?: number | null
          source_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      manus_credit_usage: {
        Row: {
          created_at: string
          credits_used: number
          date: string
          details: Json | null
          enrichments_count: number
          id: string
          signal_id: string | null
        }
        Insert: {
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          enrichments_count?: number
          id?: string
          signal_id?: string | null
        }
        Update: {
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          enrichments_count?: number
          id?: string
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manus_credit_usage_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manus_credit_usage_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      manus_plan_settings: {
        Row: {
          alert_threshold_percent: number
          cost_per_enrichment: number
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          monthly_credits: number
          plan_name: string
          updated_at: string
        }
        Insert: {
          alert_threshold_percent?: number
          cost_per_enrichment?: number
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          monthly_credits?: number
          plan_name?: string
          updated_at?: string
        }
        Update: {
          alert_threshold_percent?: number
          cost_per_enrichment?: number
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          monthly_credits?: number
          plan_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      message_feedback: {
        Row: {
          context: Json | null
          created_at: string
          edited_message: string
          edited_subject: string | null
          id: string
          message_type: string
          original_message: string
          original_subject: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          edited_message: string
          edited_subject?: string | null
          id?: string
          message_type: string
          original_message: string
          original_subject?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          edited_message?: string
          edited_subject?: string | null
          id?: string
          message_type?: string
          original_message?: string
          original_subject?: string | null
        }
        Relationships: []
      }
      newsapi_plan_settings: {
        Row: {
          alert_threshold_percent: number
          created_at: string
          current_period_start: string
          daily_requests: number
          id: string
          max_results_per_query: number
          plan_name: string
          updated_at: string
        }
        Insert: {
          alert_threshold_percent?: number
          created_at?: string
          current_period_start?: string
          daily_requests?: number
          id?: string
          max_results_per_query?: number
          plan_name?: string
          updated_at?: string
        }
        Update: {
          alert_threshold_percent?: number
          created_at?: string
          current_period_start?: string
          daily_requests?: number
          id?: string
          max_results_per_query?: number
          plan_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      newsapi_usage: {
        Row: {
          articles_fetched: number
          created_at: string
          date: string
          details: Json | null
          id: string
          query_id: string | null
          requests_count: number
        }
        Insert: {
          articles_fetched?: number
          created_at?: string
          date?: string
          details?: Json | null
          id?: string
          query_id?: string | null
          requests_count?: number
        }
        Update: {
          articles_fetched?: number
          created_at?: string
          date?: string
          details?: Json | null
          id?: string
          query_id?: string | null
          requests_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "newsapi_usage_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "search_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      pappers_credit_usage: {
        Row: {
          api_calls: number
          attempted_at: string | null
          company_credits: number
          created_at: string
          credits_used: number
          date: string
          details: Json | null
          error_code: string | null
          finalized_at: string | null
          http_status: number | null
          id: string
          query_id: string | null
          request_key: string | null
          reservation_status: string
          reserved_credits: number
          scan_id: string | null
          search_credits: number
          success: boolean | null
        }
        Insert: {
          api_calls?: number
          attempted_at?: string | null
          company_credits?: number
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          error_code?: string | null
          finalized_at?: string | null
          http_status?: number | null
          id?: string
          query_id?: string | null
          request_key?: string | null
          reservation_status?: string
          reserved_credits?: number
          scan_id?: string | null
          search_credits?: number
          success?: boolean | null
        }
        Update: {
          api_calls?: number
          attempted_at?: string | null
          company_credits?: number
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          error_code?: string | null
          finalized_at?: string | null
          http_status?: number | null
          id?: string
          query_id?: string | null
          request_key?: string | null
          reservation_status?: string
          reserved_credits?: number
          scan_id?: string | null
          search_credits?: number
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "pappers_credit_usage_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "pappers_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pappers_credit_usage_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "pappers_scan_progress"
            referencedColumns: ["id"]
          },
        ]
      }
      pappers_plan_settings: {
        Row: {
          alert_threshold_percent: number
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          monthly_credits: number
          plan_name: string
          rate_limit_per_second: number
          results_per_page: number
          updated_at: string
        }
        Insert: {
          alert_threshold_percent?: number
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          monthly_credits?: number
          plan_name?: string
          rate_limit_per_second?: number
          results_per_page?: number
          updated_at?: string
        }
        Update: {
          alert_threshold_percent?: number
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          monthly_credits?: number
          plan_name?: string
          rate_limit_per_second?: number
          results_per_page?: number
          updated_at?: string
        }
        Relationships: []
      }
      pappers_queries: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          parameters: Json | null
          signals_count: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          parameters?: Json | null
          signals_count?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          parameters?: Json | null
          signals_count?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pappers_request_cache: {
        Row: {
          created_at: string
          payload: Json
          payload_items: number
          request_key: string
          scan_id: string
          usage_id: string
        }
        Insert: {
          created_at?: string
          payload: Json
          payload_items: number
          request_key: string
          scan_id: string
          usage_id: string
        }
        Update: {
          created_at?: string
          payload?: Json
          payload_items?: number
          request_key?: string
          scan_id?: string
          usage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pappers_request_cache_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "pappers_scan_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pappers_request_cache_usage_id_fkey"
            columns: ["usage_id"]
            isOneToOne: true
            referencedRelation: "pappers_credit_usage"
            referencedColumns: ["id"]
          },
        ]
      }
      pappers_scan_progress: {
        Row: {
          anniversary_years: number | null
          completed_at: string | null
          created_at: string
          current_page: number
          date_creation_max: string | null
          date_creation_min: string | null
          error_message: string | null
          execution_snapshot: Json
          heartbeat_at: string | null
          id: string
          last_cursor: string | null
          lease_expires_at: string | null
          lease_token: string | null
          processed_results: number
          query_id: string | null
          scan_type: string
          started_at: string | null
          status: string
          total_pages: number | null
          total_results: number | null
          updated_at: string
        }
        Insert: {
          anniversary_years?: number | null
          completed_at?: string | null
          created_at?: string
          current_page?: number
          date_creation_max?: string | null
          date_creation_min?: string | null
          error_message?: string | null
          execution_snapshot?: Json
          heartbeat_at?: string | null
          id?: string
          last_cursor?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          processed_results?: number
          query_id?: string | null
          scan_type: string
          started_at?: string | null
          status?: string
          total_pages?: number | null
          total_results?: number | null
          updated_at?: string
        }
        Update: {
          anniversary_years?: number | null
          completed_at?: string | null
          created_at?: string
          current_page?: number
          date_creation_max?: string | null
          date_creation_min?: string | null
          error_message?: string | null
          execution_snapshot?: Json
          heartbeat_at?: string | null
          id?: string
          last_cursor?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          processed_results?: number
          query_id?: string | null
          scan_type?: string
          started_at?: string | null
          status?: string
          total_pages?: number | null
          total_results?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pappers_scan_progress_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "pappers_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      pappers_signals: {
        Row: {
          company_data: Json | null
          company_name: string
          created_at: string | null
          detected_at: string | null
          geo_zone_id: string | null
          id: string
          is_seed: boolean
          processed: boolean | null
          query_id: string | null
          relevance_score: number | null
          revenue: number | null
          revenue_source: string | null
          scan_id: string | null
          signal_detail: string | null
          signal_id: string | null
          signal_type: string
          siren: string | null
          transferred_to_signals: boolean | null
        }
        Insert: {
          company_data?: Json | null
          company_name: string
          created_at?: string | null
          detected_at?: string | null
          geo_zone_id?: string | null
          id?: string
          is_seed?: boolean
          processed?: boolean | null
          query_id?: string | null
          relevance_score?: number | null
          revenue?: number | null
          revenue_source?: string | null
          scan_id?: string | null
          signal_detail?: string | null
          signal_id?: string | null
          signal_type: string
          siren?: string | null
          transferred_to_signals?: boolean | null
        }
        Update: {
          company_data?: Json | null
          company_name?: string
          created_at?: string | null
          detected_at?: string | null
          geo_zone_id?: string | null
          id?: string
          is_seed?: boolean
          processed?: boolean | null
          query_id?: string | null
          relevance_score?: number | null
          revenue?: number | null
          revenue_source?: string | null
          scan_id?: string | null
          signal_detail?: string | null
          signal_id?: string | null
          signal_type?: string
          siren?: string | null
          transferred_to_signals?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "pappers_signals_geo_zone_id_fkey"
            columns: ["geo_zone_id"]
            isOneToOne: false
            referencedRelation: "geo_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pappers_signals_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "pappers_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pappers_signals_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "pappers_scan_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pappers_signals_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pappers_signals_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_houses: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          instagram_url: string | null
          is_active: boolean | null
          linkedin_url: string | null
          logo_url: string | null
          name: string
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          linkedin_url?: string | null
          logo_url?: string | null
          name: string
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          linkedin_url?: string | null
          logo_url?: string | null
          name?: string
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      partner_news: {
        Row: {
          content: string | null
          created_at: string | null
          event_date: string | null
          event_location: string | null
          house_id: string
          id: string
          image_url: string | null
          is_featured: boolean | null
          news_type: string
          product_category: string | null
          product_name: string | null
          published_at: string | null
          source_url: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          event_date?: string | null
          event_location?: string | null
          house_id: string
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          news_type: string
          product_category?: string | null
          product_name?: string | null
          published_at?: string | null
          source_url?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          event_date?: string | null
          event_location?: string | null
          house_id?: string
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          news_type?: string
          product_category?: string | null
          product_name?: string | null
          published_at?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_news_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "partner_houses"
            referencedColumns: ["id"]
          },
        ]
      }
      perplexity_usage: {
        Row: {
          company_name: string | null
          created_at: string
          id: string
          query_type: string
          revenue_found: number | null
          revenue_source: string | null
          success: boolean | null
          tokens_used: number | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          id?: string
          query_type: string
          revenue_found?: number | null
          revenue_source?: string | null
          success?: boolean | null
          tokens_used?: number | null
        }
        Update: {
          company_name?: string | null
          created_at?: string
          id?: string
          query_type?: string
          revenue_found?: number | null
          revenue_source?: string | null
          success?: boolean | null
          tokens_used?: number | null
        }
        Relationships: []
      }
      presentations: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          file_type: string | null
          file_url: string | null
          id: string
          is_active: boolean | null
          slides_count: number | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean | null
          slides_count?: number | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean | null
          slides_count?: number | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      press_expected_opportunities: {
        Row: {
          created_at: string
          dataset_version: string | null
          evidence: Json
          expected_company_name: string
          expected_signal_type: string
          id: string
          matched_company_name: string | null
          matched_model_revision: string | null
          matched_prompt_hash: string | null
          matched_raw_article_id: string | null
          matched_signal_id: string | null
          matched_signal_type: string | null
          model_revision: string | null
          prompt_hash: string | null
          raw_article_id: string
          reviewed_at: string
          reviewed_by: string | null
          sampling_method: string | null
        }
        Insert: {
          created_at?: string
          dataset_version?: string | null
          evidence?: Json
          expected_company_name: string
          expected_signal_type: string
          id?: string
          matched_company_name?: string | null
          matched_model_revision?: string | null
          matched_prompt_hash?: string | null
          matched_raw_article_id?: string | null
          matched_signal_id?: string | null
          matched_signal_type?: string | null
          model_revision?: string | null
          prompt_hash?: string | null
          raw_article_id: string
          reviewed_at?: string
          reviewed_by?: string | null
          sampling_method?: string | null
        }
        Update: {
          created_at?: string
          dataset_version?: string | null
          evidence?: Json
          expected_company_name?: string
          expected_signal_type?: string
          id?: string
          matched_company_name?: string | null
          matched_model_revision?: string | null
          matched_prompt_hash?: string | null
          matched_raw_article_id?: string | null
          matched_signal_id?: string | null
          matched_signal_type?: string | null
          model_revision?: string | null
          prompt_hash?: string | null
          raw_article_id?: string
          reviewed_at?: string
          reviewed_by?: string | null
          sampling_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "press_expected_opportunities_matched_signal_id_fkey"
            columns: ["matched_signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "press_expected_opportunities_matched_signal_id_fkey"
            columns: ["matched_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "press_expected_opportunities_raw_article_id_fkey"
            columns: ["raw_article_id"]
            isOneToOne: false
            referencedRelation: "raw_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      press_signal_quality_reviews: {
        Row: {
          created_at: string
          dataset_version: string | null
          evidence: Json
          id: string
          model_revision: string | null
          predicted_company_name: string | null
          predicted_signal_type: string | null
          prompt_hash: string | null
          raw_article_id: string | null
          reviewed_at: string
          reviewed_by: string | null
          sampling_method: string | null
          signal_id: string
          verdict: string
        }
        Insert: {
          created_at?: string
          dataset_version?: string | null
          evidence?: Json
          id?: string
          model_revision?: string | null
          predicted_company_name?: string | null
          predicted_signal_type?: string | null
          prompt_hash?: string | null
          raw_article_id?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          sampling_method?: string | null
          signal_id: string
          verdict: string
        }
        Update: {
          created_at?: string
          dataset_version?: string | null
          evidence?: Json
          id?: string
          model_revision?: string | null
          predicted_company_name?: string | null
          predicted_signal_type?: string | null
          prompt_hash?: string | null
          raw_article_id?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          sampling_method?: string | null
          signal_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "press_signal_quality_reviews_raw_article_id_fkey"
            columns: ["raw_article_id"]
            isOneToOne: false
            referencedRelation: "raw_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "press_signal_quality_reviews_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "press_signal_quality_reviews_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_cost_rates: {
        Row: {
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          evidence: Json
          id: string
          operation: string
          provider: string
          source: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          currency: string
          effective_from: string
          effective_to?: string | null
          evidence?: Json
          id?: string
          operation: string
          provider: string
          source: string
          unit_price: number
        }
        Update: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          evidence?: Json
          id?: string
          operation?: string
          provider?: string
          source?: string
          unit_price?: number
        }
        Relationships: []
      }
      provider_measurement_state: {
        Row: {
          created_at: string
          measurement_started_at: string
          metadata: Json
          provider: string
        }
        Insert: {
          created_at?: string
          measurement_started_at: string
          metadata?: Json
          provider: string
        }
        Update: {
          created_at?: string
          measurement_started_at?: string
          metadata?: Json
          provider?: string
        }
        Relationships: []
      }
      provider_quota_reservations: {
        Row: {
          actual_units: number | null
          attempted_at: string | null
          completed_at: string | null
          created_at: string
          error_code: string | null
          expires_at: string
          id: string
          metadata: Json
          occurred_at: string
          operation: string
          provider: string
          query_id: string | null
          request_key: string
          reserved_units: number
          run_id: string | null
          status: string
        }
        Insert: {
          actual_units?: number | null
          attempted_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          expires_at: string
          id?: string
          metadata?: Json
          occurred_at?: string
          operation: string
          provider: string
          query_id?: string | null
          request_key: string
          reserved_units: number
          run_id?: string | null
          status?: string
        }
        Update: {
          actual_units?: number | null
          attempted_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          expires_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          operation?: string
          provider?: string
          query_id?: string | null
          request_key?: string
          reserved_units?: number
          run_id?: string | null
          status?: string
        }
        Relationships: []
      }
      provider_usage_events: {
        Row: {
          applied_rate_id: string | null
          business_key: string | null
          contact_id: string | null
          cost_amount: number | null
          cost_source: string | null
          created_at: string
          currency: string | null
          dispatch_status: string
          effective_cost_amount: number | null
          effective_cost_source: string | null
          effective_currency: string | null
          error_code: string | null
          id: string
          items_count: number
          metadata: Json
          occurred_at: string
          operation: string
          provider: string
          query_id: string | null
          request_key: string | null
          requests_count: number
          run_id: string | null
          signal_id: string | null
          success: boolean
          units: number
        }
        Insert: {
          applied_rate_id?: string | null
          business_key?: string | null
          contact_id?: string | null
          cost_amount?: number | null
          cost_source?: string | null
          created_at?: string
          currency?: string | null
          dispatch_status?: string
          effective_cost_amount?: number | null
          effective_cost_source?: string | null
          effective_currency?: string | null
          error_code?: string | null
          id?: string
          items_count?: number
          metadata?: Json
          occurred_at?: string
          operation: string
          provider: string
          query_id?: string | null
          request_key?: string | null
          requests_count?: number
          run_id?: string | null
          signal_id?: string | null
          success?: boolean
          units?: number
        }
        Update: {
          applied_rate_id?: string | null
          business_key?: string | null
          contact_id?: string | null
          cost_amount?: number | null
          cost_source?: string | null
          created_at?: string
          currency?: string | null
          dispatch_status?: string
          effective_cost_amount?: number | null
          effective_cost_source?: string | null
          effective_currency?: string | null
          error_code?: string | null
          id?: string
          items_count?: number
          metadata?: Json
          occurred_at?: string
          operation?: string
          provider?: string
          query_id?: string | null
          request_key?: string | null
          requests_count?: number
          run_id?: string | null
          signal_id?: string | null
          success?: boolean
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_events_applied_rate_id_fkey"
            columns: ["applied_rate_id"]
            isOneToOne: false
            referencedRelation: "provider_cost_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_articles: {
        Row: {
          attempt_count: number
          author: string | null
          claim_token: string | null
          claimed_at: string | null
          content: string | null
          created_at: string | null
          dead_letter_reason: string | null
          dead_lettered_at: string | null
          description: string | null
          fetched_at: string | null
          geo_zone_id: string | null
          id: string
          image_url: string | null
          last_error: string | null
          next_retry_at: string | null
          processed: boolean | null
          published_at: string | null
          query_id: string | null
          source_name: string | null
          title: string
          url: string
        }
        Insert: {
          attempt_count?: number
          author?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          content?: string | null
          created_at?: string | null
          dead_letter_reason?: string | null
          dead_lettered_at?: string | null
          description?: string | null
          fetched_at?: string | null
          geo_zone_id?: string | null
          id?: string
          image_url?: string | null
          last_error?: string | null
          next_retry_at?: string | null
          processed?: boolean | null
          published_at?: string | null
          query_id?: string | null
          source_name?: string | null
          title: string
          url: string
        }
        Update: {
          attempt_count?: number
          author?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          content?: string | null
          created_at?: string | null
          dead_letter_reason?: string | null
          dead_lettered_at?: string | null
          description?: string | null
          fetched_at?: string | null
          geo_zone_id?: string | null
          id?: string
          image_url?: string | null
          last_error?: string | null
          next_retry_at?: string | null
          processed?: boolean | null
          published_at?: string | null
          query_id?: string | null
          source_name?: string | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_articles_geo_zone_id_fkey"
            columns: ["geo_zone_id"]
            isOneToOne: false
            referencedRelation: "geo_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_articles_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "search_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      resolution_quality_reviews: {
        Row: {
          algorithm_revision: string | null
          company_enrichment_id: string | null
          contact_id: string | null
          created_at: string
          dataset_version: string | null
          evidence: Json
          id: string
          prediction_snapshot: Json | null
          reviewed_at: string
          reviewed_by: string | null
          sampling_method: string | null
          subject_type: string
          verdict: string
        }
        Insert: {
          algorithm_revision?: string | null
          company_enrichment_id?: string | null
          contact_id?: string | null
          created_at?: string
          dataset_version?: string | null
          evidence?: Json
          id?: string
          prediction_snapshot?: Json | null
          reviewed_at?: string
          reviewed_by?: string | null
          sampling_method?: string | null
          subject_type: string
          verdict: string
        }
        Update: {
          algorithm_revision?: string | null
          company_enrichment_id?: string | null
          contact_id?: string | null
          created_at?: string
          dataset_version?: string | null
          evidence?: Json
          id?: string
          prediction_snapshot?: Json | null
          reviewed_at?: string
          reviewed_by?: string | null
          sampling_method?: string | null
          subject_type?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "resolution_quality_reviews_company_enrichment_id_fkey"
            columns: ["company_enrichment_id"]
            isOneToOne: false
            referencedRelation: "company_enrichment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resolution_quality_reviews_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_mariage_exposants: {
        Row: {
          booth_number: string | null
          company_name: string
          contact_name: string | null
          created_at: string
          description: string | null
          email: string | null
          id: string
          instagram_url: string | null
          is_priority: boolean | null
          job_title: string | null
          linkedin_url: string | null
          location: string | null
          notes: string | null
          outreach_status: string | null
          phone: string | null
          raw_data: Json | null
          siret: string | null
          source_notes: string | null
          specialties: string[] | null
          tier: number | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          booth_number?: string | null
          company_name: string
          contact_name?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          instagram_url?: string | null
          is_priority?: boolean | null
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          raw_data?: Json | null
          siret?: string | null
          source_notes?: string | null
          specialties?: string[] | null
          tier?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          booth_number?: string | null
          company_name?: string
          contact_name?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          instagram_url?: string | null
          is_priority?: boolean | null
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          raw_data?: Json | null
          siret?: string | null
          source_notes?: string | null
          specialties?: string[] | null
          tier?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      scan_logs: {
        Row: {
          articles_analyzed: number | null
          articles_fetched: number | null
          completed_at: string | null
          created_at: string | null
          detection_model_revision: string | null
          detection_prompt_hash: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          signals_created: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          articles_analyzed?: number | null
          articles_fetched?: number | null
          completed_at?: string | null
          created_at?: string | null
          detection_model_revision?: string | null
          detection_prompt_hash?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          signals_created?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          articles_analyzed?: number | null
          articles_fetched?: number | null
          completed_at?: string | null
          created_at?: string | null
          detection_model_revision?: string | null
          detection_prompt_hash?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          signals_created?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      scrap_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          event_id: string
          exhibitors_found: number | null
          exhibitors_processed: number | null
          id: string
          source_url: string | null
          started_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          event_id: string
          exhibitors_found?: number | null
          exhibitors_processed?: number | null
          id?: string
          source_url?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          event_id?: string
          exhibitors_found?: number | null
          exhibitors_processed?: number | null
          id?: string
          source_url?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrap_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      search_queries: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          last_fetched_at: string | null
          name: string
          query: string
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_fetched_at?: string | null
          name: string
          query: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_fetched_at?: string | null
          name?: string
          query?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      signal_interactions: {
        Row: {
          action_type: string
          created_at: string
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          signal_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          signal_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_interactions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_interactions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          article_id: string | null
          company_logo_url: string | null
          company_name: string
          company_name_normalized: string | null
          contacted_at: string | null
          created_at: string | null
          detected_at: string | null
          detection_model_revision: string | null
          detection_prompt_hash: string | null
          detection_run_id: string | null
          email_draft: Json | null
          enrichment_status: string | null
          estimated_size: string | null
          event_detail: string | null
          hook_suggestion: string | null
          id: string
          is_seed: boolean
          logo_fetch_attempts: number
          logo_fetch_status: string | null
          logo_last_attempt_at: string | null
          logo_manus_started_at: string | null
          logo_manus_task_id: string | null
          next_action_at: string | null
          next_action_note: string | null
          notes: string | null
          pipeline_status: string
          pipeline_updated_at: string | null
          revenue: number | null
          revenue_source: string | null
          score: number
          sector: string | null
          signal_type: string
          source_name: string | null
          source_url: string | null
          status: string | null
        }
        Insert: {
          article_id?: string | null
          company_logo_url?: string | null
          company_name: string
          company_name_normalized?: string | null
          contacted_at?: string | null
          created_at?: string | null
          detected_at?: string | null
          detection_model_revision?: string | null
          detection_prompt_hash?: string | null
          detection_run_id?: string | null
          email_draft?: Json | null
          enrichment_status?: string | null
          estimated_size?: string | null
          event_detail?: string | null
          hook_suggestion?: string | null
          id?: string
          is_seed?: boolean
          logo_fetch_attempts?: number
          logo_fetch_status?: string | null
          logo_last_attempt_at?: string | null
          logo_manus_started_at?: string | null
          logo_manus_task_id?: string | null
          next_action_at?: string | null
          next_action_note?: string | null
          notes?: string | null
          pipeline_status?: string
          pipeline_updated_at?: string | null
          revenue?: number | null
          revenue_source?: string | null
          score: number
          sector?: string | null
          signal_type: string
          source_name?: string | null
          source_url?: string | null
          status?: string | null
        }
        Update: {
          article_id?: string | null
          company_logo_url?: string | null
          company_name?: string
          company_name_normalized?: string | null
          contacted_at?: string | null
          created_at?: string | null
          detected_at?: string | null
          detection_model_revision?: string | null
          detection_prompt_hash?: string | null
          detection_run_id?: string | null
          email_draft?: Json | null
          enrichment_status?: string | null
          estimated_size?: string | null
          event_detail?: string | null
          hook_suggestion?: string | null
          id?: string
          is_seed?: boolean
          logo_fetch_attempts?: number
          logo_fetch_status?: string | null
          logo_last_attempt_at?: string | null
          logo_manus_started_at?: string | null
          logo_manus_task_id?: string | null
          next_action_at?: string | null
          next_action_note?: string | null
          notes?: string | null
          pipeline_status?: string
          pipeline_updated_at?: string | null
          revenue?: number | null
          revenue_source?: string | null
          score?: number
          sector?: string | null
          signal_type?: string
          source_name?: string | null
          source_url?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "raw_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_detection_run_id_fkey"
            columns: ["detection_run_id"]
            isOneToOne: false
            referencedRelation: "scan_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tonal_charter: {
        Row: {
          charter_data: Json
          confidence_score: number
          corrections_count: number
          created_at: string
          id: string
          is_learning_enabled: boolean
          last_analysis_at: string | null
          updated_at: string
        }
        Insert: {
          charter_data?: Json
          confidence_score?: number
          corrections_count?: number
          created_at?: string
          id?: string
          is_learning_enabled?: boolean
          last_analysis_at?: string | null
          updated_at?: string
        }
        Update: {
          charter_data?: Json
          confidence_score?: number
          corrections_count?: number
          created_at?: string
          id?: string
          is_learning_enabled?: boolean
          last_analysis_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tonal_charter_analysis_runs: {
        Row: {
          attempt: number
          cohort_key: string
          completed_at: string | null
          dispatched_at: string | null
          error_message: string | null
          feedback_available: number
          feedback_count: number
          feedback_ids: string[]
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          model: string
          provider_request_key: string | null
          reconciliation: Json | null
          reserved_at: string | null
          response_cached_at: string | null
          response_payload: Json | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          cohort_key: string
          completed_at?: string | null
          dispatched_at?: string | null
          error_message?: string | null
          feedback_available: number
          feedback_count: number
          feedback_ids: string[]
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model: string
          provider_request_key?: string | null
          reconciliation?: Json | null
          reserved_at?: string | null
          response_cached_at?: string | null
          response_payload?: Json | null
          started_at?: string
          status: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          cohort_key?: string
          completed_at?: string | null
          dispatched_at?: string | null
          error_message?: string | null
          feedback_available?: number
          feedback_count?: number
          feedback_ids?: string[]
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model?: string
          provider_request_key?: string | null
          reconciliation?: Json | null
          reserved_at?: string | null
          response_cached_at?: string | null
          response_payload?: Json | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      acquisition_run_cost_metrics: {
        Row: {
          completed_at: string | null
          cost_per_created_signal: number | null
          currency: string | null
          fully_priced: boolean | null
          provider_event_count: number | null
          provider_request_count: number | null
          provider_units: number | null
          run_id: string | null
          signals_created: number | null
          source: string | null
          started_at: string | null
          status: string | null
          total_cost: number | null
          unpriced_event_count: number | null
        }
        Relationships: []
      }
      cron_state_live: {
        Row: {
          description: string | null
          enabled: boolean | null
          job_name: string | null
          last_error: string | null
          last_run_at: string | null
          last_run_duration_ms: number | null
          last_run_status: string | null
          next_run_at: string | null
          schedule: string | null
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          enabled?: boolean | null
          job_name?: string | null
          last_error?: string | null
          last_run_at?: string | null
          last_run_duration_ms?: number | null
          last_run_status?: string | null
          next_run_at?: never
          schedule?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          enabled?: boolean | null
          job_name?: string | null
          last_error?: string | null
          last_run_at?: string | null
          last_run_duration_ms?: number | null
          last_run_status?: string | null
          next_run_at?: never
          schedule?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dropcontact_balance_metrics: {
        Row: {
          balance_age_seconds: number | null
          balance_observation_count: number | null
          balance_observed_at: string | null
          credits_left: number | null
          event_count: number | null
          items_count: number | null
          latest_call_at: string | null
          latest_call_error_code: string | null
          latest_call_operation: string | null
          latest_call_reported_balance: boolean | null
          latest_call_success: boolean | null
          measurement_started_at: string | null
          measurement_status: string | null
          provider: string | null
          request_count: number | null
          successful_event_count: number | null
        }
        Relationships: []
      }
      email_delivery_metrics: {
        Row: {
          bounce_rate: number | null
          bounced: number | null
          complained: number | null
          complaint_rate: number | null
          converted_proxy_contacts: number | null
          crm_conversion_proxy_rate: number | null
          crm_response_proxy_rate: number | null
          delivered: number | null
          delivered_contacts: number | null
          delivery_rate: number | null
          failed: number | null
          measured_at: string | null
          provider_accepted: number | null
          provider_tracked_replies: number | null
          queued_or_attempted: number | null
          response_proxy_contacts: number | null
          suppressed: number | null
          tracked_reply_rate: number | null
        }
        Relationships: []
      }
      enrichment_backlog: {
        Row: {
          a_une_fiche: boolean | null
          company_name: string | null
          detected_at: string | null
          id: string | null
          jours_d_attente: number | null
          score: number | null
          situation: string | null
          source_name: string | null
        }
        Insert: {
          a_une_fiche?: never
          company_name?: string | null
          detected_at?: string | null
          id?: string | null
          jours_d_attente?: never
          score?: number | null
          situation?: never
          source_name?: string | null
        }
        Update: {
          a_une_fiche?: never
          company_name?: string | null
          detected_at?: string | null
          id?: string | null
          jours_d_attente?: never
          score?: number | null
          situation?: never
          source_name?: string | null
        }
        Relationships: []
      }
      enrichment_queue_stats: {
        Row: {
          completed_last_hour: number | null
          failed_last_hour: number | null
          oldest_pending: string | null
          pending: number | null
          running: number | null
        }
        Relationships: []
      }
      enrichment_resolution_metrics: {
        Row: {
          companies_ambiguous: number | null
          companies_rejected: number | null
          companies_resolved: number | null
          company_attempts_with_operational_profile: number | null
          company_correct: number | null
          company_labelled: number | null
          company_labelled_accuracy: number | null
          company_resolution_rate_per_technical_completion: number | null
          company_technical_completed: number | null
          company_technical_failed: number | null
          company_workflow_attempts: number | null
          contact_candidates_ambiguous: number | null
          contact_candidates_rejected: number | null
          contact_candidates_resolved: number | null
          contact_correct: number | null
          contact_labelled: number | null
          contact_labelled_accuracy: number | null
          email_verification_not_attempted: number | null
          emails_not_found: number | null
          emails_rejected: number | null
          emails_verified: number | null
          measured_at: string | null
          operational_profile_company_rate: number | null
          operational_profiles: number | null
          technical_success_rate: number | null
          verified_email_rate_per_attempt: number | null
        }
        Relationships: []
      }
      enrichment_sweep_readiness: {
        Row: {
          apify_restant: number | null
          candidats: number | null
          dose: number | null
          dropcontact_restant: number | null
          reserve_apify: number | null
          reserve_dropcontact: number | null
          verdict: string | null
        }
        Relationships: []
      }
      personas_health: {
        Row: {
          cle: string | null
          fonctions: number | null
          prioritaires: number | null
          verdict: string | null
        }
        Relationships: []
      }
      pipeline_health: {
        Row: {
          chaine: string | null
          derniere_execution: string | null
          executions: number | null
          produit: number | null
          rendement_pct: number | null
          verdict: string | null
        }
        Relationships: []
      }
      press_article_backlog_metrics: {
        Row: {
          dead_lettered: number | null
          exhausted_orphan: number | null
          in_flight: number | null
          max_attempt_count: number | null
          measured_at: string | null
          next_retry_at: string | null
          operational_max_attempts: number | null
          operational_stale_after: string | null
          ready: number | null
          retry_waiting: number | null
        }
        Relationships: []
      }
      press_detection_quality_metrics: {
        Row: {
          correct_predictions: number | null
          current_integrity_mismatches: number | null
          current_match_integrity_mismatches: number | null
          dataset_version: string | null
          expected_opportunities: number | null
          incorrect_predictions: number | null
          labelled_precision: number | null
          labelled_predictions: number | null
          labelled_recall: number | null
          matched_opportunities: number | null
          measured_at: string | null
          model_revision: string | null
          prompt_hash: string | null
          sampling_method: string | null
          uncertain_predictions: number | null
        }
        Relationships: []
      }
      provider_dispatch_uncertainty: {
        Row: {
          business_key: string | null
          contact_id: string | null
          error_code: string | null
          id: string | null
          metadata: Json | null
          occurred_at: string | null
          operation: string | null
          provider: string | null
          request_key: string | null
          run_id: string | null
          signal_id: string | null
        }
        Insert: {
          business_key?: string | null
          contact_id?: string | null
          error_code?: string | null
          id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          operation?: string | null
          provider?: string | null
          request_key?: string | null
          run_id?: string | null
          signal_id?: string | null
        }
        Update: {
          business_key?: string | null
          contact_id?: string | null
          error_code?: string | null
          id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          operation?: string | null
          provider?: string | null
          request_key?: string | null
          run_id?: string | null
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_signal_cost_metrics: {
        Row: {
          event_count: number | null
          fully_priced: boolean | null
          measured_cost: number | null
          measured_currency: string | null
          priced_event_count: number | null
          provider: string | null
          request_count: number | null
          signal_id: string | null
          total_cost: number | null
          units: number | null
          unpriced_event_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage_costed: {
        Row: {
          applied_rate_id: string | null
          contact_id: string | null
          cost_amount: number | null
          cost_source: string | null
          created_at: string | null
          currency: string | null
          effective_cost_amount: number | null
          effective_cost_source: string | null
          effective_currency: string | null
          error_code: string | null
          id: string | null
          is_estimated: boolean | null
          is_priced: boolean | null
          items_count: number | null
          metadata: Json | null
          occurred_at: string | null
          operation: string | null
          provider: string | null
          query_id: string | null
          request_key: string | null
          requests_count: number | null
          run_id: string | null
          signal_id: string | null
          success: boolean | null
          units: number | null
        }
        Insert: {
          applied_rate_id?: string | null
          contact_id?: string | null
          cost_amount?: number | null
          cost_source?: string | null
          created_at?: string | null
          currency?: string | null
          effective_cost_amount?: number | null
          effective_cost_source?: string | null
          effective_currency?: string | null
          error_code?: string | null
          id?: string | null
          is_estimated?: never
          is_priced?: never
          items_count?: number | null
          metadata?: Json | null
          occurred_at?: string | null
          operation?: string | null
          provider?: string | null
          query_id?: string | null
          request_key?: string | null
          requests_count?: number | null
          run_id?: string | null
          signal_id?: string | null
          success?: boolean | null
          units?: number | null
        }
        Update: {
          applied_rate_id?: string | null
          contact_id?: string | null
          cost_amount?: number | null
          cost_source?: string | null
          created_at?: string | null
          currency?: string | null
          effective_cost_amount?: number | null
          effective_cost_source?: string | null
          effective_currency?: string | null
          error_code?: string | null
          id?: string | null
          is_estimated?: never
          is_priced?: never
          items_count?: number | null
          metadata?: Json | null
          occurred_at?: string | null
          operation?: string | null
          provider?: string | null
          query_id?: string | null
          request_key?: string | null
          requests_count?: number | null
          run_id?: string | null
          signal_id?: string | null
          success?: boolean | null
          units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_events_applied_rate_id_fkey"
            columns: ["applied_rate_id"]
            isOneToOne: false
            referencedRelation: "provider_cost_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "enrichment_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage_daily_metrics: {
        Row: {
          currency: string | null
          event_count: number | null
          fully_priced: boolean | null
          items: number | null
          operation: string | null
          provider: string | null
          request_count: number | null
          successful_event_count: number | null
          total_cost: number | null
          units: number | null
          unpriced_event_count: number | null
          usage_date: string | null
        }
        Relationships: []
      }
      resolution_quality_metrics_by_dataset: {
        Row: {
          algorithm_revision: string | null
          correct: number | null
          dataset_version: string | null
          incorrect: number | null
          labelled: number | null
          labelled_accuracy: number | null
          sampling_method: string | null
          subject_type: string | null
          uncertain: number | null
        }
        Relationships: []
      }
      seed_data_count: {
        Row: {
          company_enrichment: number | null
          contacts: number | null
          linkedin_engagers: number | null
          pappers_signals: number | null
          signals: number | null
        }
        Relationships: []
      }
      signal_expiry_preview: {
        Row: {
          archiverait: number | null
          horizon_jours: number | null
          preserverait_car_ont_des_contacts: number | null
          signaux_actifs: number | null
        }
        Relationships: []
      }
      signals_grouped_by_company: {
        Row: {
          already_contacted: boolean | null
          commercially_contacted: boolean | null
          company_key: string | null
          company_name: string | null
          last_signal_at: string | null
          max_score: number | null
          signal_ids: string[] | null
          signal_types: string[] | null
          signals_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_provider_cost_rate: {
        Args: {
          p_currency: string
          p_effective_from: string
          p_evidence?: Json
          p_operation: string
          p_provider: string
          p_source: string
          p_unit_price: number
        }
        Returns: string
      }
      apify_actor_run_quota_status: { Args: { p_at?: string }; Returns: Json }
      apply_internal_access_cutover: { Args: never; Returns: Json }
      apply_resend_email_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
          p_provider_message_id: string
          p_status: string
        }
        Returns: Json
      }
      authorize_enrichment_regeneration: {
        Args: {
          p_authorized_by?: string
          p_reason: string
          p_signal_id: string
        }
        Returns: Json
      }
      begin_enrichment_dispatch: {
        Args: {
          p_company_name: string
          p_enrichment_source: string
          p_job_id: string
          p_lease_token: string
          p_signal_id: string
        }
        Returns: Json
      }
      begin_tonal_charter_dispatch: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_provider_request_key: string
          p_run_id: string
        }
        Returns: boolean
      }
      bind_enrichment_job_route: {
        Args: {
          p_job_id: string
          p_lease_token: string
          p_requested_route: string
        }
        Returns: string
      }
      cache_tonal_charter_analysis_response: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_provider_request_key: string
          p_response_payload: Json
          p_run_id: string
        }
        Returns: boolean
      }
      claim_enrichment_job_poll: {
        Args: {
          p_job_id: string
          p_lease_seconds?: number
          p_lease_token: string
          p_poll_seconds?: number
        }
        Returns: string
      }
      claim_pappers_scan: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_scan_id: string
        }
        Returns: Json
      }
      claim_press_articles: {
        Args: {
          p_limit?: number
          p_max_attempts?: number
          p_stale_after?: string
        }
        Returns: {
          attempt_count: number
          author: string | null
          claim_token: string | null
          claimed_at: string | null
          content: string | null
          created_at: string | null
          dead_letter_reason: string | null
          dead_lettered_at: string | null
          description: string | null
          fetched_at: string | null
          geo_zone_id: string | null
          id: string
          image_url: string | null
          last_error: string | null
          next_retry_at: string | null
          processed: boolean | null
          published_at: string | null
          query_id: string | null
          source_name: string | null
          title: string
          url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "raw_articles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_press_scan: {
        Args: {
          p_lease_seconds?: number
          p_lease_token?: string
          p_scan_log_id?: string
        }
        Returns: Json
      }
      claim_tonal_charter_analysis: {
        Args: {
          p_cohort_key: string
          p_feedback_available: number
          p_feedback_ids: string[]
          p_lease_seconds?: number
          p_model: string
        }
        Returns: Json
      }
      claim_tracked_email: {
        Args: { p_message_id: string; p_stale_after_seconds?: number }
        Returns: string
      }
      cleanup_operational_history: { Args: never; Returns: Json }
      complete_apify_actor_run: {
        Args: {
          p_error_code?: string
          p_http_status?: number
          p_items_count?: number
          p_metadata?: Json
          p_provider_request_id?: string
          p_request_key: string
          p_success: boolean
        }
        Returns: Json
      }
      complete_enrichment_dispatch: {
        Args: {
          p_company_patch: Json
          p_contacts?: Json
          p_enrichment_id: string
          p_job_id: string
          p_lease_token: string
        }
        Returns: Json
      }
      complete_newsapi_request: {
        Args: {
          p_error_code?: string
          p_http_status?: number
          p_items_count: number
          p_metadata?: Json
          p_request_key: string
          p_success: boolean
        }
        Returns: string
      }
      complete_pappers_company_credit: {
        Args: {
          p_error_code?: string
          p_http_status?: number
          p_request_key: string
          p_run_id: string
          p_signal_id: string
          p_success: boolean
          p_usage_id: string
        }
        Returns: undefined
      }
      complete_pappers_credits: {
        Args: {
          p_actual_credits: number
          p_attempted_at?: string
          p_error_code?: string
          p_http_status?: number
          p_items_count: number
          p_metadata?: Json
          p_request_key: string
          p_success: boolean
          p_usage_id: string
        }
        Returns: Json
      }
      complete_pappers_search_request: {
        Args: {
          p_actual_credits: number
          p_attempted_at: string
          p_cursor: Json
          p_http_status: number
          p_items_count: number
          p_lease_seconds?: number
          p_lease_token: string
          p_metadata: Json
          p_payload: Json
          p_request_key: string
          p_scan_id: string
          p_usage_id: string
        }
        Returns: Json
      }
      complete_press_articles: {
        Args: { p_article_ids: string[]; p_claim_token: string }
        Returns: number
      }
      complete_tonal_charter_analysis: {
        Args: {
          p_charter_data: Json
          p_confidence_score: number
          p_feedback_available: number
          p_lease_token: string
          p_run_id: string
        }
        Returns: Json
      }
      complete_tracked_email: {
        Args: { p_message_id: string; p_provider_message_id: string }
        Returns: boolean
      }
      compute_next_cron_run: {
        Args: { p_from?: string; p_schedule: string }
        Returns: string
      }
      configure_gourrmet_runtime_crons: {
        Args: { p_domains?: string[]; p_enable?: boolean }
        Returns: Json
      }
      configure_pappers_recovery_cron: {
        Args: { p_enable?: boolean }
        Returns: Json
      }
      contact_enrichment_retry_blocker: {
        Args: { p_signal_id: string }
        Returns: string
      }
      cron_state_run_end: {
        Args: {
          p_duration_ms?: number
          p_error?: string
          p_job_name: string
          p_status: string
        }
        Returns: undefined
      }
      cron_state_run_start: { Args: { p_job_name: string }; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_pappers_scan: { Args: { p_scan_id: string }; Returns: undefined }
      dequeue_enrichment_job: {
        Args: {
          p_lease_seconds?: number
          p_max_concurrency?: number
          p_worker_id?: string
        }
        Returns: {
          attempts: number
          created_at: string
          error_message: string | null
          external_task_id: string | null
          finished_at: string | null
          id: string
          job_type: string
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          max_attempts: number
          next_retry_at: string | null
          poll_expires_at: string | null
          poll_token: string | null
          priority: number
          queued_at: string
          result: Json | null
          signal_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "enrichment_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      drain_enrichment_backlog: {
        Args: { p_authorized_by?: string; p_limit: number; p_reason: string }
        Returns: Json
      }
      dropcontact_balance_status: { Args: never; Returns: Json }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_eligible_enrichment_batch: {
        Args: { p_batch_size?: number; p_min_score: number }
        Returns: Json
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_enrichment_job: {
        Args: {
          p_cooldown_seconds?: number
          p_job_type?: string
          p_priority?: number
          p_signal_id: string
        }
        Returns: Json
      }
      enqueue_enrichment_job_authorized: {
        Args: {
          p_allow_terminal_retry?: boolean
          p_cooldown_seconds?: number
          p_job_type?: string
          p_priority?: number
          p_signal_id: string
        }
        Returns: Json
      }
      enqueue_tracked_email: {
        Args: {
          p_body: string
          p_contact_id: string
          p_idempotency_key: string
          p_message_id: string
          p_metadata: Json
          p_payload: Json
          p_provider: string
          p_recipient_email: string
          p_request_fingerprint: string
          p_sender_email: string
          p_signal_id: string
          p_subject: string
          p_template_name: string
          p_user_id: string
        }
        Returns: Json
      }
      enrichment_batch_status: { Args: { p_min_score: number }; Returns: Json }
      enrichment_contact_identity: {
        Args: { p_first_name: string; p_full_name: string; p_last_name: string }
        Returns: string
      }
      expire_stale_signals: {
        Args: { p_dry_run?: boolean; p_horizon_days?: number }
        Returns: Json
      }
      fail_press_articles: {
        Args: {
          p_article_ids?: string[]
          p_claim_token: string
          p_error: string
          p_max_attempts?: number
        }
        Returns: number
      }
      fail_tonal_charter_analysis: {
        Args: { p_error: string; p_lease_token: string; p_run_id: string }
        Returns: boolean
      }
      fail_tracked_email: {
        Args: { p_error_message: string; p_message_id: string }
        Returns: boolean
      }
      finalize_linkedin_enrichment_poll: {
        Args: {
          p_company_raw_data: Json
          p_contacts?: Json
          p_enrichment_id: string
          p_error_message?: string
          p_job_id: string
          p_lease_token: string
          p_operational_profiles_count: number
          p_poll_token: string
          p_resolution_attempted_at: string
          p_resolution_technical_status: string
          p_result?: Json
          p_signal_id: string
          p_status: string
        }
        Returns: Json
      }
      find_company_dupes: {
        Args: { p_company_name: string; p_similarity_threshold?: number }
        Returns: {
          company_name: string
          detected_at: string
          signal_id: string
          similarity: number
        }[]
      }
      get_pappers_quota_status: { Args: never; Returns: Json }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      handoff_pappers_scan: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_scan_id: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heartbeat_pappers_scan: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_scan_id: string
        }
        Returns: boolean
      }
      immutable_unaccent: { Args: { "": string }; Returns: string }
      is_internal_user: { Args: { _user_id?: string }; Returns: boolean }
      is_opaque_linkedin_url: { Args: { p_url: string }; Returns: boolean }
      latest_dropcontact_credits: { Args: never; Returns: number }
      mark_apify_actor_run_dispatched: {
        Args: { p_request_key: string }
        Returns: boolean
      }
      mark_pappers_request_dispatched: {
        Args: {
          p_cursor: Json
          p_lease_seconds?: number
          p_lease_token: string
          p_request_key: string
          p_scan_id: string
          p_usage_id: string
        }
        Returns: boolean
      }
      mark_pappers_signal_processed: {
        Args: { p_pappers_signal_id: string }
        Returns: undefined
      }
      merge_enrichment_contacts: {
        Args: { p_contacts: Json; p_enrichment_id: string; p_signal_id: string }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      newsapi_quota_status: {
        Args: { p_at?: string; p_daily_limit: number }
        Returns: Json
      }
      normalize_company_label: { Args: { p_value: string }; Returns: string }
      pappers_execution_snapshot: {
        Args: { p_query_id?: string }
        Returns: Json
      }
      pappers_scan_has_ambiguous_request: {
        Args: { p_scan_id: string }
        Returns: boolean
      }
      pipeline_health_summary: { Args: never; Returns: string }
      presse_maintenance_report: { Args: never; Returns: Json }
      presse_provenance_report: { Args: never; Returns: Json }
      presse_purge_fake_contacts_and_relaunch: {
        Args: {
          p_dry_run?: boolean
          p_min_companies?: number
          p_min_score?: number
        }
        Returns: Json
      }
      presse_relaunch_contacts: { Args: { p_dry_run?: boolean }; Returns: Json }
      presse_resolve_problemes: { Args: { p_dry_run?: boolean }; Returns: Json }
      presse_wipe_mocks: { Args: { p_dry_run?: boolean }; Returns: Json }
      presse_wipe_unscraped: { Args: { p_dry_run?: boolean }; Returns: Json }
      provider_calls_pulse_24h: {
        Args: never
        Returns: {
          derniere_execution: string
          executions: number
          produit: number
        }[]
      }
      provider_signal_cost_status: {
        Args: { p_signal_id?: string }
        Returns: {
          event_count: number
          fully_priced: boolean
          measured_cost: number
          measured_currency: string
          priced_event_count: number
          provider: string
          request_count: number
          signal_id: string
          total_cost: number
          units: number
          unpriced_event_count: number
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reconcile_resend_email_events: {
        Args: { p_provider_message_id: string }
        Returns: number
      }
      recover_pappers_scan: {
        Args: { p_lease_seconds?: number }
        Returns: Json
      }
      relaunch_failed_enrichments: {
        Args: {
          p_days?: number
          p_dry_run?: boolean
          p_limit?: number
          p_min_score?: number
        }
        Returns: Json
      }
      release_enrichment_job_poll: {
        Args: { p_job_id: string; p_lease_token: string; p_poll_token: string }
        Returns: boolean
      }
      release_press_articles: {
        Args: { p_claim_token: string }
        Returns: number
      }
      reserve_apify_actor_run: {
        Args: {
          p_metadata?: Json
          p_operation: string
          p_request_key: string
          p_run_id: string
          p_signal_id: string
        }
        Returns: Json
      }
      reserve_newsapi_request: {
        Args: {
          p_daily_limit: number
          p_metadata: Json
          p_occurred_at: string
          p_query_id: string
          p_request_key: string
          p_run_id: string
        }
        Returns: Json
      }
      reserve_pappers_company_credit: {
        Args: { p_request_key: string; p_run_id: string; p_signal_id: string }
        Returns: Json
      }
      reserve_pappers_credits: {
        Args: {
          p_metadata?: Json
          p_operation: string
          p_query_id?: string
          p_request_key: string
          p_reserved_credits: number
          p_run_id?: string
          p_scan_id?: string
          p_signal_id?: string
        }
        Returns: Json
      }
      reset_tonal_charter: { Args: never; Returns: Json }
      resume_pappers_scan: {
        Args: { p_lease_seconds?: number; p_scan_id: string }
        Returns: Json
      }
      review_press_expected_opportunity: {
        Args: {
          p_dataset_version: string
          p_evidence?: Json
          p_expected_company_name: string
          p_expected_signal_type: string
          p_matched_signal_id: string
          p_model_revision: string
          p_prompt_hash: string
          p_raw_article_id: string
          p_sampling_method: string
        }
        Returns: string
      }
      review_press_signal: {
        Args: {
          p_dataset_version: string
          p_evidence?: Json
          p_sampling_method: string
          p_signal_id: string
          p_verdict: string
        }
        Returns: string
      }
      review_resolution_subject: {
        Args: {
          p_dataset_version: string
          p_evidence?: Json
          p_sampling_method: string
          p_subject_id: string
          p_subject_type: string
          p_verdict: string
        }
        Returns: string
      }
      select_logo_candidates: {
        Args: {
          p_backoff_hours?: number
          p_limit?: number
          p_max_attempts?: number
          p_min_score?: number
        }
        Returns: {
          company_name: string
          enrichment_domain: string
          enrichment_website: string
          id: string
          logo_fetch_attempts: number
          selection_reason: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_pappers_scan: {
        Args: {
          p_lease_seconds?: number
          p_query_id?: string
          p_scan_type?: string
        }
        Returns: Json
      }
      sweep_enrichment_famine: { Args: { p_dose?: number }; Returns: Json }
      sync_tonal_charter_feedback_state: {
        Args: { p_threshold?: number }
        Returns: Json
      }
      transfer_and_enqueue_pappers_signal: {
        Args: { p_pappers_signal_id: string }
        Returns: Json
      }
      transfer_pappers_signal: {
        Args: { p_pappers_signal_id: string }
        Returns: {
          article_id: string | null
          company_logo_url: string | null
          company_name: string
          company_name_normalized: string | null
          contacted_at: string | null
          created_at: string | null
          detected_at: string | null
          detection_model_revision: string | null
          detection_prompt_hash: string | null
          detection_run_id: string | null
          email_draft: Json | null
          enrichment_status: string | null
          estimated_size: string | null
          event_detail: string | null
          hook_suggestion: string | null
          id: string
          is_seed: boolean
          logo_fetch_attempts: number
          logo_fetch_status: string | null
          logo_last_attempt_at: string | null
          logo_manus_started_at: string | null
          logo_manus_task_id: string | null
          next_action_at: string | null
          next_action_note: string | null
          notes: string | null
          pipeline_status: string
          pipeline_updated_at: string | null
          revenue: number | null
          revenue_source: string | null
          score: number
          sector: string | null
          signal_type: string
          source_name: string | null
          source_url: string | null
          status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "signals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_tracked_email_status: {
        Args: { p_email_id: string; p_occurred_at?: string; p_status: string }
        Returns: string
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_enrichment_dispatch: {
        Args: {
          p_company_patch: Json
          p_enrichment_id: string
          p_expected_status?: string
          p_job_id: string
          p_lease_token: string
          p_signal_status?: string
        }
        Returns: boolean
      }
      update_linkedin_enrichment_poll: {
        Args: {
          p_contact_candidates_ambiguous?: number
          p_contact_candidates_rejected?: number
          p_contact_candidates_resolved?: number
          p_contact_resolution_measured_at?: string
          p_enrichment_id: string
          p_expected_status: string
          p_job_id: string
          p_lease_token: string
          p_new_status?: string
          p_operational_profiles_count?: number
          p_poll_token: string
          p_raw_data?: Json
          p_resolution_attempted_at?: string
        }
        Returns: boolean
      }
      wipe_seed_data: {
        Args: never
        Returns: {
          rows_deleted: number
          table_name: string
        }[]
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "admin", "user"],
    },
  },
} as const
