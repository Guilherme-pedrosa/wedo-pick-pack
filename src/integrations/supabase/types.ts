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
      box_checkin_items: {
        Row: {
          box_id: string
          checkin_id: string
          created_at: string
          divergencia: number
          id: string
          justificativa_ref: string | null
          justificativa_tipo: string | null
          justificativa_validada: boolean
          nome_produto: string
          produto_id: string
          quantidade_devolvida: number
          quantidade_esperada: number
          reposto: boolean
        }
        Insert: {
          box_id: string
          checkin_id: string
          created_at?: string
          divergencia?: number
          id?: string
          justificativa_ref?: string | null
          justificativa_tipo?: string | null
          justificativa_validada?: boolean
          nome_produto: string
          produto_id: string
          quantidade_devolvida?: number
          quantidade_esperada?: number
          reposto?: boolean
        }
        Update: {
          box_id?: string
          checkin_id?: string
          created_at?: string
          divergencia?: number
          id?: string
          justificativa_ref?: string | null
          justificativa_tipo?: string | null
          justificativa_validada?: boolean
          nome_produto?: string
          produto_id?: string
          quantidade_devolvida?: number
          quantidade_esperada?: number
          reposto?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "box_checkin_items_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "box_checkin_items_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "box_checkin_records"
            referencedColumns: ["id"]
          },
        ]
      }
      box_checkin_records: {
        Row: {
          box_id: string
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          operator_id: string
          operator_name: string
          status: string
        }
        Insert: {
          box_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          operator_id: string
          operator_name?: string
          status?: string
        }
        Update: {
          box_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          operator_id?: string
          operator_name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "box_checkin_records_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      box_handoff_logs: {
        Row: {
          box_id: string
          box_name: string
          created_at: string
          handed_at: string
          id: string
          items_count: number
          operator_id: string
          operator_name: string
          technician_gc_id: string
          technician_name: string
          total_value: number
        }
        Insert: {
          box_id: string
          box_name: string
          created_at?: string
          handed_at?: string
          id?: string
          items_count?: number
          operator_id: string
          operator_name?: string
          technician_gc_id: string
          technician_name: string
          total_value?: number
        }
        Update: {
          box_id?: string
          box_name?: string
          created_at?: string
          handed_at?: string
          id?: string
          items_count?: number
          operator_id?: string
          operator_name?: string
          technician_gc_id?: string
          technician_name?: string
          total_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "box_handoff_logs_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      box_items: {
        Row: {
          added_at: string
          box_id: string
          estoque_gc: number | null
          id: string
          nome_produto: string
          preco_unitario: number | null
          produto_id: string
          quantidade: number
        }
        Insert: {
          added_at?: string
          box_id: string
          estoque_gc?: number | null
          id?: string
          nome_produto: string
          preco_unitario?: number | null
          produto_id: string
          quantidade?: number
        }
        Update: {
          added_at?: string
          box_id?: string
          estoque_gc?: number | null
          id?: string
          nome_produto?: string
          preco_unitario?: number | null
          produto_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "box_items_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      box_movement_logs: {
        Row: {
          action: string
          box_id: string
          box_name: string
          created_at: string
          details: string | null
          id: string
          operator_id: string
          operator_name: string
          preco_unitario: number | null
          produto_id: string | null
          produto_nome: string | null
          quantidade: number | null
          ref_numero: string | null
          ref_tipo: string | null
          saldo_antes: number | null
          saldo_depois: number | null
          technician_gc_id: string | null
          technician_name: string | null
        }
        Insert: {
          action: string
          box_id: string
          box_name: string
          created_at?: string
          details?: string | null
          id?: string
          operator_id: string
          operator_name?: string
          preco_unitario?: number | null
          produto_id?: string | null
          produto_nome?: string | null
          quantidade?: number | null
          ref_numero?: string | null
          ref_tipo?: string | null
          saldo_antes?: number | null
          saldo_depois?: number | null
          technician_gc_id?: string | null
          technician_name?: string | null
        }
        Update: {
          action?: string
          box_id?: string
          box_name?: string
          created_at?: string
          details?: string | null
          id?: string
          operator_id?: string
          operator_name?: string
          preco_unitario?: number | null
          produto_id?: string | null
          produto_nome?: string | null
          quantidade?: number | null
          ref_numero?: string | null
          ref_tipo?: string | null
          saldo_antes?: number | null
          saldo_depois?: number | null
          technician_gc_id?: string | null
          technician_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "box_movement_logs_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      boxes: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          technician_gc_id: string | null
          technician_name: string | null
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name: string
          status?: string
          technician_gc_id?: string | null
          technician_name?: string | null
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          technician_gc_id?: string | null
          technician_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      doc_stock_effect: {
        Row: {
          debit_situacao_id: string | null
          debited: boolean
          debited_at: string | null
          doc_id: string
          doc_type: string
          first_seen_at: string
          id: string
          last_seen_at: string
          payload_hash: string | null
        }
        Insert: {
          debit_situacao_id?: string | null
          debited?: boolean
          debited_at?: string | null
          doc_id: string
          doc_type: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          payload_hash?: string | null
        }
        Update: {
          debit_situacao_id?: string | null
          debited?: boolean
          debited_at?: string | null
          doc_id?: string
          doc_type?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          payload_hash?: string | null
        }
        Relationships: []
      }
      inventory_consumption_events: {
        Row: {
          id: string
          occurred_at: string
          produto_id: string
          qty: number
          raw: Json
          situacao_id: string
          source_id: string
          source_type: string
          valor_custo: number | null
          variacao_id: string | null
        }
        Insert: {
          id?: string
          occurred_at: string
          produto_id: string
          qty: number
          raw?: Json
          situacao_id: string
          source_id: string
          source_type: string
          valor_custo?: number | null
          variacao_id?: string | null
        }
        Update: {
          id?: string
          occurred_at?: string
          produto_id?: string
          qty?: number
          raw?: Json
          situacao_id?: string
          source_id?: string
          source_type?: string
          valor_custo?: number | null
          variacao_id?: string | null
        }
        Relationships: []
      }
      inventory_policy_config: {
        Row: {
          abc_thresholds: Json
          created_at: string
          id: string
          lookback_days: number
          os_stockout_situacao_ids: Json
          purchase_arrived_situacao_ids: Json
          purchase_crossref_situacao_ids: Json
          purchase_lt_start_situacao_id: string
          updated_at: string
          updated_by: string | null
          vendas_stockout_situacao_ids: Json
        }
        Insert: {
          abc_thresholds?: Json
          created_at?: string
          id?: string
          lookback_days?: number
          os_stockout_situacao_ids?: Json
          purchase_arrived_situacao_ids?: Json
          purchase_crossref_situacao_ids?: Json
          purchase_lt_start_situacao_id?: string
          updated_at?: string
          updated_by?: string | null
          vendas_stockout_situacao_ids?: Json
        }
        Update: {
          abc_thresholds?: Json
          created_at?: string
          id?: string
          lookback_days?: number
          os_stockout_situacao_ids?: Json
          purchase_arrived_situacao_ids?: Json
          purchase_crossref_situacao_ids?: Json
          purchase_lt_start_situacao_id?: string
          updated_at?: string
          updated_by?: string | null
          vendas_stockout_situacao_ids?: Json
        }
        Relationships: []
      }
      os_generation_logs: {
        Row: {
          auvo_task_id: string | null
          created_at: string
          equipamento: string | null
          error_message: string | null
          id: string
          nome_cliente: string
          operator_id: string
          operator_name: string
          orcamento_codigo: string
          orcamento_id: string
          os_codigo: string | null
          os_id: string | null
          success: boolean
          valor_total: number | null
          warnings: string[] | null
        }
        Insert: {
          auvo_task_id?: string | null
          created_at?: string
          equipamento?: string | null
          error_message?: string | null
          id?: string
          nome_cliente: string
          operator_id: string
          operator_name?: string
          orcamento_codigo: string
          orcamento_id: string
          os_codigo?: string | null
          os_id?: string | null
          success?: boolean
          valor_total?: number | null
          warnings?: string[] | null
        }
        Update: {
          auvo_task_id?: string | null
          created_at?: string
          equipamento?: string | null
          error_message?: string | null
          id?: string
          nome_cliente?: string
          operator_id?: string
          operator_name?: string
          orcamento_codigo?: string
          orcamento_id?: string
          os_codigo?: string | null
          os_id?: string | null
          success?: boolean
          valor_total?: number | null
          warnings?: string[] | null
        }
        Relationships: []
      }
      product_queries: {
        Row: {
          created_at: string
          id: string
          query: string
          resolved_produto_id: string | null
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          query: string
          resolved_produto_id?: string | null
          source?: string
        }
        Update: {
          created_at?: string
          id?: string
          query?: string
          resolved_produto_id?: string | null
          source?: string
        }
        Relationships: []
      }
      products_index: {
        Row: {
          ativo: boolean
          codigo_barra: string | null
          codigo_interno: string | null
          fingerprint: string
          fornecedor_id: string | null
          last_seen_at: string
          last_synced_at: string
          nome: string
          payload_min_json: Json | null
          possui_variacao: boolean
          produto_id: string
        }
        Insert: {
          ativo?: boolean
          codigo_barra?: string | null
          codigo_interno?: string | null
          fingerprint: string
          fornecedor_id?: string | null
          last_seen_at?: string
          last_synced_at?: string
          nome: string
          payload_min_json?: Json | null
          possui_variacao?: boolean
          produto_id: string
        }
        Update: {
          ativo?: boolean
          codigo_barra?: string | null
          codigo_interno?: string | null
          fingerprint?: string
          fornecedor_id?: string | null
          last_seen_at?: string
          last_synced_at?: string
          nome?: string
          payload_min_json?: Json | null
          possui_variacao?: boolean
          produto_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auvo_user_id: string | null
          created_at: string
          default_os_conclusion_status: string
          default_venda_conclusion_status: string
          gc_usuario_id: string | null
          id: string
          name: string
          os_status_to_show: string[]
          venda_status_to_show: string[]
        }
        Insert: {
          auvo_user_id?: string | null
          created_at?: string
          default_os_conclusion_status?: string
          default_venda_conclusion_status?: string
          gc_usuario_id?: string | null
          id: string
          name: string
          os_status_to_show?: string[]
          venda_status_to_show?: string[]
        }
        Update: {
          auvo_user_id?: string | null
          created_at?: string
          default_os_conclusion_status?: string
          default_venda_conclusion_status?: string
          gc_usuario_id?: string | null
          id?: string
          name?: string
          os_status_to_show?: string[]
          venda_status_to_show?: string[]
        }
        Relationships: []
      }
      separations: {
        Row: {
          client_name: string
          concluded_at: string
          created_at: string
          equipment_name: string | null
          id: string
          invalidated: boolean
          invalidated_at: string | null
          invalidated_reason: string | null
          items_confirmed: number
          items_total: number
          observations: string | null
          operator_name: string
          order_code: string
          order_id: string
          order_type: string
          started_at: string
          status_id: string
          status_name: string
          target_status_id: string
          target_status_name: string
          technician_gc_id: string | null
          technician_name: string | null
          total_value: string
          user_id: string
        }
        Insert: {
          client_name: string
          concluded_at?: string
          created_at?: string
          equipment_name?: string | null
          id?: string
          invalidated?: boolean
          invalidated_at?: string | null
          invalidated_reason?: string | null
          items_confirmed?: number
          items_total?: number
          observations?: string | null
          operator_name?: string
          order_code: string
          order_id: string
          order_type: string
          started_at: string
          status_id: string
          status_name: string
          target_status_id: string
          target_status_name?: string
          technician_gc_id?: string | null
          technician_name?: string | null
          total_value?: string
          user_id: string
        }
        Update: {
          client_name?: string
          concluded_at?: string
          created_at?: string
          equipment_name?: string | null
          id?: string
          invalidated?: boolean
          invalidated_at?: string | null
          invalidated_reason?: string | null
          items_confirmed?: number
          items_total?: number
          observations?: string | null
          operator_name?: string
          order_code?: string
          order_id?: string
          order_type?: string
          started_at?: string
          status_id?: string
          status_name?: string
          target_status_id?: string
          target_status_name?: string
          technician_gc_id?: string | null
          technician_name?: string | null
          total_value?: string
          user_id?: string
        }
        Relationships: []
      }
      supplier_lead_times: {
        Row: {
          avg_lead_time_days: number
          fornecedor_id: string
          fornecedor_nome: string
          id: string
          last_synced_at: string
          max_lead_time_days: number
          min_lead_time_days: number
          sample_count: number
          samples: Json
        }
        Insert: {
          avg_lead_time_days?: number
          fornecedor_id: string
          fornecedor_nome: string
          id?: string
          last_synced_at?: string
          max_lead_time_days?: number
          min_lead_time_days?: number
          sample_count?: number
          samples?: Json
        }
        Update: {
          avg_lead_time_days?: number
          fornecedor_id?: string
          fornecedor_nome?: string
          id?: string
          last_synced_at?: string
          max_lead_time_days?: number
          min_lead_time_days?: number
          sample_count?: number
          samples?: Json
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          errors_count: number
          fetched_count: number
          finished_at: string | null
          id: string
          notes: string | null
          run_type: string
          started_at: string
          status: string
          total_count: number
          upsert_count: number
        }
        Insert: {
          errors_count?: number
          fetched_count?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          run_type: string
          started_at?: string
          status?: string
          total_count?: number
          upsert_count?: number
        }
        Update: {
          errors_count?: number
          fetched_count?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          run_type?: string
          started_at?: string
          status?: string
          total_count?: number
          upsert_count?: number
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          module: string
          user_id: string
          user_name: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          module: string
          user_id: string
          user_name?: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          module?: string
          user_id?: string
          user_name?: string
        }
        Relationships: []
      }
      technicians: {
        Row: {
          active: boolean
          created_at: string
          gc_id: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          gc_id: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          gc_id?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      toolbox_conference_items: {
        Row: {
          conference_id: string
          created_at: string
          id: string
          nome_produto: string
          observacao: string | null
          presente: boolean
          produto_id: string
          quantidade_esperada: number
          toolbox_id: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          id?: string
          nome_produto: string
          observacao?: string | null
          presente?: boolean
          produto_id: string
          quantidade_esperada?: number
          toolbox_id: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          id?: string
          nome_produto?: string
          observacao?: string | null
          presente?: boolean
          produto_id?: string
          quantidade_esperada?: number
          toolbox_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_conference_items_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "toolbox_conference_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_conference_items_toolbox_id_fkey"
            columns: ["toolbox_id"]
            isOneToOne: false
            referencedRelation: "toolboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      toolbox_conference_records: {
        Row: {
          created_at: string
          id: string
          items_missing: number
          items_present: number
          items_total: number
          notes: string | null
          operator_id: string
          operator_name: string
          status: string
          toolbox_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          items_missing?: number
          items_present?: number
          items_total?: number
          notes?: string | null
          operator_id: string
          operator_name?: string
          status?: string
          toolbox_id: string
        }
        Update: {
          created_at?: string
          id?: string
          items_missing?: number
          items_present?: number
          items_total?: number
          notes?: string | null
          operator_id?: string
          operator_name?: string
          status?: string
          toolbox_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_conference_records_toolbox_id_fkey"
            columns: ["toolbox_id"]
            isOneToOne: false
            referencedRelation: "toolboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      toolbox_items: {
        Row: {
          added_at: string
          id: string
          nome_produto: string
          preco_unitario: number | null
          produto_id: string
          quantidade: number
          toolbox_id: string
        }
        Insert: {
          added_at?: string
          id?: string
          nome_produto: string
          preco_unitario?: number | null
          produto_id: string
          quantidade?: number
          toolbox_id: string
        }
        Update: {
          added_at?: string
          id?: string
          nome_produto?: string
          preco_unitario?: number | null
          produto_id?: string
          quantidade?: number
          toolbox_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_items_toolbox_id_fkey"
            columns: ["toolbox_id"]
            isOneToOne: false
            referencedRelation: "toolboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      toolbox_movement_logs: {
        Row: {
          action: string
          created_at: string
          details: string | null
          id: string
          operator_id: string
          operator_name: string
          preco_unitario: number | null
          produto_id: string | null
          produto_nome: string | null
          quantidade: number | null
          ref_numero: string | null
          ref_tipo: string | null
          technician_gc_id: string | null
          technician_name: string | null
          toolbox_id: string
          toolbox_name: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: string | null
          id?: string
          operator_id: string
          operator_name?: string
          preco_unitario?: number | null
          produto_id?: string | null
          produto_nome?: string | null
          quantidade?: number | null
          ref_numero?: string | null
          ref_tipo?: string | null
          technician_gc_id?: string | null
          technician_name?: string | null
          toolbox_id: string
          toolbox_name: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: string | null
          id?: string
          operator_id?: string
          operator_name?: string
          preco_unitario?: number | null
          produto_id?: string | null
          produto_nome?: string | null
          quantidade?: number | null
          ref_numero?: string | null
          ref_tipo?: string | null
          technician_gc_id?: string | null
          technician_name?: string | null
          toolbox_id?: string
          toolbox_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_movement_logs_toolbox_id_fkey"
            columns: ["toolbox_id"]
            isOneToOne: false
            referencedRelation: "toolboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      toolboxes: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          technician_gc_id: string | null
          technician_name: string | null
          user_id: string
          venda_gc_id: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name: string
          status?: string
          technician_gc_id?: string | null
          technician_name?: string | null
          user_id: string
          venda_gc_id?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          technician_gc_id?: string | null
          technician_name?: string | null
          user_id?: string
          venda_gc_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      has_any_admin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "user"
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
    },
  },
} as const
