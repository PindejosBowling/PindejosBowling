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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_event_catalog: {
        Row: {
          allowed_fk: string
          created_at: string
          default_visibility: string
          event_type: string
          requires_actor: boolean
          source_feature: string
          template_key: string
          updated_at: string
        }
        Insert: {
          allowed_fk: string
          created_at?: string
          default_visibility: string
          event_type: string
          requires_actor: boolean
          source_feature: string
          template_key: string
          updated_at?: string
        }
        Update: {
          allowed_fk?: string
          created_at?: string
          default_visibility?: string
          event_type?: string
          requires_actor?: boolean
          source_feature?: string
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      activity_feed_events: {
        Row: {
          actor_player_id: string | null
          admin_payload: Json
          auction_id: string | null
          bounty_post_id: string | null
          created_at: string
          event_type: string
          id: string
          loan_id: string | null
          occurred_at: string
          public_payload: Json
          published_at: string
          pvp_challenge_id: string | null
          season_id: string
          secondary_player_id: string | null
          source_feature: string
          sportsbook_bet_id: string | null
          status: string
          subject_player_id: string | null
          suppressed_at: string | null
          suppressed_by_admin_id: string | null
          suppression_reason: string | null
          template_key: string
          updated_at: string
          visibility: string
          week_id: string | null
        }
        Insert: {
          actor_player_id?: string | null
          admin_payload?: Json
          auction_id?: string | null
          bounty_post_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          loan_id?: string | null
          occurred_at: string
          public_payload?: Json
          published_at?: string
          pvp_challenge_id?: string | null
          season_id: string
          secondary_player_id?: string | null
          source_feature: string
          sportsbook_bet_id?: string | null
          status?: string
          subject_player_id?: string | null
          suppressed_at?: string | null
          suppressed_by_admin_id?: string | null
          suppression_reason?: string | null
          template_key: string
          updated_at?: string
          visibility?: string
          week_id?: string | null
        }
        Update: {
          actor_player_id?: string | null
          admin_payload?: Json
          auction_id?: string | null
          bounty_post_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          loan_id?: string | null
          occurred_at?: string
          public_payload?: Json
          published_at?: string
          pvp_challenge_id?: string | null
          season_id?: string
          secondary_player_id?: string | null
          source_feature?: string
          sportsbook_bet_id?: string | null
          status?: string
          subject_player_id?: string | null
          suppressed_at?: string | null
          suppressed_by_admin_id?: string | null
          suppression_reason?: string | null
          template_key?: string
          updated_at?: string
          visibility?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_feed_events_actor_player_id_fkey"
            columns: ["actor_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_bounty_post_id_fkey"
            columns: ["bounty_post_id"]
            isOneToOne: false
            referencedRelation: "bounty_post"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_event_type_fkey"
            columns: ["event_type"]
            isOneToOne: false
            referencedRelation: "activity_event_catalog"
            referencedColumns: ["event_type"]
          },
          {
            foreignKeyName: "activity_feed_events_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_pvp_challenge_id_fkey"
            columns: ["pvp_challenge_id"]
            isOneToOne: false
            referencedRelation: "pvp_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_secondary_player_id_fkey"
            columns: ["secondary_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_sportsbook_bet_id_fkey"
            columns: ["sportsbook_bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_subject_player_id_fkey"
            columns: ["subject_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_suppressed_by_admin_id_fkey"
            columns: ["suppressed_by_admin_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_events_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_bids: {
        Row: {
          auction_id: string
          bid_amount_enc: string
          created_at: string
          id: string
          player_id: string
          settled_at: string | null
          status: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          auction_id: string
          bid_amount_enc: string
          created_at?: string
          id?: string
          player_id: string
          settled_at?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          auction_id?: string
          bid_amount_enc?: string
          created_at?: string
          id?: string
          player_id?: string
          settled_at?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_bids_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      auctions: {
        Row: {
          bidder_count: number
          bounce_fee: number
          catalog_item_id: string
          closes_at: string
          created_at: string
          description: string
          id: string
          minimum_bid: number
          opens_at: string
          quantity: number
          season_id: string
          settled_at: string | null
          status: string
          updated_at: string
          winner_player_id: string | null
          winning_bid_id: string | null
          winning_price: number | null
        }
        Insert: {
          bidder_count?: number
          bounce_fee?: number
          catalog_item_id: string
          closes_at: string
          created_at?: string
          description: string
          id?: string
          minimum_bid: number
          opens_at: string
          quantity?: number
          season_id: string
          settled_at?: string | null
          status?: string
          updated_at?: string
          winner_player_id?: string | null
          winning_bid_id?: string | null
          winning_price?: number | null
        }
        Update: {
          bidder_count?: number
          bounce_fee?: number
          catalog_item_id?: string
          closes_at?: string
          created_at?: string
          description?: string
          id?: string
          minimum_bid?: number
          opens_at?: string
          quantity?: number
          season_id?: string
          settled_at?: string | null
          status?: string
          updated_at?: string
          winner_player_id?: string | null
          winning_bid_id?: string | null
          winning_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "auctions_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "item_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_winner_player_id_fkey"
            columns: ["winner_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_winning_bid_id_fkey"
            columns: ["winning_bid_id"]
            isOneToOne: false
            referencedRelation: "auction_bids"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_legs: {
        Row: {
          bet_id: string
          created_at: string
          id: string
          line_at_placement: number | null
          odds_at_placement: number
          result: string | null
          selection_id: string
          side: string
          updated_at: string
        }
        Insert: {
          bet_id: string
          created_at?: string
          id?: string
          line_at_placement?: number | null
          odds_at_placement: number
          result?: string | null
          selection_id: string
          side?: string
          updated_at?: string
        }
        Update: {
          bet_id?: string
          created_at?: string
          id?: string
          line_at_placement?: number | null
          odds_at_placement?: number
          result?: string | null
          selection_id?: string
          side?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_legs_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_legs_selection_id_fkey"
            columns: ["selection_id"]
            isOneToOne: false
            referencedRelation: "bet_selections"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_markets: {
        Row: {
          created_at: string
          created_by_player_id: string | null
          game_number: number | null
          id: string
          market_type: string
          params: Json
          result_value: number | null
          settled_at: string | null
          status: string
          subject_game_id: string | null
          subject_player_id: string | null
          title: string
          updated_at: string
          week_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_player_id?: string | null
          game_number?: number | null
          id?: string
          market_type: string
          params?: Json
          result_value?: number | null
          settled_at?: string | null
          status?: string
          subject_game_id?: string | null
          subject_player_id?: string | null
          title: string
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_player_id?: string | null
          game_number?: number | null
          id?: string
          market_type?: string
          params?: Json
          result_value?: number | null
          settled_at?: string | null
          status?: string
          subject_game_id?: string | null
          subject_player_id?: string | null
          title?: string
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bet_markets_created_by_player_id_fkey"
            columns: ["created_by_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_markets_subject_game_id_fkey"
            columns: ["subject_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_markets_subject_player_id_fkey"
            columns: ["subject_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_markets_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_selections: {
        Row: {
          created_at: string
          id: string
          key: string
          label: string
          line: number | null
          market_id: string
          odds: number
          result: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          label: string
          line?: number | null
          market_id: string
          odds?: number
          result?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          label?: string
          line?: number | null
          market_id?: string
          odds?: number
          result?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_selections_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "bet_markets"
            referencedColumns: ["id"]
          },
        ]
      }
      bets: {
        Row: {
          created_at: string
          custom_line_category: string | null
          custom_line_description: string | null
          custom_line_id: string | null
          custom_line_title: string | null
          id: string
          insurance_item_id: string | null
          placed_at: string
          player_id: string
          potential_payout: number
          season_id: string
          settled_at: string | null
          stake: number
          status: string
          updated_at: string
          week_id: string | null
        }
        Insert: {
          created_at?: string
          custom_line_category?: string | null
          custom_line_description?: string | null
          custom_line_id?: string | null
          custom_line_title?: string | null
          id?: string
          insurance_item_id?: string | null
          placed_at?: string
          player_id: string
          potential_payout: number
          season_id: string
          settled_at?: string | null
          stake: number
          status?: string
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          created_at?: string
          custom_line_category?: string | null
          custom_line_description?: string | null
          custom_line_id?: string | null
          custom_line_title?: string | null
          id?: string
          insurance_item_id?: string | null
          placed_at?: string
          player_id?: string
          potential_payout?: number
          season_id?: string
          settled_at?: string | null
          stake?: number
          status?: string
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bets_custom_line_id_fkey"
            columns: ["custom_line_id"]
            isOneToOne: false
            referencedRelation: "custom_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bets_insurance_item_id_fkey"
            columns: ["insurance_item_id"]
            isOneToOne: false
            referencedRelation: "player_inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bets_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bets_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bets_week_id_fkey"
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
      bounty_hunter_stakes: {
        Row: {
          bounty_post_id: string
          created_at: string
          entered_at: string
          entry_number: number
          id: string
          player_id: string
          protected_hunter_profit: number
          resolved_at: string | null
          stake_amount: number
          status: string
          updated_at: string
        }
        Insert: {
          bounty_post_id: string
          created_at?: string
          entered_at?: string
          entry_number: number
          id?: string
          player_id: string
          protected_hunter_profit: number
          resolved_at?: string | null
          stake_amount: number
          status?: string
          updated_at?: string
        }
        Update: {
          bounty_post_id?: string
          created_at?: string
          entered_at?: string
          entry_number?: number
          id?: string
          player_id?: string
          protected_hunter_profit?: number
          resolved_at?: string | null
          stake_amount?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bounty_hunter_stakes_bounty_post_id_fkey"
            columns: ["bounty_post_id"]
            isOneToOne: false
            referencedRelation: "bounty_post"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bounty_hunter_stakes_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      bounty_payouts: {
        Row: {
          bounty_post_id: string
          bounty_settlement_id: string
          created_at: string
          id: string
          is_house: boolean
          payout_amount: number
          player_id: string | null
          updated_at: string
        }
        Insert: {
          bounty_post_id: string
          bounty_settlement_id: string
          created_at?: string
          id?: string
          is_house?: boolean
          payout_amount: number
          player_id?: string | null
          updated_at?: string
        }
        Update: {
          bounty_post_id?: string
          bounty_settlement_id?: string
          created_at?: string
          id?: string
          is_house?: boolean
          payout_amount?: number
          player_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bounty_payouts_bounty_post_id_fkey"
            columns: ["bounty_post_id"]
            isOneToOne: false
            referencedRelation: "bounty_post"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bounty_payouts_bounty_settlement_id_fkey"
            columns: ["bounty_settlement_id"]
            isOneToOne: false
            referencedRelation: "bounty_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bounty_payouts_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      bounty_post: {
        Row: {
          bounty_type: string
          closes_at: string
          created_at: string
          description: string
          house_seed_mode: string
          hunter_stake_amount: number
          id: string
          max_hunters: number
          reward_per_hunter: number
          season_id: string
          sponsor_bounty_amount: number
          sponsor_player_id: string | null
          status: string
          title: string
          updated_at: string
          week_id: string | null
        }
        Insert: {
          bounty_type: string
          closes_at: string
          created_at?: string
          description: string
          house_seed_mode?: string
          hunter_stake_amount: number
          id?: string
          max_hunters: number
          reward_per_hunter: number
          season_id: string
          sponsor_bounty_amount: number
          sponsor_player_id?: string | null
          status?: string
          title: string
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          bounty_type?: string
          closes_at?: string
          created_at?: string
          description?: string
          house_seed_mode?: string
          hunter_stake_amount?: number
          id?: string
          max_hunters?: number
          reward_per_hunter?: number
          season_id?: string
          sponsor_bounty_amount?: number
          sponsor_player_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bounty_post_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bounty_post_sponsor_player_id_fkey"
            columns: ["sponsor_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bounty_post_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      bounty_settlements: {
        Row: {
          admin_settlement_reasoning: string
          bounty_post_id: string
          created_at: string
          id: string
          settled_at: string
          settled_by_admin_id: string
          settlement_outcome: string
          settlement_source: string
          total_house_seed: number
          total_hunter_stakes: number
          total_pot: number
          total_protected_hunter_profit: number
          total_sponsor_bounty: number
          updated_at: string
          winner_count: number
        }
        Insert: {
          admin_settlement_reasoning: string
          bounty_post_id: string
          created_at?: string
          id?: string
          settled_at?: string
          settled_by_admin_id: string
          settlement_outcome: string
          settlement_source?: string
          total_house_seed: number
          total_hunter_stakes: number
          total_pot: number
          total_protected_hunter_profit: number
          total_sponsor_bounty: number
          updated_at?: string
          winner_count: number
        }
        Update: {
          admin_settlement_reasoning?: string
          bounty_post_id?: string
          created_at?: string
          id?: string
          settled_at?: string
          settled_by_admin_id?: string
          settlement_outcome?: string
          settlement_source?: string
          total_house_seed?: number
          total_hunter_stakes?: number
          total_pot?: number
          total_protected_hunter_profit?: number
          total_sponsor_bounty?: number
          updated_at?: string
          winner_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "bounty_settlements_bounty_post_id_fkey"
            columns: ["bounty_post_id"]
            isOneToOne: false
            referencedRelation: "bounty_post"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bounty_settlements_settled_by_admin_id_fkey"
            columns: ["settled_by_admin_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_lines: {
        Row: {
          category: string
          created_at: string
          created_by_player_id: string | null
          description: string
          id: string
          is_active: boolean
          legs: Json
          title: string
          updated_at: string
          week_ids: string[] | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by_player_id?: string | null
          description?: string
          id?: string
          is_active?: boolean
          legs?: Json
          title: string
          updated_at?: string
          week_ids?: string[] | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by_player_id?: string | null
          description?: string
          id?: string
          is_active?: boolean
          legs?: Json
          title?: string
          updated_at?: string
          week_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_lines_created_by_player_id_fkey"
            columns: ["created_by_player_id"]
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
      item_catalog: {
        Row: {
          activation_mode: string
          created_at: string
          description: string
          effect_params: Json
          effect_type: string
          icon: string
          id: string
          is_active: boolean
          key: string
          name: string
          updated_at: string
        }
        Insert: {
          activation_mode: string
          created_at?: string
          description: string
          effect_params?: Json
          effect_type: string
          icon: string
          id?: string
          is_active?: boolean
          key: string
          name: string
          updated_at?: string
        }
        Update: {
          activation_mode?: string
          created_at?: string
          description?: string
          effect_params?: Json
          effect_type?: string
          icon?: string
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      lanetalk_game_imports: {
        Row: {
          classification: string
          clean_pct: number | null
          created_at: string
          first_ball_avg: number | null
          frames: number | null
          game_number: number
          id: string
          payload: Json
          played_at: string | null
          player_id: string | null
          score: number | null
          source_url: string
          spares: number | null
          strikes: number | null
          team_slot_id: string | null
          updated_at: string
          week_id: string | null
        }
        Insert: {
          classification: string
          clean_pct?: number | null
          created_at?: string
          first_ball_avg?: number | null
          frames?: number | null
          game_number: number
          id?: string
          payload: Json
          played_at?: string | null
          player_id?: string | null
          score?: number | null
          source_url: string
          spares?: number | null
          strikes?: number | null
          team_slot_id?: string | null
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          classification?: string
          clean_pct?: number | null
          created_at?: string
          first_ball_avg?: number | null
          frames?: number | null
          game_number?: number
          id?: string
          payload?: Json
          played_at?: string | null
          player_id?: string | null
          score?: number | null
          source_url?: string
          spares?: number | null
          strikes?: number | null
          team_slot_id?: string | null
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lanetalk_game_imports_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lanetalk_game_imports_team_slot_id_fkey"
            columns: ["team_slot_id"]
            isOneToOne: false
            referencedRelation: "team_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lanetalk_game_imports_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_ledger: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          loan_id: string
          pin_ledger_id: string | null
          player_id: string
          season_id: string
          type: string
          updated_at: string
          week_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          loan_id: string
          pin_ledger_id?: string | null
          player_id: string
          season_id: string
          type: string
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          loan_id?: string
          pin_ledger_id?: string | null
          player_id?: string
          season_id?: string
          type?: string
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_ledger_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_ledger_pin_ledger_id_fkey"
            columns: ["pin_ledger_id"]
            isOneToOne: false
            referencedRelation: "pin_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_ledger_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_ledger_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_ledger_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_products: {
        Row: {
          available_from: string | null
          available_until: string | null
          borrow_amount: number
          created_at: string
          description: string
          display_name: string
          garnishment_rate: number
          id: string
          is_active: boolean
          max_uses: number | null
          risk_level: string
          season_id: string | null
          sort_order: number
          special_warning_text: string | null
          updated_at: string
          weekly_interest_rate: number
        }
        Insert: {
          available_from?: string | null
          available_until?: string | null
          borrow_amount: number
          created_at?: string
          description: string
          display_name: string
          garnishment_rate: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          risk_level: string
          season_id?: string | null
          sort_order?: number
          special_warning_text?: string | null
          updated_at?: string
          weekly_interest_rate: number
        }
        Update: {
          available_from?: string | null
          available_until?: string | null
          borrow_amount?: number
          created_at?: string
          description?: string
          display_name?: string
          garnishment_rate?: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          risk_level?: string
          season_id?: string | null
          sort_order?: number
          special_warning_text?: string | null
          updated_at?: string
          weekly_interest_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "loan_products_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          created_at: string
          id: string
          issued_at: string
          loan_product_id: string
          paid_off_at: string | null
          player_id: string
          season_closed_at: string | null
          season_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          issued_at?: string
          loan_product_id: string
          paid_off_at?: string | null
          player_id: string
          season_closed_at?: string | null
          season_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          issued_at?: string
          loan_product_id?: string
          paid_off_at?: string | null
          player_id?: string
          season_closed_at?: string | null
          season_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_loan_product_id_fkey"
            columns: ["loan_product_id"]
            isOneToOne: false
            referencedRelation: "loan_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_ledger: {
        Row: {
          amount: number
          auction_id: string | null
          bet_id: string | null
          bounty_post_id: string | null
          created_at: string
          description: string
          id: string
          is_house: boolean
          loan_ledger_id: string | null
          player_id: string | null
          pvp_ledger_id: string | null
          season_id: string
          type: string
          updated_at: string
          week_id: string | null
        }
        Insert: {
          amount: number
          auction_id?: string | null
          bet_id?: string | null
          bounty_post_id?: string | null
          created_at?: string
          description: string
          id?: string
          is_house?: boolean
          loan_ledger_id?: string | null
          player_id?: string | null
          pvp_ledger_id?: string | null
          season_id: string
          type: string
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          amount?: number
          auction_id?: string | null
          bet_id?: string | null
          bounty_post_id?: string | null
          created_at?: string
          description?: string
          id?: string
          is_house?: boolean
          loan_ledger_id?: string | null
          player_id?: string | null
          pvp_ledger_id?: string | null
          season_id?: string
          type?: string
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pin_ledger_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_ledger_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_ledger_bounty_post_id_fkey"
            columns: ["bounty_post_id"]
            isOneToOne: false
            referencedRelation: "bounty_post"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_ledger_loan_ledger_id_fkey"
            columns: ["loan_ledger_id"]
            isOneToOne: false
            referencedRelation: "loan_ledger"
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
            foreignKeyName: "pin_ledger_pvp_ledger_id_fkey"
            columns: ["pvp_ledger_id"]
            isOneToOne: false
            referencedRelation: "pvp_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_ledger_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_ledger_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      player_inventory_items: {
        Row: {
          auction_id: string | null
          catalog_item_id: string
          consumed_at: string | null
          created_at: string
          granted_at: string
          id: string
          player_id: string
          season_id: string
          source: string
          updated_at: string
        }
        Insert: {
          auction_id?: string | null
          catalog_item_id: string
          consumed_at?: string | null
          created_at?: string
          granted_at?: string
          id?: string
          player_id: string
          season_id: string
          source: string
          updated_at?: string
        }
        Update: {
          auction_id?: string | null
          catalog_item_id?: string
          consumed_at?: string | null
          created_at?: string
          granted_at?: string
          id?: string
          player_id?: string
          season_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_inventory_items_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_inventory_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "item_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_inventory_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_inventory_items_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          avatar_path: string | null
          created_at: string
          first_name: string
          id: string
          is_active: boolean
          jersey_purchased: boolean
          last_name: string
          name: string | null
          phone: string | null
          role: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          first_name: string
          id?: string
          is_active?: boolean
          jersey_purchased?: boolean
          last_name: string
          name?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          first_name?: string
          id?: string
          is_active?: boolean
          jersey_purchased?: boolean
          last_name?: string
          name?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      playoff_draft_captains: {
        Row: {
          created_at: string
          draft_id: string
          id: string
          player_id: string
          seed: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          id?: string
          player_id: string
          seed: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          id?: string
          player_id?: string
          seed?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_draft_captains_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "playoff_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_draft_captains_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_draft_picks: {
        Row: {
          captain_player_id: string
          created_at: string
          draft_id: string
          id: string
          pick_number: number
          picked_player_id: string
          updated_at: string
        }
        Insert: {
          captain_player_id: string
          created_at?: string
          draft_id: string
          id?: string
          pick_number: number
          picked_player_id: string
          updated_at?: string
        }
        Update: {
          captain_player_id?: string
          created_at?: string
          draft_id?: string
          id?: string
          pick_number?: number
          picked_player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_draft_picks_captain_player_id_fkey"
            columns: ["captain_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_draft_picks_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "playoff_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_draft_picks_picked_player_id_fkey"
            columns: ["picked_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_draft_pool: {
        Row: {
          created_at: string
          draft_id: string
          id: string
          player_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          id?: string
          player_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          id?: string
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_draft_pool_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "playoff_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_draft_pool_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_drafts: {
        Row: {
          created_at: string
          draft_type: string
          id: string
          season_id: string
          status: string
          updated_at: string
          week_id: string
        }
        Insert: {
          created_at?: string
          draft_type?: string
          id?: string
          season_id: string
          status?: string
          updated_at?: string
          week_id: string
        }
        Update: {
          created_at?: string
          draft_type?: string
          id?: string
          season_id?: string
          status?: string
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_drafts_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_drafts_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      pvp_challenge_offers: {
        Row: {
          accepted_at: string | null
          challenge_id: string
          contract_type: string
          counterparty_selection: string | null
          counterparty_stake: number
          created_at: string
          creator_selection: string | null
          creator_stake: number
          declined_at: string | null
          game_number: number | null
          id: string
          message: string | null
          offer_no: number
          offered_by_player_id: string
          prop_market_id: string | null
          superseded_at: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          challenge_id: string
          contract_type: string
          counterparty_selection?: string | null
          counterparty_stake: number
          created_at?: string
          creator_selection?: string | null
          creator_stake: number
          declined_at?: string | null
          game_number?: number | null
          id?: string
          message?: string | null
          offer_no: number
          offered_by_player_id: string
          prop_market_id?: string | null
          superseded_at?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          challenge_id?: string
          contract_type?: string
          counterparty_selection?: string | null
          counterparty_stake?: number
          created_at?: string
          creator_selection?: string | null
          creator_stake?: number
          declined_at?: string | null
          game_number?: number | null
          id?: string
          message?: string | null
          offer_no?: number
          offered_by_player_id?: string
          prop_market_id?: string | null
          superseded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pvp_challenge_offers_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "pvp_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenge_offers_offered_by_player_id_fkey"
            columns: ["offered_by_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenge_offers_prop_market_id_fkey"
            columns: ["prop_market_id"]
            isOneToOne: false
            referencedRelation: "bet_markets"
            referencedColumns: ["id"]
          },
        ]
      }
      pvp_challenges: {
        Row: {
          accepted_at: string | null
          admin_note: string | null
          contract_type: string
          counterparty_handicap: number
          counterparty_line: number | null
          counterparty_player_id: string | null
          counterparty_selection: string | null
          counterparty_stake: number
          created_at: string
          creator_handicap: number
          creator_line: number | null
          creator_message: string | null
          creator_player_id: string
          creator_selection: string | null
          creator_stake: number
          custom_description: string | null
          custom_title: string | null
          game_number: number | null
          id: string
          locked_at: string | null
          payout_amount: number
          prop_market_id: string | null
          rematch_of_challenge_id: string | null
          result_detail: Json
          season_id: string
          settled_at: string | null
          status: string
          subject_player_id: string | null
          total_pot: number
          updated_at: string
          week_id: string
          winner_player_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          admin_note?: string | null
          contract_type: string
          counterparty_handicap?: number
          counterparty_line?: number | null
          counterparty_player_id?: string | null
          counterparty_selection?: string | null
          counterparty_stake: number
          created_at?: string
          creator_handicap?: number
          creator_line?: number | null
          creator_message?: string | null
          creator_player_id: string
          creator_selection?: string | null
          creator_stake: number
          custom_description?: string | null
          custom_title?: string | null
          game_number?: number | null
          id?: string
          locked_at?: string | null
          payout_amount: number
          prop_market_id?: string | null
          rematch_of_challenge_id?: string | null
          result_detail?: Json
          season_id: string
          settled_at?: string | null
          status?: string
          subject_player_id?: string | null
          total_pot: number
          updated_at?: string
          week_id: string
          winner_player_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          admin_note?: string | null
          contract_type?: string
          counterparty_handicap?: number
          counterparty_line?: number | null
          counterparty_player_id?: string | null
          counterparty_selection?: string | null
          counterparty_stake?: number
          created_at?: string
          creator_handicap?: number
          creator_line?: number | null
          creator_message?: string | null
          creator_player_id?: string
          creator_selection?: string | null
          creator_stake?: number
          custom_description?: string | null
          custom_title?: string | null
          game_number?: number | null
          id?: string
          locked_at?: string | null
          payout_amount?: number
          prop_market_id?: string | null
          rematch_of_challenge_id?: string | null
          result_detail?: Json
          season_id?: string
          settled_at?: string | null
          status?: string
          subject_player_id?: string | null
          total_pot?: number
          updated_at?: string
          week_id?: string
          winner_player_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pvp_challenges_counterparty_player_id_fkey"
            columns: ["counterparty_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenges_creator_player_id_fkey"
            columns: ["creator_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenges_prop_market_id_fkey"
            columns: ["prop_market_id"]
            isOneToOne: false
            referencedRelation: "bet_markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenges_rematch_of_challenge_id_fkey"
            columns: ["rematch_of_challenge_id"]
            isOneToOne: false
            referencedRelation: "pvp_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenges_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenges_subject_player_id_fkey"
            columns: ["subject_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenges_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_challenges_winner_player_id_fkey"
            columns: ["winner_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      pvp_ledger: {
        Row: {
          amount: number
          challenge_id: string
          created_at: string
          description: string
          id: string
          pin_ledger_id: string | null
          player_id: string | null
          season_id: string
          type: string
          updated_at: string
          week_id: string | null
        }
        Insert: {
          amount: number
          challenge_id: string
          created_at?: string
          description: string
          id?: string
          pin_ledger_id?: string | null
          player_id?: string | null
          season_id: string
          type: string
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          amount?: number
          challenge_id?: string
          created_at?: string
          description?: string
          id?: string
          pin_ledger_id?: string | null
          player_id?: string | null
          season_id?: string
          type?: string
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pvp_ledger_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "pvp_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_ledger_pin_ledger_id_fkey"
            columns: ["pin_ledger_id"]
            isOneToOne: false
            referencedRelation: "pin_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_ledger_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_ledger_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pvp_ledger_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          created_at: string
          id: string
          payment_received: boolean
          player_id: string
          season_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          payment_received?: boolean
          player_id: string
          season_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          payment_received?: boolean
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
      week_archive_runs: {
        Row: {
          actor_id: string | null
          archived_at: string
          created_at: string
          details: Json
          id: string
          reversed_at: string | null
          reversed_mode: string | null
          season_id: string
          status: string
          updated_at: string
          week_id: string
        }
        Insert: {
          actor_id?: string | null
          archived_at?: string
          created_at?: string
          details?: Json
          id?: string
          reversed_at?: string | null
          reversed_mode?: string | null
          season_id: string
          status?: string
          updated_at?: string
          week_id: string
        }
        Update: {
          actor_id?: string | null
          archived_at?: string
          created_at?: string
          details?: Json
          id?: string
          reversed_at?: string | null
          reversed_mode?: string | null
          season_id?: string
          status?: string
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_archive_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_archive_runs_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_archive_runs_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      week_archive_snapshot: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json | null
          pk: string
          run_id: string
          table_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json | null
          pk: string
          run_id: string
          table_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          pk?: string
          run_id?: string
          table_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_archive_snapshot_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "week_archive_runs"
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
          is_playoff: boolean
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
          is_playoff?: boolean
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
          is_playoff?: boolean
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
      accept_pvp_challenge: {
        Args: { p_challenge_id: string }
        Returns: undefined
      }
      archive_week: {
        Args: { p_force?: boolean; p_week_id: string }
        Returns: string
      }
      assert_admin: { Args: never; Returns: undefined }
      auction_bid_key: { Args: never; Returns: string }
      cancel_auction: { Args: { p_auction_id: string }; Returns: undefined }
      cancel_auction_bid: { Args: { p_auction_id: string }; Returns: undefined }
      cancel_bet: { Args: { p_bet_id: string }; Returns: undefined }
      cancel_bounty: { Args: { p_bounty_post_id: string }; Returns: undefined }
      cancel_loan: { Args: { p_loan_id: string }; Returns: undefined }
      cancel_pvp_challenge: {
        Args: { p_challenge_id: string }
        Returns: undefined
      }
      close_bounty: { Args: { p_bounty_post_id: string }; Returns: undefined }
      close_open_pvp_challenges: {
        Args: { p_game_number: number; p_week_id: string }
        Returns: undefined
      }
      counter_pvp_challenge: {
        Args: {
          p_challenge_id: string
          p_contract_type: string
          p_counterparty_handicap: number
          p_counterparty_stake: number
          p_creator_handicap: number
          p_creator_stake: number
          p_game_number: number
          p_message: string
          p_prop_market_id: string
          p_selection: string
        }
        Returns: string
      }
      create_auction: {
        Args: {
          p_catalog_key: string
          p_closes_at: string
          p_description: string
          p_minimum_bid: number
          p_opens_at: string
          p_quantity?: number
        }
        Returns: string
      }
      create_catalog_item: {
        Args: {
          p_activation_mode: string
          p_description: string
          p_effect_params: Json
          p_effect_type: string
          p_icon: string
          p_key: string
          p_name: string
        }
        Returns: string
      }
      create_house_bounty: {
        Args: {
          p_closes_at: string
          p_description: string
          p_hunter_stake_amount: number
          p_max_hunters: number
          p_reward_per_hunter: number
          p_title: string
          p_week_id: string
        }
        Returns: string
      }
      create_pvp_challenge: {
        Args: {
          p_contract_type: string
          p_counterparty_handicap: number
          p_counterparty_player_id: string
          p_counterparty_stake: number
          p_creator_handicap: number
          p_creator_selection: string
          p_creator_stake: number
          p_custom_description: string
          p_custom_title: string
          p_game_number: number
          p_message: string
          p_prop_market_id: string
          p_week_id: string
        }
        Returns: string
      }
      create_sponsor_bounty: {
        Args: {
          p_closes_at: string
          p_description: string
          p_hunter_stake_amount: number
          p_max_hunters: number
          p_reward_per_hunter: number
          p_title: string
          p_week_id: string
        }
        Returns: string
      }
      create_system_activity_event: {
        Args: {
          p_event_type: string
          p_public_payload: Json
          p_source_feature: string
          p_template_key: string
        }
        Returns: string
      }
      current_player_id: { Args: never; Returns: string }
      current_season_id: { Args: never; Returns: string }
      custom_access_token: { Args: { event: Json }; Returns: Json }
      decline_pvp_challenge: {
        Args: { p_challenge_id: string }
        Returns: undefined
      }
      decrypt_bid_amount: { Args: { p_enc: string }; Returns: number }
      encrypt_bid_amount: { Args: { p_amount: number }; Returns: string }
      enter_bounty_as_hunter: {
        Args: { p_bounty_post_id: string }
        Returns: string
      }
      finalize_bets_for_market: {
        Args: { p_market_id: string }
        Returns: undefined
      }
      grant_inventory_item: {
        Args: {
          p_catalog_key: string
          p_player_id: string
          p_quantity?: number
        }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_registered_player: { Args: { phone: string }; Returns: boolean }
      lanetalk_game_stats: {
        Args: { p_payload: Json }
        Returns: {
          clean_pct: number
          first_ball_avg: number
          spares: number
          strikes: number
        }[]
      }
      lanetalk_seed_lines: {
        Args: { p_player_id: string }
        Returns: {
          clean_frames_per_game: number
          first_ball_avg_line: number
          spares_line: number
          strikes_line: number
        }[]
      }
      my_bid_amount: { Args: { p_auction_id: string }; Returns: number }
      open_auction_internal: {
        Args: { p_auction_id: string }
        Returns: undefined
      }
      open_auction_now: { Args: { p_auction_id: string }; Returns: undefined }
      pin_balance: {
        Args: { p_player_id: string; p_season_id: string }
        Returns: number
      }
      pin_ledger_double_entry: {
        Args: {
          p_amount: number
          p_auction_id?: string
          p_bet_id?: string
          p_bounty_post_id?: string
          p_description: string
          p_house_description?: string
          p_player_id: string
          p_season_id: string
          p_type: string
          p_week_id: string
        }
        Returns: {
          house_entry_id: string
          player_entry_id: string
        }[]
      }
      place_auction_bid: {
        Args: { p_amount: number; p_auction_id: string }
        Returns: undefined
      }
      place_house_bet: {
        Args: {
          p_custom_line_id?: string
          p_insurance_item_id?: string
          p_selection_ids: string[]
          p_stake: number
        }
        Returns: string
      }
      playoff_create_draft: {
        Args: {
          p_captain_player_ids: string[]
          p_draft_type: string
          p_season_id: string
          p_week_id: string
        }
        Returns: string
      }
      playoff_current_turn: { Args: { p_draft_id: string }; Returns: string }
      playoff_make_pick: {
        Args: { p_draft_id: string; p_player_id: string }
        Returns: undefined
      }
      playoff_materialize_teams: {
        Args: { p_draft_id: string }
        Returns: undefined
      }
      playoff_reset_draft: { Args: { p_draft_id: string }; Returns: undefined }
      playoff_undo_pick: { Args: { p_draft_id: string }; Returns: undefined }
      process_weekly_loans: { Args: { p_week_id: string }; Returns: undefined }
      publish_activity_event: {
        Args: {
          p_actor_player_id: string
          p_admin_payload: Json
          p_auction_id?: string
          p_bounty_post_id?: string
          p_event_type: string
          p_loan_id: string
          p_occurred_at: string
          p_public_payload: Json
          p_pvp_challenge_id?: string
          p_season_id: string
          p_secondary_player_id: string
          p_source_feature: string
          p_sportsbook_bet_id: string
          p_subject_player_id: string
          p_template_key: string
          p_visibility: string
          p_week_id: string
        }
        Returns: string
      }
      pvp_player_line: {
        Args: { p_player_id: string; p_season_id: string }
        Returns: number
      }
      remove_over_under_markets_for_game: {
        Args: { p_game_number: number; p_week_id: string }
        Returns: undefined
      }
      repay_loan: {
        Args: { p_amount: number; p_loan_id: string }
        Returns: undefined
      }
      restore_activity_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      resync_week_markets: {
        Args: { p_moneyline?: boolean; p_week_id: string }
        Returns: undefined
      }
      reverse_settled_auction: {
        Args: { p_auction_id: string }
        Returns: undefined
      }
      settle_auction: { Args: { p_auction_id: string }; Returns: undefined }
      settle_auction_internal: {
        Args: { p_auction_id: string }
        Returns: undefined
      }
      settle_betting_for_week: {
        Args: { p_force?: boolean; p_week_id: string }
        Returns: undefined
      }
      settle_bounty: {
        Args: {
          p_admin_settlement_reasoning: string
          p_bounty_post_id: string
          p_outcome: string
        }
        Returns: undefined
      }
      settle_lanetalk_props_for_week: {
        Args: { p_void_missing?: boolean; p_week_id: string }
        Returns: {
          left_pending: number
          settled: number
          voided: number
        }[]
      }
      settle_loans_for_season_close: {
        Args: { p_season_id: string }
        Returns: undefined
      }
      settle_market: {
        Args: { p_market_id: string; p_result_value: number }
        Returns: undefined
      }
      settle_market_internal: {
        Args: { p_market_id: string; p_result_value: number }
        Returns: undefined
      }
      settle_moneyline_market: {
        Args: { p_market_id: string }
        Returns: undefined
      }
      settle_moneyline_market_internal: {
        Args: { p_market_id: string }
        Returns: undefined
      }
      settle_pvp_challenge: {
        Args: {
          p_admin_note: string
          p_challenge_id: string
          p_source: string
          p_winner_player_id: string
        }
        Returns: undefined
      }
      settle_pvp_for_week: { Args: { p_week_id: string }; Returns: undefined }
      suppress_activity_event: {
        Args: { p_event_id: string; p_reason: string }
        Returns: undefined
      }
      sweep_auctions: { Args: never; Returns: undefined }
      sync_lanetalk_prop_markets_for_week: {
        Args: { p_week_id: string }
        Returns: undefined
      }
      sync_moneyline_markets_for_week: {
        Args: { p_week_id: string }
        Returns: undefined
      }
      sync_over_under_markets_for_week: {
        Args: { p_extra_games?: number[]; p_week_id: string }
        Returns: undefined
      }
      take_loan: { Args: { p_loan_product_id: string }; Returns: string }
      unarchive_week: {
        Args: { p_force?: boolean; p_week_id: string }
        Returns: undefined
      }
      update_auction: {
        Args: {
          p_auction_id: string
          p_catalog_key: string
          p_closes_at: string
          p_description: string
          p_minimum_bid: number
          p_opens_at: string
          p_quantity?: number
        }
        Returns: undefined
      }
      update_catalog_item: {
        Args: {
          p_activation_mode: string
          p_catalog_item_id: string
          p_description: string
          p_effect_params: Json
          p_effect_type: string
          p_icon: string
          p_is_active: boolean
          p_name: string
        }
        Returns: undefined
      }
      void_pvp_challenge: {
        Args: { p_admin_note: string; p_challenge_id: string }
        Returns: undefined
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
