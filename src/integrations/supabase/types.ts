export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      apify_credit_usage: {
        Row: {
          created_at: string | null
          credits_used: number | null
          date: string | null
          details: Json | null
          id: string
          post_id: string | null
          scrapes_count: number | null
          signal_id: string | null
          source: string | null
        }
        Insert: {
          created_at?: string | null
          credits_used?: number | null
          date?: string | null
          details?: Json | null
          id?: string
          post_id?: string | null
          scrapes_count?: number | null
          signal_id?: string | null
          source?: string | null
        }
        Update: {
          created_at?: string | null
          credits_used?: number | null
          date?: string | null
          details?: Json | null
          id?: string
          post_id?: string | null
          scrapes_count?: number | null
          signal_id?: string | null
          source?: string | null
        }
        Relationships: []
      }
      geo_zones: {
        Row: {
          cities: string[]
          color: string | null
          created_at: string | null
          departments: string[]
          id: string
          is_active: boolean | null
          is_default_priority: boolean | null
          name: string
          postal_prefixes: string[]
          priority: number
          regions: string[]
          slug: string
          updated_at: string | null
        }
        Insert: {
          cities?: string[]
          color?: string | null
          created_at?: string | null
          departments?: string[]
          id?: string
          is_active?: boolean | null
          is_default_priority?: boolean | null
          name: string
          postal_prefixes?: string[]
          priority?: number
          regions?: string[]
          slug: string
          updated_at?: string | null
        }
        Update: {
          cities?: string[]
          color?: string | null
          created_at?: string | null
          departments?: string[]
          id?: string
          is_active?: boolean | null
          is_default_priority?: boolean | null
          name?: string
          postal_prefixes?: string[]
          priority?: number
          regions?: string[]
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      linkedin_engagers: {
        Row: {
          comment_text: string | null
          company: string | null
          contact_id: string | null
          created_at: string | null
          detected_city: string | null
          detected_region: string | null
          engagement_type: string
          geo_priority: number | null
          geo_zone_id: string | null
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
          detected_city?: string | null
          detected_region?: string | null
          engagement_type: string
          geo_priority?: number | null
          geo_zone_id?: string | null
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
          detected_city?: string | null
          detected_region?: string | null
          engagement_type?: string
          geo_priority?: number | null
          geo_zone_id?: string | null
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
        Relationships: []
      }
      linkedin_posts: {
        Row: {
          comments_count: number | null
          content: string | null
          created_at: string | null
          detected_city: string | null
          detected_department: string | null
          detected_region: string | null
          geo_priority: number | null
          geo_zone_id: string | null
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
          detected_city?: string | null
          detected_department?: string | null
          detected_region?: string | null
          geo_priority?: number | null
          geo_zone_id?: string | null
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
          detected_city?: string | null
          detected_department?: string | null
          detected_region?: string | null
          geo_priority?: number | null
          geo_zone_id?: string | null
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
        Relationships: []
      }
      pappers_signals: {
        Row: {
          company_data: Json | null
          company_name: string
          created_at: string | null
          detected_at: string | null
          detected_city: string | null
          detected_department: string | null
          detected_postal_code: string | null
          detected_region: string | null
          geo_priority: number | null
          geo_zone_id: string | null
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
          detected_city?: string | null
          detected_department?: string | null
          detected_postal_code?: string | null
          detected_region?: string | null
          geo_priority?: number | null
          geo_zone_id?: string | null
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
          detected_city?: string | null
          detected_department?: string | null
          detected_postal_code?: string | null
          detected_region?: string | null
          geo_priority?: number | null
          geo_zone_id?: string | null
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
        Relationships: []
      }
      raw_articles: {
        Row: {
          author: string | null
          content: string | null
          created_at: string | null
          description: string | null
          detected_city: string | null
          detected_department: string | null
          detected_postal_code: string | null
          detected_region: string | null
          fetched_at: string | null
          geo_priority: number | null
          geo_zone_id: string | null
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
          detected_city?: string | null
          detected_department?: string | null
          detected_postal_code?: string | null
          detected_region?: string | null
          fetched_at?: string | null
          geo_priority?: number | null
          geo_zone_id?: string | null
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
          detected_city?: string | null
          detected_department?: string | null
          detected_postal_code?: string | null
          detected_region?: string | null
          fetched_at?: string | null
          geo_priority?: number | null
          geo_zone_id?: string | null
          id?: string
          image_url?: string | null
          processed?: boolean | null
          published_at?: string | null
          query_id?: string | null
          source_name?: string | null
          title?: string
          url?: string
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
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      detect_geo_zone: {
        Args: {
          p_city?: string
          p_department?: string
          p_postal_code?: string
          p_region?: string
        }
        Returns: {
          zone_color: string
          zone_id: string
          zone_name: string
          zone_priority: number
          zone_slug: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof Database
}
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof Database
}
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof Database
}
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof Database
}
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof Database
}
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
