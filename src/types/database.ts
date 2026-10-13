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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      action_sources: {
        Row: {
          action_id: string
          created_at: string
          evidence_locator: Json
          evidence_text: string
          id: string
          is_current: boolean
          item_id: string
          observed_at: string
          observed_deadline_at: string | null
          observed_deadline_date: string | null
          user_id: string
        }
        Insert: {
          action_id: string
          created_at?: string
          evidence_locator?: Json
          evidence_text: string
          id?: string
          is_current?: boolean
          item_id: string
          observed_at?: string
          observed_deadline_at?: string | null
          observed_deadline_date?: string | null
          user_id: string
        }
        Update: {
          action_id?: string
          created_at?: string
          evidence_locator?: Json
          evidence_text?: string
          id?: string
          is_current?: boolean
          item_id?: string
          observed_at?: string
          observed_deadline_at?: string | null
          observed_deadline_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_sources_action_user_fk"
            columns: ["action_id", "user_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "action_sources_item_user_fk"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "action_sources_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      actions: {
        Row: {
          origin: "source" | "manual"
          action_type: Database["public"]["Enums"]["action_type"]
          completed_at: string | null
          conditions: string[]
          created_at: string
          deadline_at: string | null
          deadline_date: string | null
          deadline_resolution_reason: string | null
          deadline_resolved_at: string | null
          deadline_source_id: string | null
          deadline_status: Database["public"]["Enums"]["deadline_status"]
          id: string
          requirements: string[]
          start_at: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["action_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          origin?: "source" | "manual"
          action_type: Database["public"]["Enums"]["action_type"]
          completed_at?: string | null
          conditions?: string[]
          created_at?: string
          deadline_at?: string | null
          deadline_date?: string | null
          deadline_resolution_reason?: string | null
          deadline_resolved_at?: string | null
          deadline_source_id?: string | null
          deadline_status?: Database["public"]["Enums"]["deadline_status"]
          id?: string
          requirements?: string[]
          start_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["action_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          origin?: "source" | "manual"
          action_type?: Database["public"]["Enums"]["action_type"]
          completed_at?: string | null
          conditions?: string[]
          created_at?: string
          deadline_at?: string | null
          deadline_date?: string | null
          deadline_resolution_reason?: string | null
          deadline_resolved_at?: string | null
          deadline_source_id?: string | null
          deadline_status?: Database["public"]["Enums"]["deadline_status"]
          id?: string
          requirements?: string[]
          start_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["action_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "actions_deadline_source_fk"
            columns: ["deadline_source_id"]
            isOneToOne: false
            referencedRelation: "action_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_user_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classifications: {
        Row: {
          ai_document_type: Database["public"]["Enums"]["document_type"] | null
          ai_primary_topic: string | null
          ai_tags: string[]
          created_at: string
          id: string
          item_id: string
          updated_at: string
          user_document_type:
            | Database["public"]["Enums"]["document_type"]
            | null
          user_edited_at: string | null
          user_id: string
          user_primary_topic: string | null
          user_tags: string[] | null
        }
        Insert: {
          ai_document_type?: Database["public"]["Enums"]["document_type"] | null
          ai_primary_topic?: string | null
          ai_tags?: string[]
          created_at?: string
          id?: string
          item_id: string
          updated_at?: string
          user_document_type?:
            | Database["public"]["Enums"]["document_type"]
            | null
          user_edited_at?: string | null
          user_id: string
          user_primary_topic?: string | null
          user_tags?: string[] | null
        }
        Update: {
          ai_document_type?: Database["public"]["Enums"]["document_type"] | null
          ai_primary_topic?: string | null
          ai_tags?: string[]
          created_at?: string
          id?: string
          item_id?: string
          updated_at?: string
          user_document_type?:
            | Database["public"]["Enums"]["document_type"]
            | null
          user_edited_at?: string | null
          user_id?: string
          user_primary_topic?: string | null
          user_tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "classifications_item_user_fk"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "classifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          account_email: string | null
          connected_at: string | null
          created_at: string
          disconnected_at: string | null
          id: string
          last_synced_at: string | null
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_account_id: string | null
          scopes: string[]
          status: Database["public"]["Enums"]["connection_status"]
          sync_state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          account_email?: string | null
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["connection_provider"]
          provider_account_id?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          sync_state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          account_email?: string | null
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["connection_provider"]
          provider_account_id?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          sync_state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          connection_id: string | null
          content_hash: string | null
          content_text: string | null
          created_at: string
          external_container_id: string | null
          external_id: string | null
          format: Database["public"]["Enums"]["item_format"]
          id: string
          metadata: Json
          mime_type: string | null
          original_url: string | null
          processing_error: string | null
          processing_status: Database["public"]["Enums"]["processing_status"]
          source: Database["public"]["Enums"]["item_source"]
          source_created_at: string | null
          source_updated_at: string | null
          storage_path: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          content_hash?: string | null
          content_text?: string | null
          created_at?: string
          external_container_id?: string | null
          external_id?: string | null
          format: Database["public"]["Enums"]["item_format"]
          id?: string
          metadata?: Json
          mime_type?: string | null
          original_url?: string | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          source: Database["public"]["Enums"]["item_source"]
          source_created_at?: string | null
          source_updated_at?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          content_hash?: string | null
          content_text?: string | null
          created_at?: string
          external_container_id?: string | null
          external_id?: string | null
          format?: Database["public"]["Enums"]["item_format"]
          id?: string
          metadata?: Json
          mime_type?: string | null
          original_url?: string | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          source?: Database["public"]["Enums"]["item_source"]
          source_created_at?: string | null
          source_updated_at?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_connection_user_fk"
            columns: ["connection_id", "user_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      search_chunks: {
        Row: {
          action_id: string | null
          chunk_index: number
          content: string
          content_tsv: unknown
          created_at: string
          embedding: string | null
          embedding_model: string | null
          embedding_version: string
          content_hash: string | null
          input_hash: string | null
          index_fingerprint: string | null
          metadata: Json
          id: string
          item_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_id?: string | null
          chunk_index: number
          content: string
          content_tsv?: unknown
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_version?: string
          content_hash?: string | null
          input_hash?: string | null
          index_fingerprint?: string | null
          metadata?: Json
          id?: string
          item_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_id?: string | null
          chunk_index?: number
          content?: string
          content_tsv?: unknown
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_version?: string
          content_hash?: string | null
          input_hash?: string | null
          index_fingerprint?: string | null
          metadata?: Json
          id?: string
          item_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_chunks_action_user_fk"
            columns: ["action_id", "user_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "search_chunks_item_user_fk"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "search_chunks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      upload_session_rpc: {
        Args: { p_operation: string; p_user_id: string; p_upload_id: string | null; p_key: string | null; p_request: Json | null; p_payload: Json | null; p_attempt: string | null }
        Returns: Json
      }
      upload_cleanup_candidates: {
        Args: Record<string, never>
        Returns: Json
      }
      assert_action_evidence: {
        Args: { p_action_id: string; p_user_id: string }
        Returns: undefined
      }
      disconnect_google_connection: {
        Args: { p_connection_id: string }
        Returns: boolean
      }
      get_google_connection_tokens: {
        Args: { p_connection_id: string; p_user_id: string }
        Returns: {
          access_token_ciphertext: string
          access_token_iv: string
          access_token_tag: string
          encryption_version: number
          refresh_token_ciphertext: string
          refresh_token_iv: string
          refresh_token_tag: string
          token_expires_at: string
        }[]
      }
      persist_gmail_item_analysis: {
        Args: {
          p_analysis: Json
          p_content_hash: string
          p_content_text: string
          p_input_fingerprint: string
          p_item_id: string
          p_model: string
          p_user_id: string
        }
        Returns: Json
      }
      persist_eligible_item_analysis: {
        Args: { p_user_id: string; p_item_id: string; p_content_text: string; p_content_hash: string | null; p_analysis: Json; p_model: string; p_input_fingerprint: string }
        Returns: Json
      }
      persist_drive_item: {
        Args: {
          p_user_id: string
          p_connection_id: string
          p_file_id: string
          p_title: string
          p_original_url: string
          p_content_text: string
          p_content_hash: string
          p_source_created_at: string
          p_source_updated_at: string
          p_drive_metadata: Json
          p_expected_item_updated_at: string | null
        }
        Returns: Json
      }
      persist_calendar_item: {
        Args: {
          p_user_id: string
          p_connection_id: string
          p_event_id: string
          p_title: string
          p_original_url: string | null
          p_content_text: string
          p_content_hash: string
          p_source_created_at: string | null
          p_source_updated_at: string | null
          p_calendar_metadata: Json
          p_expected_item_updated_at: string | null
        }
        Returns: Json
      }
      upgrade_google_calendar_scopes: {
        Args: Database["public"]["Functions"]["upgrade_google_connection_scopes"]["Args"]
        Returns: string
      }
      refresh_google_connection_tokens: {
        Args: {
          p_access_token_ciphertext: string
          p_access_token_iv: string
          p_access_token_tag: string
          p_connection_id: string
          p_encryption_version: number
          p_refresh_token_ciphertext: string
          p_refresh_token_iv: string
          p_refresh_token_tag: string
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: boolean
      }
      refresh_google_connection_tokens_guarded: {
        Args: Omit<Database["public"]["Functions"]["refresh_google_connection_tokens"]["Args"],
          "p_refresh_token_ciphertext" | "p_refresh_token_iv" | "p_refresh_token_tag"> & {
          p_expected_access_token_ciphertext: string
          p_refresh_token_ciphertext: string | null
          p_refresh_token_iv: string | null
          p_refresh_token_tag: string | null
        }
        Returns: boolean
      }
      upgrade_google_connection_scopes: {
        Args: Omit<Database["public"]["Functions"]["upsert_google_connection"]["Args"], "p_gmail_history_id"> & {
          p_connection_id: string
          p_expected_connection_updated_at: string
          p_expected_access_token_ciphertext: string
        }
        Returns: string
      }
      set_classification_override: {
        Args: {
          p_document_type: Database["public"]["Enums"]["document_type"] | null
          p_item_id: string
          p_primary_topic: string | null
          p_tags: string[] | null
        }
        Returns: undefined
      }
      upsert_ai_classification: {
        Args: {
          p_document_type: Database["public"]["Enums"]["document_type"]
          p_item_id: string
          p_primary_topic: string
          p_tags: string[]
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_google_connection: {
        Args: {
          p_access_token_ciphertext: string
          p_access_token_iv: string
          p_access_token_tag: string
          p_account_email: string
          p_encryption_version: number
          p_gmail_history_id: string
          p_provider_account_id: string
          p_refresh_token_ciphertext: string
          p_refresh_token_iv: string
          p_refresh_token_tag: string
          p_scopes: string[]
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      action_status: "open" | "completed"
      action_type: "required" | "optional" | "check"
      connection_provider: "google"
      connection_status: "connected" | "disconnected" | "error"
      deadline_status: "confirmed" | "needs_review" | "none"
      document_type:
        | "notice"
        | "application"
        | "contract"
        | "billing"
        | "reservation"
        | "certificate"
        | "schedule"
        | "general"
        | "other"
      item_format:
        | "email"
        | "pdf"
        | "image"
        | "screenshot"
        | "document"
        | "text"
        | "calendar_event"
        | "other"
      item_source: "gmail" | "drive" | "calendar" | "upload" | "manual"
      processing_status:
        | "uploaded"
        | "queued"
        | "extracting"
        | "analyzing"
        | "indexing"
        | "completed"
        | "failed"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      action_status: ["open", "completed"],
      action_type: ["required", "optional", "check"],
      connection_provider: ["google"],
      connection_status: ["connected", "disconnected", "error"],
      deadline_status: ["confirmed", "needs_review", "none"],
      document_type: [
        "notice",
        "application",
        "contract",
        "billing",
        "reservation",
        "certificate",
        "schedule",
        "general",
        "other",
      ],
      item_format: [
        "email",
        "pdf",
        "image",
        "screenshot",
        "document",
        "text",
        "calendar_event",
        "other",
      ],
      item_source: ["gmail", "drive", "calendar", "upload", "manual"],
      processing_status: [
        "uploaded",
        "queued",
        "extracting",
        "analyzing",
        "indexing",
        "completed",
        "failed",
      ],
    },
  },
} as const
