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
          plan_name: string
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
          plan_name?: string
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
          plan_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_enrichment: {
        Row: {
          company_name: string
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
          linkedin_company_url: string | null
          raw_data: Json | null
          signal_id: string
          status: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          company_name: string
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
          linkedin_company_url?: string | null
          raw_data?: Json | null
          signal_id: string
          status?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          company_name?: string
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
          linkedin_company_url?: string | null
          raw_data?: Json | null
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
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string | null
          department: string | null
          email_alternatif: string | null
          email_principal: string | null
          enrichment_id: string | null
          first_name: string | null
          full_name: string
          id: string
          is_priority_target: boolean | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          notes: string | null
          outreach_status: string | null
          phone: string | null
          priority_score: number | null
          raw_data: Json | null
          signal_id: string
          source: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          email_alternatif?: string | null
          email_principal?: string | null
          enrichment_id?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          is_priority_target?: boolean | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          priority_score?: number | null
          raw_data?: Json | null
          signal_id: string
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          email_alternatif?: string | null
          email_principal?: string | null
          enrichment_id?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          is_priority_target?: boolean | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          notes?: string | null
          outreach_status?: string | null
          phone?: string | null
          priority_score?: number | null
          raw_data?: Json | null
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
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
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
      linkedin_engagers: {
        Row: {
          comment_text: string | null
          company: string | null
          contact_id: string | null
          created_at: string | null
          engagement_type: string
          headline: string | null
          id: string
          is_prospect: boolean | null
          linkedin_url: string | null
          name: string
          post_id: string | null
          scraped_at: string | null
          transferred_to_contacts: boolean | null
          updated_at: string | null
        }
        Insert: {
          comment_text?: string | null
          company?: string | null
          contact_id?: string | null
          created_at?: string | null
          engagement_type: string
          headline?: string | null
          id?: string
          is_prospect?: boolean | null
          linkedin_url?: string | null
          name: string
          post_id?: string | null
          scraped_at?: string | null
          transferred_to_contacts?: boolean | null
          updated_at?: string | null
        }
        Update: {
          comment_text?: string | null
          company?: string | null
          contact_id?: string | null
          created_at?: string | null
          engagement_type?: string
          headline?: string | null
          id?: string
          is_prospect?: boolean | null
          linkedin_url?: string | null
          name?: string
          post_id?: string | null
          scraped_at?: string | null
          transferred_to_contacts?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
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
      pappers_credit_usage: {
        Row: {
          api_calls: number
          company_credits: number
          created_at: string
          credits_used: number
          date: string
          details: Json | null
          id: string
          query_id: string | null
          scan_id: string | null
          search_credits: number
        }
        Insert: {
          api_calls?: number
          company_credits?: number
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          id?: string
          query_id?: string | null
          scan_id?: string | null
          search_credits?: number
        }
        Update: {
          api_calls?: number
          company_credits?: number
          created_at?: string
          credits_used?: number
          date?: string
          details?: Json | null
          id?: string
          query_id?: string | null
          scan_id?: string | null
          search_credits?: number
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
      pappers_scan_progress: {
        Row: {
          anniversary_years: number | null
          completed_at: string | null
          created_at: string
          current_page: number
          date_creation_max: string | null
          date_creation_min: string | null
          error_message: string | null
          id: string
          last_cursor: string | null
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
          id?: string
          last_cursor?: string | null
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
          id?: string
          last_cursor?: string | null
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
          id: string
          processed: boolean | null
          query_id: string | null
          relevance_score: number | null
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
          id?: string
          processed?: boolean | null
          query_id?: string | null
          relevance_score?: number | null
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
          id?: string
          processed?: boolean | null
          query_id?: string | null
          relevance_score?: number | null
          signal_detail?: string | null
          signal_id?: string | null
          signal_type?: string
          siren?: string | null
          transferred_to_signals?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "pappers_signals_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "pappers_queries"
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
      raw_articles: {
        Row: {
          author: string | null
          content: string | null
          created_at: string | null
          description: string | null
          fetched_at: string | null
          id: string
          image_url: string | null
          processed: boolean | null
          published_at: string | null
          query_id: string | null
          source_name: string | null
          title: string
          url: string
        }
        Insert: {
          author?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          fetched_at?: string | null
          id?: string
          image_url?: string | null
          processed?: boolean | null
          published_at?: string | null
          query_id?: string | null
          source_name?: string | null
          title: string
          url: string
        }
        Update: {
          author?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          fetched_at?: string | null
          id?: string
          image_url?: string | null
          processed?: boolean | null
          published_at?: string | null
          query_id?: string | null
          source_name?: string | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_articles_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "search_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_logs: {
        Row: {
          articles_analyzed: number | null
          articles_fetched: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          signals_created: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          articles_analyzed?: number | null
          articles_fetched?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          signals_created?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          articles_analyzed?: number | null
          articles_fetched?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          signals_created?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
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
      signals: {
        Row: {
          article_id: string | null
          company_name: string
          contacted_at: string | null
          created_at: string | null
          detected_at: string | null
          enrichment_status: string | null
          estimated_size: string | null
          event_detail: string | null
          hook_suggestion: string | null
          id: string
          notes: string | null
          score: number
          sector: string | null
          signal_type: string
          source_name: string | null
          source_url: string | null
          status: string | null
        }
        Insert: {
          article_id?: string | null
          company_name: string
          contacted_at?: string | null
          created_at?: string | null
          detected_at?: string | null
          enrichment_status?: string | null
          estimated_size?: string | null
          event_detail?: string | null
          hook_suggestion?: string | null
          id?: string
          notes?: string | null
          score: number
          sector?: string | null
          signal_type: string
          source_name?: string | null
          source_url?: string | null
          status?: string | null
        }
        Update: {
          article_id?: string | null
          company_name?: string
          contacted_at?: string | null
          created_at?: string | null
          detected_at?: string | null
          enrichment_status?: string | null
          estimated_size?: string | null
          event_detail?: string | null
          hook_suggestion?: string | null
          id?: string
          notes?: string | null
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
