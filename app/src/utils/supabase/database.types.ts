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
      bet_lines: {
        Row: {
          actual_score: number | null
          created_at: string
          game_number: number
          id: string
          is_open: boolean
          line: number
          player_id: string
          result: string | null
          updated_at: string
          week_id: string
        }
        Insert: {
          actual_score?: number | null
          created_at?: string
          game_number: number
          id?: string
          is_open?: boolean
          line: number
          player_id: string
          result?: string | null
          updated_at?: string
          week_id: string
        }
        Update: {
          actual_score?: number | null
          created_at?: string
          game_number?: number
          id?: string
          is_open?: boolean
          line?: number
          player_id?: string
          result?: string | null
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_lines_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_lines_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      board_posts: {
        Row: {
          created_at: string
          id: string
          message: string
          player_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          player_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_posts_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          created_at: string
          game_number: number
          id: string
          team_a_id: string
          team_b_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_number: number
          id?: string
          team_a_id: string
          team_b_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_number?: number
          id?: string
          team_a_id?: string
          team_b_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "games_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_ledger: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          placed_bet_id: string | null
          player_id: string
          season_id: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          placed_bet_id?: string | null
          player_id: string
          season_id: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          placed_bet_id?: string | null
          player_id?: string
          season_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_ledger_placed_bet_id_fkey"
            columns: ["placed_bet_id"]
            isOneToOne: false
            referencedRelation: "placed_bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_ledger_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_ledger_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      placed_bets: {
        Row: {
          bet_line_id: string
          created_at: string
          id: string
          payout: number | null
          pick: string
          player_id: string
          settled_at: string | null
          updated_at: string
          wager: number
        }
        Insert: {
          bet_line_id: string
          created_at?: string
          id?: string
          payout?: number | null
          pick: string
          player_id: string
          settled_at?: string | null
          updated_at?: string
          wager: number
        }
        Update: {
          bet_line_id?: string
          created_at?: string
          id?: string
          payout?: number | null
          pick?: string
          player_id?: string
          settled_at?: string | null
          updated_at?: string
          wager?: number
        }
        Relationships: [
          {
            foreignKeyName: "placed_bets_bet_line_id_fkey"
            columns: ["bet_line_id"]
            isOneToOne: false
            referencedRelation: "bet_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placed_bets_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          name: string | null
          phone: string | null
          role: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          first_name: string
          id: string
          is_active?: boolean
          last_name: string
          name?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          name?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      registrations: {
        Row: {
          created_at: string
          id: string
          player_id: string
          season_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          season_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registrations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvp: {
        Row: {
          created_at: string
          id: string
          note: string | null
          player_id: string
          status: string
          updated_at: string
          week_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          player_id: string
          status: string
          updated_at?: string
          week_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          player_id?: string
          status?: string
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsvp_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvp_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      scores: {
        Row: {
          created_at: string
          game_id: string
          id: string
          score: number | null
          team_slot_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          score?: number | null
          team_slot_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          score?: number | null
          team_slot_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scores_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_team_slot_id_fkey"
            columns: ["team_slot_id"]
            isOneToOne: false
            referencedRelation: "team_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      season_champions: {
        Row: {
          created_at: string
          id: string
          player_id: string
          season_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          season_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_champions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_champions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          bowling_night: string
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          number: number
          registration_open: boolean
          start_date: string
          updated_at: string
        }
        Insert: {
          bowling_night: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          number: number
          registration_open?: boolean
          start_date: string
          updated_at?: string
        }
        Update: {
          bowling_night?: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          number?: number
          registration_open?: boolean
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_slots: {
        Row: {
          created_at: string
          id: string
          is_fill: boolean | null
          player_id: string | null
          slot: number
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_fill?: boolean | null
          player_id?: string | null
          slot: number
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_fill?: boolean | null
          player_id?: string | null
          slot?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_slots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          team_number: number
          updated_at: string
          week_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_number: number
          updated_at?: string
          week_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_number?: number
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      weeks: {
        Row: {
          bowled_at: string | null
          created_at: string
          id: string
          is_archived: boolean
          is_confirmed: boolean
          season_id: string
          updated_at: string
          week_number: number
        }
        Insert: {
          bowled_at?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          is_confirmed?: boolean
          season_id: string
          updated_at?: string
          week_number: number
        }
        Update: {
          bowled_at?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          is_confirmed?: boolean
          season_id?: string
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "weeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_bet_lines_for_players: {
        Args: { p_player_ids: string[]; p_week_id: string }
        Returns: undefined
      }
      custom_access_token: { Args: { event: Json }; Returns: Json }
      is_registered_player: { Args: { phone: string }; Returns: boolean }
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
