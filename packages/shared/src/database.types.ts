/* eslint-disable */
// -----------------------------------------------------------------------------
// GENERATED FILE — do not edit by hand.
// Source: supabase/migrations/*.sql
// Regenerate: pnpm db:types (Supabase CLI, needs the local stack running)
//          or pnpm db:types:offline (PGlite introspection, no Docker needed).
// -----------------------------------------------------------------------------

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          id: number
          tenant_id: string
          actor_id: string | null
          actor_email: string | null
          actor_type: string
          action: string
          entity_type: string
          entity_id: string | null
          before: Json | null
          after: Json | null
          ip: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: never
          tenant_id: string
          actor_id?: string | null
          actor_email?: string | null
          actor_type?: string
          action: string
          entity_type: string
          entity_id?: string | null
          before?: Json | null
          after?: Json | null
          ip?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          tenant_id?: string
          actor_id?: string | null
          actor_email?: string | null
          actor_type?: string
          action?: string
          entity_type?: string
          entity_id?: string | null
          before?: Json | null
          after?: Json | null
          ip?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_status: {
        Row: {
          connector_id: string
          version: string | null
          provider_mode: string
          sealing_key_id: string
          sealing_public_key: Json
          wg_server_public_key: string | null
          wg_endpoint: string | null
          wg_server_address: string | null
          started_at: string
          last_heartbeat_at: string
        }
        Insert: {
          connector_id: string
          version?: string | null
          provider_mode: string
          sealing_key_id: string
          sealing_public_key: Json
          wg_server_public_key?: string | null
          wg_endpoint?: string | null
          wg_server_address?: string | null
          started_at: string
          last_heartbeat_at: string
        }
        Update: {
          connector_id?: string
          version?: string | null
          provider_mode?: string
          sealing_key_id?: string
          sealing_public_key?: Json
          wg_server_public_key?: string | null
          wg_endpoint?: string | null
          wg_server_address?: string | null
          started_at?: string
          last_heartbeat_at?: string
        }
        Relationships: []
      }
      hotspot_profiles: {
        Row: {
          id: string
          tenant_id: string
          router_id: string
          mikrotik_id: string
          name: string
          rate_limit: string | null
          shared_users: number | null
          session_timeout_seconds: number | null
          idle_timeout_seconds: number | null
          keepalive_timeout_seconds: number | null
          address_pool: string | null
          is_default: boolean
          first_seen_at: string
          synced_at: string
          removed_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          router_id: string
          mikrotik_id: string
          name: string
          rate_limit?: string | null
          shared_users?: number | null
          session_timeout_seconds?: number | null
          idle_timeout_seconds?: number | null
          keepalive_timeout_seconds?: number | null
          address_pool?: string | null
          is_default?: boolean
          first_seen_at?: string
          synced_at?: string
          removed_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          router_id?: string
          mikrotik_id?: string
          name?: string
          rate_limit?: string | null
          shared_users?: number | null
          session_timeout_seconds?: number | null
          idle_timeout_seconds?: number | null
          keepalive_timeout_seconds?: number | null
          address_pool?: string | null
          is_default?: boolean
          first_seen_at?: string
          synced_at?: string
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotspot_profiles_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      hotspot_servers: {
        Row: {
          id: string
          tenant_id: string
          router_id: string
          mikrotik_id: string
          name: string
          interface: string | null
          address_pool: string | null
          profile: string | null
          disabled: boolean
          invalid: boolean
          first_seen_at: string
          synced_at: string
          removed_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          router_id: string
          mikrotik_id: string
          name: string
          interface?: string | null
          address_pool?: string | null
          profile?: string | null
          disabled?: boolean
          invalid?: boolean
          first_seen_at?: string
          synced_at?: string
          removed_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          router_id?: string
          mikrotik_id?: string
          name?: string
          interface?: string | null
          address_pool?: string | null
          profile?: string | null
          disabled?: boolean
          invalid?: boolean
          first_seen_at?: string
          synced_at?: string
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotspot_servers_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      invite_tokens: {
        Row: {
          invite_id: string
          token_hash: string
        }
        Insert: {
          invite_id: string
          token_hash: string
        }
        Update: {
          invite_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_tokens_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: true
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          id: string
          tenant_id: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
          invited_by: string | null
          expires_at: string
          accepted_at: string | null
          accepted_by: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
          invited_by?: string | null
          expires_at?: string
          accepted_at?: string | null
          accepted_by?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          email?: string
          role?: Database["public"]["Enums"]["app_role"]
          invited_by?: string | null
          expires_at?: string
          accepted_at?: string | null
          accepted_by?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_types: {
        Row: {
          type: string
          description: string
          destructive: boolean
          defer_when_offline: boolean
          max_attempts: number
          user_enqueueable: boolean
        }
        Insert: {
          type: string
          description: string
          destructive: boolean
          defer_when_offline: boolean
          max_attempts: number
          user_enqueueable: boolean
        }
        Update: {
          type?: string
          description?: string
          destructive?: boolean
          defer_when_offline?: boolean
          max_attempts?: number
          user_enqueueable?: boolean
        }
        Relationships: []
      }
      jobs: {
        Row: {
          id: string
          tenant_id: string
          router_id: string | null
          type: string
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          attempts: number
          max_attempts: number
          deferrals: number
          idempotency_key: string
          result: Json | null
          last_error: string | null
          last_error_code: string | null
          claimed_by: string | null
          claimed_at: string | null
          run_after: string
          expires_at: string
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          router_id?: string | null
          type: string
          payload?: Json
          status?: Database["public"]["Enums"]["job_status"]
          attempts?: number
          max_attempts?: number
          deferrals?: number
          idempotency_key: string
          result?: Json | null
          last_error?: string | null
          last_error_code?: string | null
          claimed_by?: string | null
          claimed_at?: string | null
          run_after?: string
          expires_at?: string
          started_at?: string | null
          finished_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          router_id?: string | null
          type?: string
          payload?: Json
          status?: Database["public"]["Enums"]["job_status"]
          attempts?: number
          max_attempts?: number
          deferrals?: number
          idempotency_key?: string
          result?: Json | null
          last_error?: string | null
          last_error_code?: string | null
          claimed_by?: string | null
          claimed_at?: string | null
          run_after?: string
          expires_at?: string
          started_at?: string | null
          finished_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_type_fkey"
            columns: ["type"]
            isOneToOne: false
            referencedRelation: "job_types"
            referencedColumns: ["type"]
          },
        ]
      }
      locations: {
        Row: {
          id: string
          tenant_id: string
          name: string
          address: string | null
          lat: number | null
          lng: number | null
          contact: string | null
          opening_hours: string | null
          status: Database["public"]["Enums"]["location_status"]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          address?: string | null
          lat?: number | null
          lng?: number | null
          contact?: string | null
          opening_hours?: string | null
          status?: Database["public"]["Enums"]["location_status"]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          address?: string | null
          lat?: number | null
          lng?: number | null
          contact?: string | null
          opening_hours?: string | null
          status?: Database["public"]["Enums"]["location_status"]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          tenant_id: string
          email: string
          full_name: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["profile_status"]
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          tenant_id: string
          email: string
          full_name?: string
          role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          email?: string
          full_name?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      router_credential_submissions: {
        Row: {
          id: string
          tenant_id: string
          router_id: string
          sealed: Json
          submitted_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          router_id: string
          sealed: Json
          submitted_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          router_id?: string
          sealed?: Json
          submitted_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_credential_submissions_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "router_credential_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      router_credentials: {
        Row: {
          router_id: string
          tenant_id: string
          username: string
          password_ciphertext: string
          key_version: number
          updated_at: string
        }
        Insert: {
          router_id: string
          tenant_id: string
          username: string
          password_ciphertext: string
          key_version: number
          updated_at?: string
        }
        Update: {
          router_id?: string
          tenant_id?: string
          username?: string
          password_ciphertext?: string
          key_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_credentials_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      router_interfaces: {
        Row: {
          id: string
          tenant_id: string
          router_id: string
          mikrotik_id: string
          name: string
          type: string
          mac: string | null
          running: boolean
          disabled: boolean
          rx_bytes: number
          tx_bytes: number
          mtu: number | null
          comment: string | null
          synced_at: string
          removed_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          router_id: string
          mikrotik_id: string
          name: string
          type: string
          mac?: string | null
          running?: boolean
          disabled?: boolean
          rx_bytes?: number
          tx_bytes?: number
          mtu?: number | null
          comment?: string | null
          synced_at?: string
          removed_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          router_id?: string
          mikrotik_id?: string
          name?: string
          type?: string
          mac?: string | null
          running?: boolean
          disabled?: boolean
          rx_bytes?: number
          tx_bytes?: number
          mtu?: number | null
          comment?: string | null
          synced_at?: string
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "router_interfaces_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      router_metrics: {
        Row: {
          id: number
          tenant_id: string
          router_id: string
          captured_at: string
          reachable: boolean
          latency_ms: number | null
          cpu_load: number | null
          free_memory: number | null
          total_memory: number | null
          uptime_seconds: number | null
          health: Json | null
          error_code: string | null
        }
        Insert: {
          id?: never
          tenant_id: string
          router_id: string
          captured_at?: string
          reachable: boolean
          latency_ms?: number | null
          cpu_load?: number | null
          free_memory?: number | null
          total_memory?: number | null
          uptime_seconds?: number | null
          health?: Json | null
          error_code?: string | null
        }
        Update: {
          id?: never
          tenant_id?: string
          router_id?: string
          captured_at?: string
          reachable?: boolean
          latency_ms?: number | null
          cpu_load?: number | null
          free_memory?: number | null
          total_memory?: number | null
          uptime_seconds?: number | null
          health?: Json | null
          error_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "router_metrics_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      routers: {
        Row: {
          id: string
          tenant_id: string
          location_id: string | null
          name: string
          host: string
          api_protocol: Database["public"]["Enums"]["api_protocol"]
          api_port: number
          use_ssl: boolean
          wg_public_key: string | null
          wg_address: string
          wg_last_handshake_at: string | null
          status: Database["public"]["Enums"]["router_status"]
          status_reason: string | null
          last_seen_at: string | null
          last_polled_at: string | null
          consecutive_failures: number
          identity: string | null
          board_name: string | null
          architecture: string | null
          routeros_version: string | null
          uptime_seconds: number | null
          cpu_load: number | null
          free_memory: number | null
          total_memory: number | null
          credentials_status: Database["public"]["Enums"]["credentials_status"]
          credentials_updated_at: string | null
          hotspot_server_id: string | null
          default_hotspot_profile_id: string | null
          discovered_at: string | null
          onboarding_completed_at: string | null
          is_demo: boolean
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          location_id?: string | null
          name: string
          host?: string
          api_protocol?: Database["public"]["Enums"]["api_protocol"]
          api_port?: number
          use_ssl?: boolean
          wg_public_key?: string | null
          wg_address?: string
          wg_last_handshake_at?: string | null
          status?: Database["public"]["Enums"]["router_status"]
          status_reason?: string | null
          last_seen_at?: string | null
          last_polled_at?: string | null
          consecutive_failures?: number
          identity?: string | null
          board_name?: string | null
          architecture?: string | null
          routeros_version?: string | null
          uptime_seconds?: number | null
          cpu_load?: number | null
          free_memory?: number | null
          total_memory?: number | null
          credentials_status?: Database["public"]["Enums"]["credentials_status"]
          credentials_updated_at?: string | null
          hotspot_server_id?: string | null
          default_hotspot_profile_id?: string | null
          discovered_at?: string | null
          onboarding_completed_at?: string | null
          is_demo?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          location_id?: string | null
          name?: string
          host?: string
          api_protocol?: Database["public"]["Enums"]["api_protocol"]
          api_port?: number
          use_ssl?: boolean
          wg_public_key?: string | null
          wg_address?: string
          wg_last_handshake_at?: string | null
          status?: Database["public"]["Enums"]["router_status"]
          status_reason?: string | null
          last_seen_at?: string | null
          last_polled_at?: string | null
          consecutive_failures?: number
          identity?: string | null
          board_name?: string | null
          architecture?: string | null
          routeros_version?: string | null
          uptime_seconds?: number | null
          cpu_load?: number | null
          free_memory?: number | null
          total_memory?: number | null
          credentials_status?: Database["public"]["Enums"]["credentials_status"]
          credentials_updated_at?: string | null
          hotspot_server_id?: string | null
          default_hotspot_profile_id?: string | null
          discovered_at?: string | null
          onboarding_completed_at?: string | null
          is_demo?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routers_default_profile_same_router"
            columns: ["default_hotspot_profile_id", "id"]
            isOneToOne: false
            referencedRelation: "hotspot_profiles"
            referencedColumns: ["id", "router_id"]
          },
          {
            foreignKeyName: "routers_hotspot_server_same_router"
            columns: ["hotspot_server_id", "id"]
            isOneToOne: false
            referencedRelation: "hotspot_servers"
            referencedColumns: ["id", "router_id"]
          },
          {
            foreignKeyName: "routers_location_same_tenant"
            columns: ["location_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "routers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_drift: {
        Row: {
          id: string
          tenant_id: string
          router_id: string
          entity_type: string
          mikrotik_id: string | null
          field: string
          expected: Json | null
          actual: Json | null
          message: string
          detected_at: string
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          router_id: string
          entity_type: string
          mikrotik_id?: string | null
          field: string
          expected?: Json | null
          actual?: Json | null
          message: string
          detected_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          router_id?: string
          entity_type?: string
          mikrotik_id?: string | null
          field?: string
          expected?: Json | null
          actual?: Json | null
          message?: string
          detected_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_drift_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_drift_router_fk"
            columns: ["router_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      system_settings: {
        Row: {
          id: string
          tenant_id: string
          key: string
          value: Json
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          key: string
          value: Json
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          key?: string
          value?: Json
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          id: string
          name: string
          slug: string
          currency_default: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          currency_default?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          currency_default?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      connector_apply_sync: {
        Args: {
          p_router_id: string
          p_snapshot: Json
        }
        Returns: Json
      }
      connector_claim_jobs: {
        Args: {
          p_connector_id: string
          p_limit: number
          p_lease_seconds: number
        }
        Returns: ({
          id: string
          tenant_id: string
          router_id: string | null
          type: string
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          attempts: number
          max_attempts: number
          deferrals: number
          idempotency_key: string
          result: Json | null
          last_error: string | null
          last_error_code: string | null
          claimed_by: string | null
          claimed_at: string | null
          run_after: string
          expires_at: string
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        })[]
      }
      connector_credentials_for_rekey: {
        Args: {
          p_current_version: number
          p_limit: number
        }
        Returns: {
          router_id: string
          username: string
          password_ciphertext: string
          key_version: number
        }[]
      }
      connector_finish_job: {
        Args: {
          p_job_id: string
          p_connector_id: string
          p_outcome: string
          p_result?: Json
          p_error_code?: string
          p_error?: string
          p_run_after?: string
          p_refund_attempt?: boolean
        }
        Returns: ({
          id: string
          tenant_id: string
          router_id: string | null
          type: string
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          attempts: number
          max_attempts: number
          deferrals: number
          idempotency_key: string
          result: Json | null
          last_error: string | null
          last_error_code: string | null
          claimed_by: string | null
          claimed_at: string | null
          run_after: string
          expires_at: string
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        })[]
      }
      connector_get_router: {
        Args: {
          p_router_id: string
        }
        Returns: {
          id: string
          tenant_id: string
          name: string
          host: string
          api_protocol: Database["public"]["Enums"]["api_protocol"]
          api_port: number
          use_ssl: boolean
          is_demo: boolean
          status: Database["public"]["Enums"]["router_status"]
          consecutive_failures: number
          credentials_status: Database["public"]["Enums"]["credentials_status"]
          wg_public_key: string
          wg_last_handshake_at: string
          hotspot_server_id: string
          default_hotspot_profile_id: string
          username: string
          password_ciphertext: string
          key_version: number
        }[]
      }
      connector_heartbeat: {
        Args: {
          p_connector_id: string
          p_info: Json
        }
        Returns: undefined
      }
      connector_prune_metrics: {
        Args: {
          p_default_retention_days: number
        }
        Returns: number
      }
      connector_record_handshakes: {
        Args: {
          p_handshakes: Json
        }
        Returns: number
      }
      connector_record_poll: {
        Args: {
          p_router_id: string
          p_reachable: boolean
          p_status: Database["public"]["Enums"]["router_status"]
          p_metrics?: Json
          p_error_code?: string
          p_error_detail?: string
        }
        Returns: {
          previous_status: Database["public"]["Enums"]["router_status"]
          new_status: Database["public"]["Enums"]["router_status"]
        }[]
      }
      connector_reject_submission: {
        Args: {
          p_submission_id: string
          p_reason: string
        }
        Returns: undefined
      }
      connector_release_router_jobs: {
        Args: {
          p_router_id: string
        }
        Returns: number
      }
      connector_routers_due: {
        Args: {
          p_default_interval_seconds: number
          p_limit: number
        }
        Returns: {
          id: string
          tenant_id: string
          name: string
          host: string
          api_protocol: Database["public"]["Enums"]["api_protocol"]
          api_port: number
          use_ssl: boolean
          is_demo: boolean
          status: Database["public"]["Enums"]["router_status"]
          consecutive_failures: number
          last_polled_at: string
          poll_interval_seconds: number
          offline_after_missed_polls: number
          username: string
          password_ciphertext: string
          key_version: number
        }[]
      }
      connector_start_job: {
        Args: {
          p_job_id: string
          p_connector_id: string
        }
        Returns: ({
          id: string
          tenant_id: string
          router_id: string | null
          type: string
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          attempts: number
          max_attempts: number
          deferrals: number
          idempotency_key: string
          result: Json | null
          last_error: string | null
          last_error_code: string | null
          claimed_by: string | null
          claimed_at: string | null
          run_after: string
          expires_at: string
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        })[]
      }
      connector_store_credentials: {
        Args: {
          p_submission_id: string
          p_username: string
          p_ciphertext: string
          p_key_version: number
        }
        Returns: undefined
      }
      connector_take_submission: {
        Args: {
          p_submission_id: string
        }
        Returns: {
          router_id: string
          tenant_id: string
          sealed: Json
          superseded: boolean
        }[]
      }
      connector_update_ciphertext: {
        Args: {
          p_router_id: string
          p_ciphertext: string
          p_key_version: number
          p_expected_version: number
        }
        Returns: boolean
      }
      connector_wg_peers: {
        Args: never
        Returns: {
          router_id: string
          wg_public_key: string
          wg_address: string
        }[]
      }
      create_invite: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: {
          invite_id: string
          token: string
        }[]
      }
      enqueue_router_job: {
        Args: {
          p_router_id: string
          p_type: string
          p_idempotency_key: string
          p_payload?: Json
        }
        Returns: {
          id: string
          tenant_id: string
          router_id: string | null
          type: string
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          attempts: number
          max_attempts: number
          deferrals: number
          idempotency_key: string
          result: Json | null
          last_error: string | null
          last_error_code: string | null
          claimed_by: string | null
          claimed_at: string | null
          run_after: string
          expires_at: string
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
      }
      get_invite: {
        Args: {
          p_token: string
        }
        Returns: {
          email: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_name: string
          expires_at: string
          state: string
        }[]
      }
      resolve_drift: {
        Args: {
          p_drift_id: string
        }
        Returns: {
          id: string
          tenant_id: string
          router_id: string
          entity_type: string
          mikrotik_id: string | null
          field: string
          expected: Json | null
          actual: Json | null
          message: string
          detected_at: string
          resolved_at: string | null
          resolved_by: string | null
        }
      }
      revoke_invite: {
        Args: {
          p_invite_id: string
        }
        Returns: undefined
      }
      router_uptime_buckets: {
        Args: {
          p_days?: number
          p_bucket_hours?: number
        }
        Returns: {
          router_id: string
          bucket_start: string
          samples: number
          reachable_samples: number
        }[]
      }
      submit_router_credentials: {
        Args: {
          p_router_id: string
          p_sealed: Json
          p_idempotency_key: string
        }
        Returns: {
          id: string
          tenant_id: string
          router_id: string | null
          type: string
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          attempts: number
          max_attempts: number
          deferrals: number
          idempotency_key: string
          result: Json | null
          last_error: string | null
          last_error_code: string | null
          claimed_by: string | null
          claimed_at: string | null
          run_after: string
          expires_at: string
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
      }
      update_member: {
        Args: {
          p_profile_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_status: Database["public"]["Enums"]["profile_status"]
        }
        Returns: {
          id: string
          tenant_id: string
          email: string
          full_name: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["profile_status"]
          created_at: string
          updated_at: string
        }
      }
    }
    Enums: {
      api_protocol: "api" | "api_ssl" | "rest"
      app_role: "SUPER_ADMIN" | "ADMIN" | "TECHNICIAN" | "RESELLER" | "CUSTOMER"
      credentials_status: "not_set" | "pending" | "set" | "rejected"
      job_status: "pending" | "claimed" | "running" | "succeeded" | "failed" | "dead"
      location_status: "active" | "inactive" | "maintenance"
      profile_status: "active" | "suspended"
      router_status: "online" | "offline" | "warning" | "critical" | "unknown"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      api_protocol: ["api", "api_ssl", "rest"],
      app_role: ["SUPER_ADMIN", "ADMIN", "TECHNICIAN", "RESELLER", "CUSTOMER"],
      credentials_status: ["not_set", "pending", "set", "rejected"],
      job_status: ["pending", "claimed", "running", "succeeded", "failed", "dead"],
      location_status: ["active", "inactive", "maintenance"],
      profile_status: ["active", "suspended"],
      router_status: ["online", "offline", "warning", "critical", "unknown"],
    },
  },
} as const
