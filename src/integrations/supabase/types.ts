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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          meta: Json | null
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          target?: string | null
        }
        Relationships: []
      }
      affiliate_clicks: {
        Row: {
          affiliate_id: string
          created_at: string
          id: string
          ip_hash: string | null
          user_agent: string | null
        }
        Insert: {
          affiliate_id: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
        }
        Update: {
          affiliate_id?: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          amount: number
          available_at: string | null
          created_at: string
          id: string
          period_month: string | null
          referred_user_id: string | null
          source: string
          status: string
          unlock_id: string | null
        }
        Insert: {
          affiliate_id: string
          amount: number
          available_at?: string | null
          created_at?: string
          id?: string
          period_month?: string | null
          referred_user_id?: string | null
          source?: string
          status?: string
          unlock_id?: string | null
        }
        Update: {
          affiliate_id?: string
          amount?: number
          available_at?: string | null
          created_at?: string
          id?: string
          period_month?: string | null
          referred_user_id?: string | null
          source?: string
          status?: string
          unlock_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          commission_rate: number
          created_at: string
          id: string
          paid_payout: number
          pending_payout: number
          referral_code: string
          total_active_subs: number
          total_clicks: number
          total_earned: number
          total_signups: number
          user_id: string
        }
        Insert: {
          commission_rate?: number
          created_at?: string
          id?: string
          paid_payout?: number
          pending_payout?: number
          referral_code: string
          total_active_subs?: number
          total_clicks?: number
          total_earned?: number
          total_signups?: number
          user_id: string
        }
        Update: {
          commission_rate?: number
          created_at?: string
          id?: string
          paid_payout?: number
          pending_payout?: number
          referral_code?: string
          total_active_subs?: number
          total_clicks?: number
          total_earned?: number
          total_signups?: number
          user_id?: string
        }
        Relationships: []
      }
      analyses: {
        Row: {
          best_market: string
          confidence: number
          cost_cents: number | null
          created_at: string
          expires_at: string | null
          form_analysis: string | null
          h2h_summary: string | null
          id: string
          injuries_impact: string | null
          lineup_fingerprint: string | null
          match_id: string
          model: string | null
          motivation: string | null
          odds_fingerprint: string | null
          odds_movement: string | null
          prob_away: number | null
          prob_draw: number | null
          prob_home: number | null
          provider: string | null
          reasoning: string | null
          risk: Database["public"]["Enums"]["risk_level"]
          suggested_stake_amount: number | null
          suggested_stake_pct: number | null
          summary: string
          tokens_in: number | null
          tokens_out: number | null
          user_id: string | null
          value_bet: boolean
        }
        Insert: {
          best_market: string
          confidence: number
          cost_cents?: number | null
          created_at?: string
          expires_at?: string | null
          form_analysis?: string | null
          h2h_summary?: string | null
          id?: string
          injuries_impact?: string | null
          lineup_fingerprint?: string | null
          match_id: string
          model?: string | null
          motivation?: string | null
          odds_fingerprint?: string | null
          odds_movement?: string | null
          prob_away?: number | null
          prob_draw?: number | null
          prob_home?: number | null
          provider?: string | null
          reasoning?: string | null
          risk: Database["public"]["Enums"]["risk_level"]
          suggested_stake_amount?: number | null
          suggested_stake_pct?: number | null
          summary: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
          value_bet?: boolean
        }
        Update: {
          best_market?: string
          confidence?: number
          cost_cents?: number | null
          created_at?: string
          expires_at?: string | null
          form_analysis?: string | null
          h2h_summary?: string | null
          id?: string
          injuries_impact?: string | null
          lineup_fingerprint?: string | null
          match_id?: string
          model?: string | null
          motivation?: string | null
          odds_fingerprint?: string | null
          odds_movement?: string | null
          prob_away?: number | null
          prob_draw?: number | null
          prob_home?: number | null
          provider?: string | null
          reasoning?: string | null
          risk?: Database["public"]["Enums"]["risk_level"]
          suggested_stake_amount?: number | null
          suggested_stake_pct?: number | null
          summary?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
          value_bet?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "analyses_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_unlocks: {
        Row: {
          amount_cents: number | null
          created_at: string
          environment: string
          id: string
          match_id: string
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          environment?: string
          id?: string
          match_id: string
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          environment?: string
          id?: string
          match_id?: string
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      api_usage: {
        Row: {
          cost: number | null
          created_at: string
          id: string
          kind: string
          user_id: string | null
        }
        Insert: {
          cost?: number | null
          created_at?: string
          id?: string
          kind: string
          user_id?: string | null
        }
        Update: {
          cost?: number | null
          created_at?: string
          id?: string
          kind?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bankrolls: {
        Row: {
          currency: string
          current_amount: number
          daily_loss_limit: number
          id: string
          is_initialized: boolean
          max_stake_pct: number
          starting_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          currency?: string
          current_amount?: number
          daily_loss_limit?: number
          id?: string
          is_initialized?: boolean
          max_stake_pct?: number
          starting_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          currency?: string
          current_amount?: number
          daily_loss_limit?: number
          id?: string
          is_initialized?: boolean
          max_stake_pct?: number
          starting_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bets: {
        Row: {
          ai_confidence: number | null
          ai_risk: Database["public"]["Enums"]["risk_level"] | null
          id: string
          market: string | null
          match_id: string | null
          match_label: string
          odds: number
          pick: string
          placed_at: string
          profit_loss: number
          result: Database["public"]["Enums"]["bet_result"]
          settled_at: string | null
          stake: number
          user_id: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_risk?: Database["public"]["Enums"]["risk_level"] | null
          id?: string
          market?: string | null
          match_id?: string | null
          match_label: string
          odds: number
          pick: string
          placed_at?: string
          profit_loss?: number
          result?: Database["public"]["Enums"]["bet_result"]
          settled_at?: string | null
          stake: number
          user_id: string
        }
        Update: {
          ai_confidence?: number | null
          ai_risk?: Database["public"]["Enums"]["risk_level"] | null
          id?: string
          market?: string | null
          match_id?: string | null
          match_label?: string
          odds?: number
          pick?: string
          placed_at?: string
          profit_loss?: number
          result?: Database["public"]["Enums"]["bet_result"]
          settled_at?: string | null
          stake?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bets_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_unlock_orders: {
        Row: {
          created_at: string
          environment: string
          id: string
          invoice_id: string | null
          match_id: string
          pay_currency: string | null
          payment_id: string | null
          price_amount: number
          price_currency: string
          provider: string
          raw: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          environment?: string
          id?: string
          invoice_id?: string | null
          match_id: string
          pay_currency?: string | null
          payment_id?: string | null
          price_amount: number
          price_currency?: string
          provider?: string
          raw?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          invoice_id?: string | null
          match_id?: string
          pay_currency?: string | null
          payment_id?: string | null
          price_amount?: number
          price_currency?: string
          provider?: string
          raw?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
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
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
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
      matches: {
        Row: {
          away_logo: string | null
          away_score: number | null
          away_team: string
          country: string | null
          created_at: string
          external_id: string | null
          home_logo: string | null
          home_score: number | null
          home_team: string
          id: string
          kickoff: string
          league: string
          odds_away: number | null
          odds_draw: number | null
          odds_home: number | null
          status: Database["public"]["Enums"]["match_status"]
        }
        Insert: {
          away_logo?: string | null
          away_score?: number | null
          away_team: string
          country?: string | null
          created_at?: string
          external_id?: string | null
          home_logo?: string | null
          home_score?: number | null
          home_team: string
          id?: string
          kickoff: string
          league: string
          odds_away?: number | null
          odds_draw?: number | null
          odds_home?: number | null
          status?: Database["public"]["Enums"]["match_status"]
        }
        Update: {
          away_logo?: string | null
          away_score?: number | null
          away_team?: string
          country?: string | null
          created_at?: string
          external_id?: string | null
          home_logo?: string | null
          home_score?: number | null
          home_team?: string
          id?: string
          kickoff?: string
          league?: string
          odds_away?: number | null
          odds_draw?: number | null
          odds_home?: number | null
          status?: Database["public"]["Enums"]["match_status"]
        }
        Relationships: []
      }
      payout_methods: {
        Row: {
          bank_account_holder: string | null
          bank_iban: string | null
          bank_name: string | null
          bank_swift: string | null
          created_at: string
          id: string
          is_default: boolean
          label: string | null
          type: string
          updated_at: string
          user_id: string
          wallet_address: string | null
        }
        Insert: {
          bank_account_holder?: string | null
          bank_iban?: string | null
          bank_name?: string | null
          bank_swift?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          type: string
          updated_at?: string
          user_id: string
          wallet_address?: string | null
        }
        Update: {
          bank_account_holder?: string | null
          bank_iban?: string | null
          bank_name?: string | null
          bank_swift?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          type?: string
          updated_at?: string
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      payout_requests: {
        Row: {
          amount: number
          created_at: string
          id: string
          method_id: string | null
          notes: string | null
          processed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method_id?: string | null
          notes?: string | null
          processed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method_id?: string | null
          notes?: string | null
          processed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "payout_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_confirmed: boolean | null
          avatar_url: string | null
          country: string | null
          created_at: string
          display_name: string | null
          id: string
          referred_by: string | null
          updated_at: string
        }
        Insert: {
          age_confirmed?: boolean | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          referred_by?: string | null
          updated_at?: string
        }
        Update: {
          age_confirmed?: boolean | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          referred_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_predictions: {
        Row: {
          created_at: string
          id: string
          ip_hash: string
          meta: Json | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash: string
          meta?: Json | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string
          meta?: Json | null
          user_agent?: string | null
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_hash: string | null
          meta: Json | null
          target: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          meta?: Json | null
          target?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          meta?: Json | null
          target?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          affiliate_credited_at: string | null
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          plan: Database["public"]["Enums"]["plan_tier"]
          price_id: string | null
          product_id: string | null
          status: Database["public"]["Enums"]["sub_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          affiliate_credited_at?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          price_id?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["sub_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          affiliate_credited_at?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          price_id?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["sub_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      translation_cache: {
        Row: {
          created_at: string
          hit_count: number
          id: string
          source_hash: string
          source_text: string
          target_lang: string
          translated_text: string
        }
        Insert: {
          created_at?: string
          hit_count?: number
          id?: string
          source_hash: string
          source_text: string
          target_lang: string
          translated_text: string
        }
        Update: {
          created_at?: string
          hit_count?: number
          id?: string
          source_hash?: string
          source_text?: string
          target_lang?: string
          translated_text?: string
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
          role: Database["public"]["Enums"]["app_role"]
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
      [_ in never]: never
    }
    Functions: {
      audit_function_grants: {
        Args: never
        Returns: {
          actual: boolean
          expected: boolean
          function_signature: string
          ok: boolean
          role_name: string
        }[]
      }
      audit_table_grants: {
        Args: never
        Returns: {
          actual: boolean
          expected: boolean
          object_name: string
          ok: boolean
          privilege: string
          role_name: string
        }[]
      }
      cancel_my_subscription: { Args: { _user_id: string }; Returns: undefined }
      check_rate_limit: {
        Args: { _kind: string; _limit: number; _window: string }
        Returns: undefined
      }
      consume_ai_quota: {
        Args: { _limit: number; _user_id: string }
        Returns: {
          allowed: boolean
          hourly_limit: number
          used: number
        }[]
      }
      consume_free_preview: {
        Args: { _limit?: number; _user_id: string }
        Returns: {
          allowed: boolean
          monthly_limit: number
          used: number
        }[]
      }
      credit_affiliate_commission: {
        Args: {
          _plan_amount: number
          _referred_user_id: string
          _subscription_id: string
        }
        Returns: undefined
      }
      credit_unlock_commission: {
        Args: { _unlock_id: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_affiliate_leaderboard: {
        Args: never
        Returns: {
          referral_code: string
          total_active_subs: number
          total_earned: number
          total_generated: number
          total_signups: number
        }[]
      }
      log_admin_action: {
        Args: {
          _action: string
          _actor_id: string
          _meta?: Json
          _target?: string
        }
        Returns: string
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
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      release_matured_affiliate_commissions: { Args: never; Returns: number }
      request_payout: {
        Args: { _amount: number; _method_id: string }
        Returns: string
      }
      subscribe_to_plan: {
        Args: { _plan: string; _user_id: string }
        Returns: undefined
      }
      track_affiliate_click: {
        Args: { _code: string; _ip_hash?: string; _user_agent?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      bet_result: "pending" | "won" | "lost" | "void" | "cashout"
      match_status: "scheduled" | "live" | "finished" | "postponed"
      plan_tier: "free" | "basic" | "pro" | "elite"
      risk_level: "low" | "medium" | "high"
      sub_status: "active" | "canceled" | "past_due" | "trialing" | "incomplete"
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
      app_role: ["admin", "user"],
      bet_result: ["pending", "won", "lost", "void", "cashout"],
      match_status: ["scheduled", "live", "finished", "postponed"],
      plan_tier: ["free", "basic", "pro", "elite"],
      risk_level: ["low", "medium", "high"],
      sub_status: ["active", "canceled", "past_due", "trialing", "incomplete"],
    },
  },
} as const
