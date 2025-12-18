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
          enrichment_id: string
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
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          email_alternatif?: string | null
          email_principal?: string | null
          enrichment_id: string
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
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          email_alternatif?: string | null
          email_principal?: string | null
          enrichment_id?: string
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
