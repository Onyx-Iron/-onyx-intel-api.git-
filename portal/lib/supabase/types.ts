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
      "1": {
        Row: {
          attrs: Json | null
          created_at: string | null
          id: string | null
          identifier: string | null
          identifier_type: string | null
          instance_id: string | null
          invitation_id: string | null
          updated_at: string | null
        }
        Insert: {
          attrs?: Json | null
          created_at?: string | null
          id?: string | null
          identifier?: string | null
          identifier_type?: string | null
          instance_id?: string | null
          invitation_id?: string | null
          updated_at?: string | null
        }
        Update: {
          attrs?: Json | null
          created_at?: string | null
          id?: string | null
          identifier?: string | null
          identifier_type?: string | null
          instance_id?: string | null
          invitation_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          agent_kind: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          input: Json | null
          output: Json | null
          project_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          agent_kind: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          project_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          agent_kind?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          project_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ai_agent_audit_trails: {
        Row: {
          agent_name: string
          applied_result: Json | null
          created_at: string | null
          document_id: string | null
          execution_trigger: string
          finding_summary: string
          id: string
          page_id: string | null
          project_id: string | null
          recommendations: Json
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          agent_name: string
          applied_result?: Json | null
          created_at?: string | null
          document_id?: string | null
          execution_trigger: string
          finding_summary: string
          id?: string
          page_id?: string | null
          project_id?: string | null
          recommendations?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          agent_name?: string
          applied_result?: Json | null
          created_at?: string | null
          document_id?: string | null
          execution_trigger?: string
          finding_summary?: string
          id?: string
          page_id?: string | null
          project_id?: string | null
          recommendations?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_audit_trails_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_audit_trails_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rate_limit_hits: {
        Row: {
          created_at: string
          id: string
          route: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          route: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          route?: string
          tenant_id?: string
        }
        Relationships: []
      }
      assembly_components: {
        Row: {
          assembly_id: string
          cost_code_ref: string | null
          created_at: string | null
          formula_expression: string
          id: string
          item_type: string
          sort_order: number | null
        }
        Insert: {
          assembly_id: string
          cost_code_ref?: string | null
          created_at?: string | null
          formula_expression: string
          id?: string
          item_type: string
          sort_order?: number | null
        }
        Update: {
          assembly_id?: string
          cost_code_ref?: string | null
          created_at?: string | null
          formula_expression?: string
          id?: string
          item_type?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assembly_components_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "cost_assemblies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          new_values: Json | null
          old_values: Json | null
          record_id: string
          table_name: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id: string
          table_name: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string
          table_name?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      canvas_topo_nodes: {
        Row: {
          created_at: string | null
          created_by: string | null
          elevation: number
          geometry: Json
          id: string
          layer_assignment: string | null
          node_type: string
          page_id: string
          project_id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          elevation: number
          geometry: Json
          id?: string
          layer_assignment?: string | null
          node_type: string
          page_id: string
          project_id: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          elevation?: number
          geometry?: Json
          id?: string
          layer_assignment?: string | null
          node_type?: string
          page_id?: string
          project_id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canvas_topo_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_pricing_history: {
        Row: {
          applied_index_delta: number
          catalog_id: string
          changed_at: string | null
          id: string
          new_price: number
          old_price: number
          tenant_id: string
        }
        Insert: {
          applied_index_delta: number
          catalog_id: string
          changed_at?: string | null
          id?: string
          new_price: number
          old_price: number
          tenant_id: string
        }
        Update: {
          applied_index_delta?: number
          catalog_id?: string
          changed_at?: string | null
          id?: string
          new_price?: number
          old_price?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_pricing_history_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "cost_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      change_order_items: {
        Row: {
          amount: number | null
          approved_date: string | null
          created_at: string
          description: string
          equipment_cost: number | null
          id: string
          labor_cost: number | null
          markup: number | null
          material_cost: number | null
          meta: Json
          notes: string | null
          number: string | null
          project_id: string
          reason: string | null
          request_date: string | null
          status: string
          subcontract_cost: number | null
          submitted_date: string | null
          tenant_id: string
          trade: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          approved_date?: string | null
          created_at?: string
          description: string
          equipment_cost?: number | null
          id?: string
          labor_cost?: number | null
          markup?: number | null
          material_cost?: number | null
          meta?: Json
          notes?: string | null
          number?: string | null
          project_id: string
          reason?: string | null
          request_date?: string | null
          status?: string
          subcontract_cost?: number | null
          submitted_date?: string | null
          tenant_id: string
          trade?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          approved_date?: string | null
          created_at?: string
          description?: string
          equipment_cost?: number | null
          id?: string
          labor_cost?: number | null
          markup?: number | null
          material_cost?: number | null
          meta?: Json
          notes?: string | null
          number?: string | null
          project_id?: string
          reason?: string | null
          request_date?: string | null
          status?: string
          subcontract_cost?: number | null
          submitted_date?: string | null
          tenant_id?: string
          trade?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          fts: unknown
          id: string
          page_number: number | null
          project_id: string
          tenant_id: string
        }
        Insert: {
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          fts?: unknown
          id?: string
          page_number?: number | null
          project_id: string
          tenant_id: string
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          fts?: unknown
          id?: string
          page_number?: number | null
          project_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_area_limits: {
        Row: {
          area_sf: number
          boundary_geometry: Json
          boundary_kind: string
          created_at: string | null
          created_by: string | null
          excavation_volume_cy: number | null
          id: string
          page_id: string | null
          project_id: string
          stripping_depth_in: number | null
          target_cost_code: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          area_sf: number
          boundary_geometry: Json
          boundary_kind: string
          created_at?: string | null
          created_by?: string | null
          excavation_volume_cy?: number | null
          id?: string
          page_id?: string | null
          project_id: string
          stripping_depth_in?: number | null
          target_cost_code?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          area_sf?: number
          boundary_geometry?: Json
          boundary_kind?: string
          created_at?: string | null
          created_by?: string | null
          excavation_volume_cy?: number | null
          id?: string
          page_id?: string | null
          project_id?: string
          stripping_depth_in?: number | null
          target_cost_code?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "civil_area_limits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_construction_entrances: {
        Row: {
          computed: Json | null
          created_at: string | null
          depth_in: number
          fabric_underlayment: boolean | null
          id: string
          length_ft: number
          name: string
          project_id: string
          stone_size: string | null
          tenant_id: string
          updated_at: string | null
          width_ft: number
        }
        Insert: {
          computed?: Json | null
          created_at?: string | null
          depth_in?: number
          fabric_underlayment?: boolean | null
          id?: string
          length_ft?: number
          name: string
          project_id: string
          stone_size?: string | null
          tenant_id: string
          updated_at?: string | null
          width_ft?: number
        }
        Update: {
          computed?: Json | null
          created_at?: string | null
          depth_in?: number
          fabric_underlayment?: boolean | null
          id?: string
          length_ft?: number
          name?: string
          project_id?: string
          stone_size?: string | null
          tenant_id?: string
          updated_at?: string | null
          width_ft?: number
        }
        Relationships: [
          {
            foreignKeyName: "civil_construction_entrances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_material_ledger: {
        Row: {
          created_at: string | null
          direction: string
          haul_distance_mi: number | null
          id: string
          material_type: string
          notes: string | null
          project_id: string
          quantity_bcy: number | null
          quantity_ton: number | null
          scope_ref: string | null
          source_destination: string | null
          tenant_id: string
          unit_of_measure: string | null
          unit_price: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          direction: string
          haul_distance_mi?: number | null
          id?: string
          material_type: string
          notes?: string | null
          project_id: string
          quantity_bcy?: number | null
          quantity_ton?: number | null
          scope_ref?: string | null
          source_destination?: string | null
          tenant_id: string
          unit_of_measure?: string | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          direction?: string
          haul_distance_mi?: number | null
          id?: string
          material_type?: string
          notes?: string | null
          project_id?: string
          quantity_bcy?: number | null
          quantity_ton?: number | null
          scope_ref?: string | null
          source_destination?: string | null
          tenant_id?: string
          unit_of_measure?: string | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "civil_material_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_pipe_runs: {
        Row: {
          avg_depth_ft: number
          backfill_material: string | null
          bedding_depth_in: number | null
          bedding_material: string | null
          computed: Json | null
          created_at: string | null
          diameter_in: number
          haunch_depth_in: number | null
          id: string
          initial_backfill_over_pipe_in: number | null
          length_lf: number
          material: string | null
          name: string
          page_id: string | null
          project_id: string
          shrink_factor: number | null
          swell_factor: number | null
          system: string
          tenant_id: string
          trench_width_ft: number
          updated_at: string | null
        }
        Insert: {
          avg_depth_ft: number
          backfill_material?: string | null
          bedding_depth_in?: number | null
          bedding_material?: string | null
          computed?: Json | null
          created_at?: string | null
          diameter_in: number
          haunch_depth_in?: number | null
          id?: string
          initial_backfill_over_pipe_in?: number | null
          length_lf: number
          material?: string | null
          name: string
          page_id?: string | null
          project_id: string
          shrink_factor?: number | null
          swell_factor?: number | null
          system: string
          tenant_id: string
          trench_width_ft: number
          updated_at?: string | null
        }
        Update: {
          avg_depth_ft?: number
          backfill_material?: string | null
          bedding_depth_in?: number | null
          bedding_material?: string | null
          computed?: Json | null
          created_at?: string | null
          diameter_in?: number
          haunch_depth_in?: number | null
          id?: string
          initial_backfill_over_pipe_in?: number | null
          length_lf?: number
          material?: string | null
          name?: string
          page_id?: string | null
          project_id?: string
          shrink_factor?: number | null
          swell_factor?: number | null
          system?: string
          tenant_id?: string
          trench_width_ft?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "civil_pipe_runs_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civil_pipe_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_stockpiles: {
        Row: {
          created_at: string | null
          id: string
          location_notes: string | null
          material_type: string
          name: string
          project_id: string
          reuse_planned: boolean | null
          swell_factor: number | null
          tenant_id: string
          updated_at: string | null
          volume_bcy: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          location_notes?: string | null
          material_type: string
          name: string
          project_id: string
          reuse_planned?: boolean | null
          swell_factor?: number | null
          tenant_id: string
          updated_at?: string | null
          volume_bcy?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          location_notes?: string | null
          material_type?: string
          name?: string
          project_id?: string
          reuse_planned?: boolean | null
          swell_factor?: number | null
          tenant_id?: string
          updated_at?: string | null
          volume_bcy?: number
        }
        Relationships: [
          {
            foreignKeyName: "civil_stockpiles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_surfaces: {
        Row: {
          coordinate_mesh: Json
          created_at: string | null
          created_by: string | null
          id: string
          name: string | null
          project_id: string
          spot_elevations: Json | null
          surface_type: string
          tenant_id: string
          units: string | null
          updated_at: string | null
        }
        Insert: {
          coordinate_mesh: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string | null
          project_id: string
          spot_elevations?: Json | null
          surface_type: string
          tenant_id: string
          units?: string | null
          updated_at?: string | null
        }
        Update: {
          coordinate_mesh?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string | null
          project_id?: string
          spot_elevations?: Json | null
          surface_type?: string
          tenant_id?: string
          units?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "civil_surfaces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_utility_takeoffs: {
        Row: {
          computed_trench_json: Json | null
          cost_code: string | null
          created_at: string | null
          created_by: string | null
          geometry: Json | null
          id: string
          invert_elevation_end: number | null
          invert_elevation_start: number | null
          page_id: string | null
          pipe_diameter_in: number
          project_id: string
          run_length_lf: number
          system_type: string
          tenant_id: string
          trench_width_ft: number
          updated_at: string | null
          utility_type: string | null
        }
        Insert: {
          computed_trench_json?: Json | null
          cost_code?: string | null
          created_at?: string | null
          created_by?: string | null
          geometry?: Json | null
          id?: string
          invert_elevation_end?: number | null
          invert_elevation_start?: number | null
          page_id?: string | null
          pipe_diameter_in: number
          project_id: string
          run_length_lf: number
          system_type: string
          tenant_id: string
          trench_width_ft: number
          updated_at?: string | null
          utility_type?: string | null
        }
        Update: {
          computed_trench_json?: Json | null
          cost_code?: string | null
          created_at?: string | null
          created_by?: string | null
          geometry?: Json | null
          id?: string
          invert_elevation_end?: number | null
          invert_elevation_start?: number | null
          page_id?: string | null
          pipe_diameter_in?: number
          project_id?: string
          run_length_lf?: number
          system_type?: string
          tenant_id?: string
          trench_width_ft?: number
          updated_at?: string | null
          utility_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "civil_utility_takeoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      co_inspections: {
        Row: {
          certificate_issued_date: string | null
          certificate_number: string | null
          certificate_type: string | null
          corrective_actions: string | null
          created_at: string
          document_id: string | null
          id: string
          inspection_type: string
          inspector_email: string | null
          inspector_name: string | null
          inspector_phone: string | null
          notes: string | null
          project_id: string
          result_date: string | null
          scheduled_date: string | null
          status: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          certificate_issued_date?: string | null
          certificate_number?: string | null
          certificate_type?: string | null
          corrective_actions?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          inspection_type?: string
          inspector_email?: string | null
          inspector_name?: string | null
          inspector_phone?: string | null
          notes?: string | null
          project_id: string
          result_date?: string | null
          scheduled_date?: string | null
          status?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          certificate_issued_date?: string | null
          certificate_number?: string | null
          certificate_type?: string | null
          corrective_actions?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          inspection_type?: string
          inspector_email?: string | null
          inspector_name?: string | null
          inspector_phone?: string | null
          notes?: string | null
          project_id?: string
          result_date?: string | null
          scheduled_date?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      commodity_trend_series: {
        Row: {
          csi_division: string | null
          last_value: number | null
          series_id: string
          updated_at: string | null
        }
        Insert: {
          csi_division?: string | null
          last_value?: number | null
          series_id: string
          updated_at?: string | null
        }
        Update: {
          csi_division?: string | null
          last_value?: number | null
          series_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string | null
          id: string
          name: string
          subscription_status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          subscription_status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          subscription_status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      company_users: {
        Row: {
          clerk_id: string
          company_id: string
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          role_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          clerk_id: string
          company_id: string
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          role_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          clerk_id?: string
          company_id?: string
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          role_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          project_id: string | null
          role: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          project_id?: string | null
          role?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          project_id?: string | null
          role?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          message_count: number
          project_id: string
          summary: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_count?: number
          project_id: string
          summary?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_count?: number
          project_id?: string
          summary?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_actuals: {
        Row: {
          actual_unit_cost: number
          cost_code_id: string | null
          created_at: string | null
          csi_code: string | null
          estimated_unit_cost: number | null
          id: string
          meta: Json | null
          notes: string | null
          observed_at: string
          project_id: string
          quantity: number | null
          region_code: string | null
          source: string | null
          tenant_id: string
          variance_pct: number | null
        }
        Insert: {
          actual_unit_cost: number
          cost_code_id?: string | null
          created_at?: string | null
          csi_code?: string | null
          estimated_unit_cost?: number | null
          id?: string
          meta?: Json | null
          notes?: string | null
          observed_at: string
          project_id: string
          quantity?: number | null
          region_code?: string | null
          source?: string | null
          tenant_id: string
          variance_pct?: number | null
        }
        Update: {
          actual_unit_cost?: number
          cost_code_id?: string | null
          created_at?: string | null
          csi_code?: string | null
          estimated_unit_cost?: number | null
          id?: string
          meta?: Json | null
          notes?: string | null
          observed_at?: string
          project_id?: string
          quantity?: number | null
          region_code?: string | null
          source?: string | null
          tenant_id?: string
          variance_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_actuals_cost_code_id_fkey"
            columns: ["cost_code_id"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_assemblies: {
        Row: {
          assembly_name: string
          created_at: string | null
          csi_code: string
          id: string
          updated_at: string | null
          variable_schema: Json
        }
        Insert: {
          assembly_name: string
          created_at?: string | null
          csi_code: string
          id?: string
          updated_at?: string | null
          variable_schema?: Json
        }
        Update: {
          assembly_name?: string
          created_at?: string | null
          csi_code?: string
          id?: string
          updated_at?: string | null
          variable_schema?: Json
        }
        Relationships: []
      }
      cost_catalog: {
        Row: {
          category: string | null
          created_at: string
          csi_code: string | null
          description: string
          id: string
          tenant_id: string
          trade: string | null
          unit_cost: number
          uom: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          csi_code?: string | null
          description: string
          id?: string
          tenant_id: string
          trade?: string | null
          unit_cost?: number
          uom?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          csi_code?: string | null
          description?: string
          id?: string
          tenant_id?: string
          trade?: string | null
          unit_cost?: number
          uom?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_catalog_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_codes: {
        Row: {
          created_at: string | null
          csi_code: string
          description: string
          division: string
          id: string
          is_active: boolean | null
          trade: string | null
          uom: string | null
        }
        Insert: {
          created_at?: string | null
          csi_code: string
          description: string
          division: string
          id?: string
          is_active?: boolean | null
          trade?: string | null
          uom?: string | null
        }
        Update: {
          created_at?: string | null
          csi_code?: string
          description?: string
          division?: string
          id?: string
          is_active?: boolean | null
          trade?: string | null
          uom?: string | null
        }
        Relationships: []
      }
      cost_indices: {
        Row: {
          base_value: number | null
          created_at: string | null
          division: string | null
          id: string
          index_value: number
          meta: Json | null
          observed_at: string
          region_code: string
          series_code: string
          source: string
        }
        Insert: {
          base_value?: number | null
          created_at?: string | null
          division?: string | null
          id?: string
          index_value: number
          meta?: Json | null
          observed_at: string
          region_code: string
          series_code: string
          source: string
        }
        Update: {
          base_value?: number | null
          created_at?: string | null
          division?: string | null
          id?: string
          index_value?: number
          meta?: Json | null
          observed_at?: string
          region_code?: string
          series_code?: string
          source?: string
        }
        Relationships: []
      }
      cost_overrides: {
        Row: {
          cost_code_id: string
          created_at: string | null
          effective_from: string | null
          equipment_cost: number | null
          id: string
          labor_cost: number | null
          material_cost: number | null
          notes: string | null
          region_code: string | null
          tenant_id: string
          unit_cost: number
          updated_at: string | null
        }
        Insert: {
          cost_code_id: string
          created_at?: string | null
          effective_from?: string | null
          equipment_cost?: number | null
          id?: string
          labor_cost?: number | null
          material_cost?: number | null
          notes?: string | null
          region_code?: string | null
          tenant_id: string
          unit_cost: number
          updated_at?: string | null
        }
        Update: {
          cost_code_id?: string
          created_at?: string | null
          effective_from?: string | null
          equipment_cost?: number | null
          id?: string
          labor_cost?: number | null
          material_cost?: number | null
          notes?: string | null
          region_code?: string | null
          tenant_id?: string
          unit_cost?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_overrides_cost_code_id_fkey"
            columns: ["cost_code_id"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_prices: {
        Row: {
          cost_code_id: string
          created_at: string | null
          currency: string | null
          equipment_cost: number | null
          id: string
          labor_cost: number | null
          material_cost: number | null
          meta: Json | null
          observed_at: string
          region_code: string
          region_type: string
          source: string
          unit_cost: number
          valid_until: string | null
        }
        Insert: {
          cost_code_id: string
          created_at?: string | null
          currency?: string | null
          equipment_cost?: number | null
          id?: string
          labor_cost?: number | null
          material_cost?: number | null
          meta?: Json | null
          observed_at: string
          region_code: string
          region_type: string
          source: string
          unit_cost: number
          valid_until?: string | null
        }
        Update: {
          cost_code_id?: string
          created_at?: string | null
          currency?: string | null
          equipment_cost?: number | null
          id?: string
          labor_cost?: number | null
          material_cost?: number | null
          meta?: Json | null
          observed_at?: string
          region_code?: string
          region_type?: string
          source?: string
          unit_cost?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_prices_cost_code_id_fkey"
            columns: ["cost_code_id"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      cut_fill_computations: {
        Row: {
          computed_at: string
          cut_volume_cy: number | null
          existing_surface_id: string | null
          fill_volume_cy: number | null
          grid: Json | null
          grid_resolution_ft: number | null
          id: string
          net_volume_cy: number | null
          project_id: string
          proposed_surface_id: string | null
          tenant_id: string
        }
        Insert: {
          computed_at?: string
          cut_volume_cy?: number | null
          existing_surface_id?: string | null
          fill_volume_cy?: number | null
          grid?: Json | null
          grid_resolution_ft?: number | null
          id?: string
          net_volume_cy?: number | null
          project_id: string
          proposed_surface_id?: string | null
          tenant_id: string
        }
        Update: {
          computed_at?: string
          cut_volume_cy?: number | null
          existing_surface_id?: string | null
          fill_volume_cy?: number | null
          grid?: Json | null
          grid_resolution_ft?: number | null
          id?: string
          net_volume_cy?: number | null
          project_id?: string
          proposed_surface_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      cut_fill_surfaces: {
        Row: {
          bounds: Json | null
          id: string
          name: string
          point_count: number | null
          points: Json
          project_id: string
          tenant_id: string
          type: string
          uploaded_at: string
        }
        Insert: {
          bounds?: Json | null
          id?: string
          name?: string
          point_count?: number | null
          points?: Json
          project_id: string
          tenant_id: string
          type?: string
          uploaded_at?: string
        }
        Update: {
          bounds?: Json | null
          id?: string
          name?: string
          point_count?: number | null
          points?: Json
          project_id?: string
          tenant_id?: string
          type?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      daily_logs: {
        Row: {
          created_at: string
          created_by: string | null
          crew_count: number | null
          id: string
          log_date: string
          notes: string | null
          photo_urls: Json
          project_id: string
          temperature: string | null
          tenant_id: string
          updated_at: string
          weather: string | null
          work_performed: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          crew_count?: number | null
          id?: string
          log_date?: string
          notes?: string | null
          photo_urls?: Json
          project_id: string
          temperature?: string | null
          tenant_id: string
          updated_at?: string
          weather?: string | null
          work_performed?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          crew_count?: number | null
          id?: string
          log_date?: string
          notes?: string | null
          photo_urls?: Json
          project_id?: string
          temperature?: string | null
          tenant_id?: string
          updated_at?: string
          weather?: string | null
          work_performed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          document_id: string
          embedding: string | null
          id: string
          page_id: string | null
          page_number: number | null
          tenant_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          document_id: string
          embedding?: string | null
          id?: string
          page_id?: string | null
          page_number?: number | null
          tenant_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          document_id?: string
          embedding?: string | null
          id?: string
          page_id?: string | null
          page_number?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      document_intelligence: {
        Row: {
          chunk_index: number
          content: string
          document_id: string | null
          id: string
          meta: Json
          project_id: string
          tenant_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          document_id?: string | null
          id?: string
          meta?: Json
          project_id: string
          tenant_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          document_id?: string | null
          id?: string
          meta?: Json
          project_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_intelligence_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_intelligence_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_intelligence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_pages: {
        Row: {
          attempt_count: number
          checksum: string | null
          created_at: string | null
          document_id: string
          error: string | null
          id: string
          ocr_status: string
          ocr_text: string | null
          page_number: number
          status: string
          storage_path: string
          takeoff_error: string | null
          takeoff_status: string | null
          tenant_id: string
          updated_at: string | null
          vector_status: string
          vectors: Json | null
          vectors_extracted_at: string | null
          vision_extracted_at: string | null
          vision_extractions: Json | null
        }
        Insert: {
          attempt_count?: number
          checksum?: string | null
          created_at?: string | null
          document_id: string
          error?: string | null
          id?: string
          ocr_status?: string
          ocr_text?: string | null
          page_number: number
          status?: string
          storage_path: string
          takeoff_error?: string | null
          takeoff_status?: string | null
          tenant_id: string
          updated_at?: string | null
          vector_status?: string
          vectors?: Json | null
          vectors_extracted_at?: string | null
          vision_extracted_at?: string | null
          vision_extractions?: Json | null
        }
        Update: {
          attempt_count?: number
          checksum?: string | null
          created_at?: string | null
          document_id?: string
          error?: string | null
          id?: string
          ocr_status?: string
          ocr_text?: string | null
          page_number?: number
          status?: string
          storage_path?: string
          takeoff_error?: string | null
          takeoff_status?: string | null
          tenant_id?: string
          updated_at?: string | null
          vector_status?: string
          vectors?: Json | null
          vectors_extracted_at?: string | null
          vision_extracted_at?: string | null
          vision_extractions?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "document_pages_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_processing_events: {
        Row: {
          attempt_number: number
          completed_at: string | null
          document_id: string
          document_page_id: string | null
          error_code: string | null
          error_message: string | null
          id: string
          job_id: string | null
          project_id: string | null
          started_at: string
          status: string
          step: string
          tenant_id: string
          worker: string | null
        }
        Insert: {
          attempt_number?: number
          completed_at?: string | null
          document_id: string
          document_page_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          project_id?: string | null
          started_at?: string
          status: string
          step: string
          tenant_id: string
          worker?: string | null
        }
        Update: {
          attempt_number?: number
          completed_at?: string | null
          document_id?: string
          document_page_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          project_id?: string | null
          started_at?: string
          status?: string
          step?: string
          tenant_id?: string
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_processing_events_document_page_id_fkey"
            columns: ["document_page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          attempt_count: number
          checksum: string | null
          doc_type: string | null
          document_family_id: string | null
          drive_file_id: string | null
          file_name: string
          file_size: number | null
          id: string
          is_current: boolean
          last_error: string | null
          last_error_step: string | null
          last_successful_step: string | null
          meta: Json
          mime_type: string | null
          ocr_status: string
          page_count: number | null
          processed_at: string | null
          processing_completed_at: string | null
          processing_started_at: string | null
          project_id: string | null
          sheet_index_status: string
          split_status: string
          status: string
          supersedes_document_id: string | null
          takeoff_status: string
          tenant_id: string
          uploaded_at: string
          vector_status: string
          version_number: number
        }
        Insert: {
          attempt_count?: number
          checksum?: string | null
          doc_type?: string | null
          document_family_id?: string | null
          drive_file_id?: string | null
          file_name: string
          file_size?: number | null
          id: string
          is_current?: boolean
          last_error?: string | null
          last_error_step?: string | null
          last_successful_step?: string | null
          meta?: Json
          mime_type?: string | null
          ocr_status?: string
          page_count?: number | null
          processed_at?: string | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          project_id?: string | null
          sheet_index_status?: string
          split_status?: string
          status?: string
          supersedes_document_id?: string | null
          takeoff_status?: string
          tenant_id: string
          uploaded_at?: string
          vector_status?: string
          version_number?: number
        }
        Update: {
          attempt_count?: number
          checksum?: string | null
          doc_type?: string | null
          document_family_id?: string | null
          drive_file_id?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          is_current?: boolean
          last_error?: string | null
          last_error_step?: string | null
          last_successful_step?: string | null
          meta?: Json
          mime_type?: string | null
          ocr_status?: string
          page_count?: number | null
          processed_at?: string | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          project_id?: string | null
          sheet_index_status?: string
          split_status?: string
          status?: string
          supersedes_document_id?: string | null
          takeoff_status?: string
          tenant_id?: string
          uploaded_at?: string
          vector_status?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      earthwork_volumes: {
        Row: {
          created_at: string | null
          cut_volume_cy: number
          deductions: Json | null
          fill_volume_cy: number
          id: string
          layer_name: string
          material_type: string | null
          metadata: Json | null
          net_balance_cy: number
          project_id: string
          scope_type: string | null
          shrink_factor: number
          swell_factor: number
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          cut_volume_cy?: number
          deductions?: Json | null
          fill_volume_cy?: number
          id?: string
          layer_name: string
          material_type?: string | null
          metadata?: Json | null
          net_balance_cy?: number
          project_id: string
          scope_type?: string | null
          shrink_factor?: number
          swell_factor?: number
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          cut_volume_cy?: number
          deductions?: Json | null
          fill_volume_cy?: number
          id?: string
          layer_name?: string
          material_type?: string | null
          metadata?: Json | null
          net_balance_cy?: number
          project_id?: string
          scope_type?: string | null
          shrink_factor?: number
          swell_factor?: number
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "earthwork_volumes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_suppliers: {
        Row: {
          created_at: string
          daily_rate: number | null
          equipment_type: string | null
          id: string
          monthly_rate: number | null
          name: string
          notes: string | null
          on_site_date: string | null
          operator: string | null
          project_id: string
          return_date: string | null
          status: string | null
          tenant_id: string
          updated_at: string
          weekly_rate: number | null
        }
        Insert: {
          created_at?: string
          daily_rate?: number | null
          equipment_type?: string | null
          id?: string
          monthly_rate?: number | null
          name?: string
          notes?: string | null
          on_site_date?: string | null
          operator?: string | null
          project_id: string
          return_date?: string | null
          status?: string | null
          tenant_id: string
          updated_at?: string
          weekly_rate?: number | null
        }
        Update: {
          created_at?: string
          daily_rate?: number | null
          equipment_type?: string | null
          id?: string
          monthly_rate?: number | null
          name?: string
          notes?: string | null
          on_site_date?: string | null
          operator?: string | null
          project_id?: string
          return_date?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
          weekly_rate?: number | null
        }
        Relationships: []
      }
      estimate_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          estimate_id: string | null
          estimate_version_id: string | null
          id: string
          project_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          estimate_id?: string | null
          estimate_version_id?: string | null
          id?: string
          project_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          estimate_id?: string | null
          estimate_version_id?: string | null
          id?: string
          project_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      estimate_items: {
        Row: {
          alternate_accepted: boolean
          assembly_id: string | null
          assumptions: string | null
          contingency: number
          cost_code: string | null
          created_at: string
          created_by: string | null
          csi_code: string | null
          description: string
          disposal_cost: number
          drawing_ref: string | null
          equipment_cost: number
          estimate_version_id: string | null
          exclusions: string | null
          id: string
          indirect_cost: number
          is_allowance: boolean
          is_alternate: boolean
          item_type: string
          labor_cost: number
          legacy_source: string | null
          location_tag: string | null
          material_cost: number
          notes: string | null
          other_direct_cost: number
          overhead: number
          pricing_status: string
          profit: number
          project_id: string
          quantity: number | null
          quantity_basis: string | null
          scope_category: string | null
          sort_order: number
          source_document_id: string | null
          source_fingerprint: string | null
          source_sheet_id: string | null
          source_takeoff_id: string | null
          subcontract_cost: number
          tenant_id: string
          testing_cost: number
          total_direct_cost: number
          total_price: number
          trade: string | null
          trucking_cost: number
          unit_cost: number | null
          unit_price: number | null
          uom: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alternate_accepted?: boolean
          assembly_id?: string | null
          assumptions?: string | null
          contingency?: number
          cost_code?: string | null
          created_at?: string
          created_by?: string | null
          csi_code?: string | null
          description: string
          disposal_cost?: number
          drawing_ref?: string | null
          equipment_cost?: number
          estimate_version_id?: string | null
          exclusions?: string | null
          id?: string
          indirect_cost?: number
          is_allowance?: boolean
          is_alternate?: boolean
          item_type?: string
          labor_cost?: number
          legacy_source?: string | null
          location_tag?: string | null
          material_cost?: number
          notes?: string | null
          other_direct_cost?: number
          overhead?: number
          pricing_status?: string
          profit?: number
          project_id: string
          quantity?: number | null
          quantity_basis?: string | null
          scope_category?: string | null
          sort_order?: number
          source_document_id?: string | null
          source_fingerprint?: string | null
          source_sheet_id?: string | null
          source_takeoff_id?: string | null
          subcontract_cost?: number
          tenant_id: string
          testing_cost?: number
          total_direct_cost?: number
          total_price?: number
          trade?: string | null
          trucking_cost?: number
          unit_cost?: number | null
          unit_price?: number | null
          uom?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alternate_accepted?: boolean
          assembly_id?: string | null
          assumptions?: string | null
          contingency?: number
          cost_code?: string | null
          created_at?: string
          created_by?: string | null
          csi_code?: string | null
          description?: string
          disposal_cost?: number
          drawing_ref?: string | null
          equipment_cost?: number
          estimate_version_id?: string | null
          exclusions?: string | null
          id?: string
          indirect_cost?: number
          is_allowance?: boolean
          is_alternate?: boolean
          item_type?: string
          labor_cost?: number
          legacy_source?: string | null
          location_tag?: string | null
          material_cost?: number
          notes?: string | null
          other_direct_cost?: number
          overhead?: number
          pricing_status?: string
          profit?: number
          project_id?: string
          quantity?: number | null
          quantity_basis?: string | null
          scope_category?: string | null
          sort_order?: number
          source_document_id?: string | null
          source_fingerprint?: string | null
          source_sheet_id?: string | null
          source_takeoff_id?: string | null
          subcontract_cost?: number
          tenant_id?: string
          testing_cost?: number
          total_direct_cost?: number
          total_price?: number
          trade?: string | null
          trucking_cost?: number
          unit_cost?: number | null
          unit_price?: number | null
          uom?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_items_estimate_version_id_fkey"
            columns: ["estimate_version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_items_source_takeoff_id_fkey"
            columns: ["source_takeoff_id"]
            isOneToOne: false
            referencedRelation: "takeoff_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_proposals: {
        Row: {
          allowances: Json
          alternates: Json
          assumptions: string | null
          clarifications: string | null
          contractor_info: Json
          created_at: string
          created_by: string | null
          customer_info: Json
          estimate_id: string
          estimate_version_id: string
          exclusions: string | null
          id: string
          payment_terms: string | null
          project_id: string
          project_info: Json
          proposal_number: string
          schedule_assumptions: string | null
          scope: string | null
          tenant_id: string
          total_price: number
          validity_days: number
        }
        Insert: {
          allowances?: Json
          alternates?: Json
          assumptions?: string | null
          clarifications?: string | null
          contractor_info?: Json
          created_at?: string
          created_by?: string | null
          customer_info?: Json
          estimate_id: string
          estimate_version_id: string
          exclusions?: string | null
          id?: string
          payment_terms?: string | null
          project_id: string
          project_info?: Json
          proposal_number: string
          schedule_assumptions?: string | null
          scope?: string | null
          tenant_id: string
          total_price: number
          validity_days?: number
        }
        Update: {
          allowances?: Json
          alternates?: Json
          assumptions?: string | null
          clarifications?: string | null
          contractor_info?: Json
          created_at?: string
          created_by?: string | null
          customer_info?: Json
          estimate_id?: string
          estimate_version_id?: string
          exclusions?: string | null
          id?: string
          payment_terms?: string | null
          project_id?: string
          project_info?: Json
          proposal_number?: string
          schedule_assumptions?: string | null
          scope?: string | null
          tenant_id?: string
          total_price?: number
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_proposals_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_proposals_estimate_version_id_fkey"
            columns: ["estimate_version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_sov: {
        Row: {
          created_at: string
          created_by: string | null
          estimate_id: string
          estimate_version_id: string
          group_by: string
          id: string
          project_id: string
          rows: Json
          tenant_id: string
          total_price: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimate_id: string
          estimate_version_id: string
          group_by?: string
          id?: string
          project_id: string
          rows: Json
          tenant_id: string
          total_price: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          estimate_version_id?: string
          group_by?: string
          id?: string
          project_id?: string
          rows?: Json
          tenant_id?: string
          total_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_sov_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_sov_estimate_version_id_fkey"
            columns: ["estimate_version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_sync_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          event_type: string
          id: string
          last_error: string | null
          manual_takeoff_id: string
          next_attempt_at: string | null
          payload: Json | null
          processed_at: string | null
          project_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          event_type: string
          id?: string
          last_error?: string | null
          manual_takeoff_id: string
          next_attempt_at?: string | null
          payload?: Json | null
          processed_at?: string | null
          project_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          event_type?: string
          id?: string
          last_error?: string | null
          manual_takeoff_id?: string
          next_attempt_at?: string | null
          payload?: Json | null
          processed_at?: string | null
          project_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      estimate_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          contingency_pct: number | null
          created_at: string
          created_by: string | null
          estimate_id: string
          id: string
          notes: string | null
          overhead_pct: number | null
          profit_pct: number | null
          status: string
          superseded_by: string | null
          version_name: string | null
          version_number: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          contingency_pct?: number | null
          created_at?: string
          created_by?: string | null
          estimate_id: string
          id?: string
          notes?: string | null
          overhead_pct?: number | null
          profit_pct?: number | null
          status?: string
          superseded_by?: string | null
          version_name?: string | null
          version_number: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          contingency_pct?: number | null
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          id?: string
          notes?: string | null
          overhead_pct?: number | null
          profit_pct?: number | null
          status?: string
          superseded_by?: string | null
          version_name?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_versions_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_versions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          buyer_type: string
          created_at: string
          created_by: string | null
          current_version_id: string | null
          description: string | null
          estimate_number: string
          estimate_type: string
          id: string
          name: string
          project_id: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          buyer_type?: string
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          estimate_number: string
          estimate_type?: string
          id?: string
          name: string
          project_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          buyer_type?: string
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          estimate_number?: string
          estimate_type?: string
          id?: string
          name?: string
          project_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          doc_type: string
          id: string
          meta: Json
          project_id: string
          provider: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          doc_type: string
          id?: string
          meta?: Json
          project_id: string
          provider?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          doc_type?: string
          id?: string
          meta?: Json
          project_id?: string
          provider?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      google_connections: {
        Row: {
          access_expires_at: string | null
          access_token: string | null
          created_at: string
          email: string | null
          id: string
          refresh_token: string
          scopes: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_expires_at?: string | null
          access_token?: string | null
          created_at?: string
          email?: string | null
          id?: string
          refresh_token: string
          scopes?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_expires_at?: string | null
          access_token?: string | null
          created_at?: string
          email?: string | null
          id?: string
          refresh_token?: string
          scopes?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          direction: string
          due_date: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          notes: string | null
          paid_date: string | null
          payment_method: string | null
          project_id: string
          reference: string | null
          retainage: number | null
          status: string | null
          tenant_id: string
          updated_at: string
          vendor_or_customer: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string | null
          direction?: string
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          project_id: string
          reference?: string | null
          retainage?: number | null
          status?: string | null
          tenant_id: string
          updated_at?: string
          vendor_or_customer?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          direction?: string
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          project_id?: string
          reference?: string | null
          retainage?: number | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
          vendor_or_customer?: string
        }
        Relationships: []
      }
      lien_waivers: {
        Row: {
          amount: number | null
          created_at: string
          document_id: string | null
          draw_number: string | null
          id: string
          notes: string | null
          project_id: string
          signed_at: string | null
          signed_by: string | null
          state: string | null
          status: string | null
          tenant_id: string
          through_date: string | null
          updated_at: string
          vendor_name: string
          waiver_type: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          document_id?: string | null
          draw_number?: string | null
          id?: string
          notes?: string | null
          project_id: string
          signed_at?: string | null
          signed_by?: string | null
          state?: string | null
          status?: string | null
          tenant_id: string
          through_date?: string | null
          updated_at?: string
          vendor_name?: string
          waiver_type?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          document_id?: string | null
          draw_number?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          signed_at?: string | null
          signed_by?: string | null
          state?: string | null
          status?: string | null
          tenant_id?: string
          through_date?: string | null
          updated_at?: string
          vendor_name?: string
          waiver_type?: string
        }
        Relationships: []
      }
      manual_measurements: {
        Row: {
          color: string
          computed_value: number | null
          coords: Json
          created_at: string
          csi_code: string | null
          document_id: string
          id: string
          label: string | null
          measurement_type: string
          notes: string | null
          page_number: number
          project_id: string | null
          scale_factor: number | null
          tenant_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          color?: string
          computed_value?: number | null
          coords: Json
          created_at?: string
          csi_code?: string | null
          document_id: string
          id?: string
          label?: string | null
          measurement_type: string
          notes?: string | null
          page_number: number
          project_id?: string | null
          scale_factor?: number | null
          tenant_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          color?: string
          computed_value?: number | null
          coords?: Json
          created_at?: string
          csi_code?: string | null
          document_id?: string
          id?: string
          label?: string | null
          measurement_type?: string
          notes?: string | null
          page_number?: number
          project_id?: string | null
          scale_factor?: number | null
          tenant_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_measurements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_takeoff_history: {
        Row: {
          action: string
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          manual_takeoff_id: string
          project_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          manual_takeoff_id: string
          project_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          manual_takeoff_id?: string
          project_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      manual_takeoffs: {
        Row: {
          calculated_at: string | null
          calculated_quantity: number | null
          calculated_unit: string | null
          calculation_formula_version: string | null
          client_key: string | null
          cost_code: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          document_id: string | null
          document_version_id: string | null
          geometry: Json
          id: string
          page_id: string | null
          project_id: string
          quantity: number
          row_version: number
          sheet_revision_id: string | null
          takeoff_type: string
          tenant_id: string
          unit: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          calculated_at?: string | null
          calculated_quantity?: number | null
          calculated_unit?: string | null
          calculation_formula_version?: string | null
          client_key?: string | null
          cost_code?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          document_id?: string | null
          document_version_id?: string | null
          geometry: Json
          id?: string
          page_id?: string | null
          project_id: string
          quantity: number
          row_version?: number
          sheet_revision_id?: string | null
          takeoff_type: string
          tenant_id: string
          unit?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          calculated_at?: string | null
          calculated_quantity?: number | null
          calculated_unit?: string | null
          calculation_formula_version?: string | null
          client_key?: string | null
          cost_code?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          document_id?: string | null
          document_version_id?: string | null
          geometry?: Json
          id?: string
          page_id?: string | null
          project_id?: string
          quantity?: number
          row_version?: number
          sheet_revision_id?: string | null
          takeoff_type?: string
          tenant_id?: string
          unit?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_takeoffs_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_takeoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          budget_daily: number
          campaign_name: string
          clicks: number
          company_id: string
          created_at: string | null
          created_by: string | null
          creative: Json | null
          external_campaign_id: string | null
          id: string
          last_synced_at: string | null
          platform: string
          project_id: string | null
          spend_total: number
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          budget_daily?: number
          campaign_name: string
          clicks?: number
          company_id: string
          created_at?: string | null
          created_by?: string | null
          creative?: Json | null
          external_campaign_id?: string | null
          id?: string
          last_synced_at?: string | null
          platform: string
          project_id?: string | null
          spend_total?: number
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          budget_daily?: number
          campaign_name?: string
          clicks?: number
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          creative?: Json | null
          external_campaign_id?: string | null
          id?: string
          last_synced_at?: string | null
          platform?: string
          project_id?: string | null
          spend_total?: number
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_leads: {
        Row: {
          campaign_id: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          project_id: string | null
          request_details: string | null
          source: string | null
          tenant_id: string
        }
        Insert: {
          campaign_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          project_id?: string | null
          request_details?: string | null
          source?: string | null
          tenant_id: string
        }
        Update: {
          campaign_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          project_id?: string | null
          request_details?: string | null
          source?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_leads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_requests: {
        Row: {
          batch_id: string
          batch_label: string | null
          created_at: string | null
          created_by: string | null
          id: string
          item_description: string
          project_id: string
          quantity: number
          required_date: string | null
          source_estimate_id: string | null
          status: string
          tenant_id: string
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          batch_id?: string
          batch_label?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_description: string
          project_id: string
          quantity: number
          required_date?: string | null
          source_estimate_id?: string | null
          status?: string
          tenant_id: string
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_id?: string
          batch_label?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_description?: string
          project_id?: string
          quantity?: number
          required_date?: string | null
          source_estimate_id?: string | null
          status?: string
          tenant_id?: string
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      material_vendors: {
        Row: {
          category: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          lead_time_days: number | null
          name: string
          notes: string | null
          project_id: string
          tenant_id: string
          unit: string | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          lead_time_days?: number | null
          name?: string
          notes?: string | null
          project_id: string
          tenant_id: string
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          lead_time_days?: number | null
          name?: string
          notes?: string | null
          project_id?: string
          tenant_id?: string
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      memories: {
        Row: {
          created_at: string
          fact: string
          id: string
          project_id: string
          source_document_id: string | null
          source_page: number | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          fact: string
          id?: string
          project_id: string
          source_document_id?: string | null
          source_page?: number | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          fact?: string
          id?: string
          project_id?: string
          source_document_id?: string | null
          source_page?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memories_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          citations: Json
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tenant_id: string
        }
        Insert: {
          citations?: Json
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tenant_id: string
        }
        Update: {
          citations?: Json
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          created_at: string
          document_id: string
          extracted_text: string | null
          id: string
          page_number: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          extracted_text?: string | null
          id?: string
          page_number: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          extracted_text?: string | null
          id?: string
          page_number?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      permit_items: {
        Row: {
          application_number: string | null
          approval_date: string | null
          authority: string | null
          created_at: string
          description: string | null
          expiry_date: string | null
          id: string
          notes: string | null
          permit_number: string | null
          permit_type: string
          project_id: string
          required: boolean
          status: string
          submit_date: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          application_number?: string | null
          approval_date?: string | null
          authority?: string | null
          created_at?: string
          description?: string | null
          expiry_date?: string | null
          id?: string
          notes?: string | null
          permit_number?: string | null
          permit_type: string
          project_id: string
          required?: boolean
          status?: string
          submit_date?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          application_number?: string | null
          approval_date?: string | null
          authority?: string | null
          created_at?: string
          description?: string | null
          expiry_date?: string | null
          id?: string
          notes?: string | null
          permit_number?: string | null
          permit_type?: string
          project_id?: string
          required?: boolean
          status?: string
          submit_date?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permit_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permit_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_items: {
        Row: {
          created_at: string
          delivery_date: string | null
          description: string
          id: string
          lead_time_days: number | null
          notes: string | null
          order_date: string | null
          po_number: string | null
          project_id: string
          quantity: number | null
          required_date: string | null
          spec_section: string | null
          status: string
          supplier: string | null
          tenant_id: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_date?: string | null
          description: string
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          order_date?: string | null
          po_number?: string | null
          project_id: string
          quantity?: number | null
          required_date?: string | null
          spec_section?: string | null
          status?: string
          supplier?: string | null
          tenant_id: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_date?: string | null
          description?: string
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          order_date?: string | null
          po_number?: string | null
          project_id?: string
          quantity?: number | null
          required_date?: string | null
          spec_section?: string | null
          status?: string
          supplier?: string | null
          tenant_id?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_change_orders: {
        Row: {
          amount: number | null
          co_number: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          project_id: string
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          co_number?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          project_id: string
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          co_number?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          project_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_change_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_estimates: {
        Row: {
          cost_code: string | null
          created_at: string | null
          description: string | null
          disposal_unit: number | null
          equipment_unit: number | null
          id: string
          labor_unit: number | null
          material_unit: number | null
          notes: string | null
          project_id: string
          quantity: number
          sort_order: number | null
          source: string | null
          subcontractor_unit: number | null
          takeoff_id: string | null
          tenant_id: string
          trucking_unit: number | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          cost_code?: string | null
          created_at?: string | null
          description?: string | null
          disposal_unit?: number | null
          equipment_unit?: number | null
          id?: string
          labor_unit?: number | null
          material_unit?: number | null
          notes?: string | null
          project_id: string
          quantity?: number
          sort_order?: number | null
          source?: string | null
          subcontractor_unit?: number | null
          takeoff_id?: string | null
          tenant_id: string
          trucking_unit?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          cost_code?: string | null
          created_at?: string | null
          description?: string | null
          disposal_unit?: number | null
          equipment_unit?: number | null
          id?: string
          labor_unit?: number | null
          material_unit?: number | null
          notes?: string | null
          project_id?: string
          quantity?: number
          sort_order?: number | null
          source?: string | null
          subcontractor_unit?: number | null
          takeoff_id?: string | null
          tenant_id?: string
          trucking_unit?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_events: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          meta: Json
          project_id: string
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          meta?: Json
          project_id: string
          tenant_id: string
          title: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          meta?: Json
          project_id?: string
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      project_financial_settings: {
        Row: {
          contingency_pct: number | null
          overhead_pct: number | null
          profit_pct: number | null
          project_id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          contingency_pct?: number | null
          overhead_pct?: number | null
          profit_pct?: number | null
          project_id: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          contingency_pct?: number | null
          overhead_pct?: number | null
          profit_pct?: number | null
          project_id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_financial_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_notes: {
        Row: {
          content: string
          id: string
          project_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string
          id?: string
          project_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          id?: string
          project_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_profiles: {
        Row: {
          clerk_user_id: string
          created_at: string | null
          id: string
          role: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          clerk_user_id: string
          created_at?: string | null
          id?: string
          role?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          clerk_user_id?: string
          created_at?: string | null
          id?: string
          role?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_rfis: {
        Row: {
          answer: string | null
          created_at: string | null
          created_by: string | null
          id: string
          project_id: string
          question: string | null
          status: string
          subject: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          project_id: string
          question?: string | null
          status?: string
          subject?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          project_id?: string
          question?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_rfis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_risk_digests: {
        Row: {
          bullets: Json
          data_snapshot: Json
          generated_at: string
          id: string
          project_id: string
          risk_level: string
          tenant_id: string
        }
        Insert: {
          bullets?: Json
          data_snapshot?: Json
          generated_at?: string
          id?: string
          project_id: string
          risk_level?: string
          tenant_id: string
        }
        Update: {
          bullets?: Json
          data_snapshot?: Json
          generated_at?: string
          id?: string
          project_id?: string
          risk_level?: string
          tenant_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          address: string | null
          budget: number | null
          city: string | null
          created_at: string
          end_date: string | null
          georeferences: Json | null
          id: string
          latitude: number | null
          longitude: number | null
          meta: Json
          name: string
          start_date: string | null
          state: string | null
          status: string
          tenant_id: string
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          budget?: number | null
          city?: string | null
          created_at?: string
          end_date?: string | null
          georeferences?: Json | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          meta?: Json
          name: string
          start_date?: string | null
          state?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          budget?: number | null
          city?: string | null
          created_at?: string
          end_date?: string | null
          georeferences?: Json | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          meta?: Json
          name?: string
          start_date?: string | null
          state?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_list_items: {
        Row: {
          completed_date: string | null
          created_at: string
          description: string
          due_date: string | null
          id: string
          item_number: number | null
          location: string | null
          notes: string | null
          priority: string
          project_id: string
          responsible: string | null
          sign_off: string | null
          status: string
          tenant_id: string
          trade: string | null
          updated_at: string
        }
        Insert: {
          completed_date?: string | null
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          item_number?: number | null
          location?: string | null
          notes?: string | null
          priority?: string
          project_id: string
          responsible?: string | null
          sign_off?: string | null
          status?: string
          tenant_id: string
          trade?: string | null
          updated_at?: string
        }
        Update: {
          completed_date?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          item_number?: number | null
          location?: string | null
          notes?: string | null
          priority?: string
          project_id?: string
          responsible?: string | null
          sign_off?: string | null
          status?: string
          tenant_id?: string
          trade?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string | null
          created_by: string | null
          email_sent_at: string | null
          id: string
          po_number: number
          project_id: string
          status: string
          tenant_id: string
          terms: string | null
          total_amount: number
          vendor_bid_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email_sent_at?: string | null
          id?: string
          po_number?: number
          project_id: string
          status?: string
          tenant_id: string
          terms?: string | null
          total_amount: number
          vendor_bid_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email_sent_at?: string | null
          id?: string
          po_number?: number
          project_id?: string
          status?: string
          tenant_id?: string
          terms?: string | null
          total_amount?: number
          vendor_bid_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_bid_id_fkey"
            columns: ["vendor_bid_id"]
            isOneToOne: false
            referencedRelation: "vendor_bids"
            referencedColumns: ["id"]
          },
        ]
      }
      rfi_items: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          discipline: string | null
          due_date: string | null
          id: string
          meta: Json
          number: string | null
          priority: string
          project_id: string
          response: string | null
          response_date: string | null
          status: string
          subject: string
          submitted_date: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          discipline?: string | null
          due_date?: string | null
          id?: string
          meta?: Json
          number?: string | null
          priority?: string
          project_id: string
          response?: string | null
          response_date?: string | null
          status?: string
          subject: string
          submitted_date?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          discipline?: string | null
          due_date?: string | null
          id?: string
          meta?: Json
          number?: string | null
          priority?: string
          project_id?: string
          response?: string | null
          response_date?: string | null
          status?: string
          subject?: string
          submitted_date?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfi_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfi_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          id: string
          name: string
          permissions: Json
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          permissions?: Json
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          permissions?: Json
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      schedule_tasks: {
        Row: {
          created_at: string
          critical: boolean | null
          deps: string[] | null
          duration: number
          ef: number | null
          end_date: string | null
          es: number | null
          free_float: number | null
          id: string
          lf: number | null
          lf_date: string | null
          ls: number | null
          ls_date: string | null
          meta: Json
          name: string
          project_id: string
          start_date: string | null
          status: string
          tenant_id: string
          total_float: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          critical?: boolean | null
          deps?: string[] | null
          duration?: number
          ef?: number | null
          end_date?: string | null
          es?: number | null
          free_float?: number | null
          id?: string
          lf?: number | null
          lf_date?: string | null
          ls?: number | null
          ls_date?: string | null
          meta?: Json
          name: string
          project_id: string
          start_date?: string | null
          status?: string
          tenant_id: string
          total_float?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          critical?: boolean | null
          deps?: string[] | null
          duration?: number
          ef?: number | null
          end_date?: string | null
          es?: number | null
          free_float?: number | null
          id?: string
          lf?: number | null
          lf_date?: string | null
          ls?: number | null
          ls_date?: string | null
          meta?: Json
          name?: string
          project_id?: string
          start_date?: string | null
          status?: string
          tenant_id?: string
          total_float?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_calibration_history: {
        Row: {
          action: string
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          calibration_id: string
          created_at: string
          id: string
          project_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          calibration_id: string
          created_at?: string
          id?: string
          project_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          calibration_id?: string
          created_at?: string
          id?: string
          project_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      sheet_calibrations: {
        Row: {
          active: boolean
          coordinate_system_version: string
          created_at: string | null
          created_by: string | null
          id: string
          known_distance: number | null
          known_unit: string | null
          page_id: string
          page_space_scale_factor: number | null
          point_a_x: number | null
          point_a_y: number | null
          point_b_x: number | null
          point_b_y: number | null
          project_id: string | null
          scale_ratio: number | null
          status: string
          tenant_id: string
          unit_type: string
          updated_at: string | null
          verified: boolean
        }
        Insert: {
          active?: boolean
          coordinate_system_version?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          known_distance?: number | null
          known_unit?: string | null
          page_id: string
          page_space_scale_factor?: number | null
          point_a_x?: number | null
          point_a_y?: number | null
          point_b_x?: number | null
          point_b_y?: number | null
          project_id?: string | null
          scale_ratio?: number | null
          status?: string
          tenant_id: string
          unit_type?: string
          updated_at?: string | null
          verified?: boolean
        }
        Update: {
          active?: boolean
          coordinate_system_version?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          known_distance?: number | null
          known_unit?: string | null
          page_id?: string
          page_space_scale_factor?: number | null
          point_a_x?: number | null
          point_a_y?: number | null
          point_b_x?: number | null
          point_b_y?: number | null
          project_id?: string | null
          scale_ratio?: number | null
          status?: string
          tenant_id?: string
          unit_type?: string
          updated_at?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sheet_calibrations_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: true
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_corrections: {
        Row: {
          after_value: string | null
          before_value: string | null
          corrected_at: string
          corrected_by: string
          field: string
          id: string
          project_id: string
          sheet_id: string
          tenant_id: string
        }
        Insert: {
          after_value?: string | null
          before_value?: string | null
          corrected_at?: string
          corrected_by: string
          field: string
          id?: string
          project_id: string
          sheet_id: string
          tenant_id: string
        }
        Update: {
          after_value?: string | null
          before_value?: string | null
          corrected_at?: string
          corrected_by?: string
          field?: string
          id?: string
          project_id?: string
          sheet_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_corrections_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      sheets: {
        Row: {
          classification_confidence: number | null
          classification_method: string | null
          created_at: string
          created_by: string | null
          discipline: string | null
          document_id: string
          document_page_id: string | null
          embedded_text_available: boolean
          id: string
          is_current: boolean
          ocr_available: boolean
          page_number: number | null
          processing_status: string
          project_id: string
          revision: string | null
          revision_date: string | null
          scale_text: string | null
          sheet_number_normalized: string | null
          sheet_number_raw: string | null
          sheet_title: string | null
          subdiscipline: string | null
          superseded_by_sheet_id: string | null
          supersedes_sheet_id: string | null
          tenant_id: string
          thumbnail_path: string | null
          updated_at: string
          updated_by: string | null
          vector_available: boolean
          verification_status: string
        }
        Insert: {
          classification_confidence?: number | null
          classification_method?: string | null
          created_at?: string
          created_by?: string | null
          discipline?: string | null
          document_id: string
          document_page_id?: string | null
          embedded_text_available?: boolean
          id?: string
          is_current?: boolean
          ocr_available?: boolean
          page_number?: number | null
          processing_status?: string
          project_id: string
          revision?: string | null
          revision_date?: string | null
          scale_text?: string | null
          sheet_number_normalized?: string | null
          sheet_number_raw?: string | null
          sheet_title?: string | null
          subdiscipline?: string | null
          superseded_by_sheet_id?: string | null
          supersedes_sheet_id?: string | null
          tenant_id: string
          thumbnail_path?: string | null
          updated_at?: string
          updated_by?: string | null
          vector_available?: boolean
          verification_status?: string
        }
        Update: {
          classification_confidence?: number | null
          classification_method?: string | null
          created_at?: string
          created_by?: string | null
          discipline?: string | null
          document_id?: string
          document_page_id?: string | null
          embedded_text_available?: boolean
          id?: string
          is_current?: boolean
          ocr_available?: boolean
          page_number?: number | null
          processing_status?: string
          project_id?: string
          revision?: string | null
          revision_date?: string | null
          scale_text?: string | null
          sheet_number_normalized?: string | null
          sheet_number_raw?: string | null
          sheet_title?: string | null
          subdiscipline?: string | null
          superseded_by_sheet_id?: string | null
          supersedes_sheet_id?: string | null
          tenant_id?: string
          thumbnail_path?: string | null
          updated_at?: string
          updated_by?: string | null
          vector_available?: boolean
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheets_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheets_document_page_id_fkey"
            columns: ["document_page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheets_superseded_by_sheet_id_fkey"
            columns: ["superseded_by_sheet_id"]
            isOneToOne: false
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheets_supersedes_sheet_id_fkey"
            columns: ["supersedes_sheet_id"]
            isOneToOne: false
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          assigned_at: string | null
          certifications: string[] | null
          created_at: string
          email: string | null
          hourly_rate: number | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          project_id: string
          project_role: string | null
          removed_at: string | null
          role: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          certifications?: string[] | null
          created_at?: string
          email?: string | null
          hourly_rate?: number | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          project_id: string
          project_role?: string | null
          removed_at?: string | null
          role?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          certifications?: string[] | null
          created_at?: string
          email?: string | null
          hourly_rate?: number | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          project_id?: string
          project_role?: string | null
          removed_at?: string | null
          role?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      submittal_items: {
        Row: {
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          meta: Json
          notes: string | null
          number: string | null
          project_id: string
          responsible: string | null
          returned_date: string | null
          revision: string | null
          spec_section: string | null
          status: string
          submittal_type: string
          submitted_date: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          meta?: Json
          notes?: string | null
          number?: string | null
          project_id: string
          responsible?: string | null
          returned_date?: string | null
          revision?: string | null
          spec_section?: string | null
          status?: string
          submittal_type?: string
          submitted_date?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          meta?: Json
          notes?: string | null
          number?: string | null
          project_id?: string
          responsible?: string | null
          returned_date?: string | null
          revision?: string | null
          spec_section?: string | null
          status?: string
          submittal_type?: string
          submitted_date?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submittal_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submittal_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      takeoff_item_history: {
        Row: {
          action: string
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          project_id: string | null
          takeoff_item_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          project_id?: string | null
          takeoff_item_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          project_id?: string | null
          takeoff_item_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_item_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      takeoff_items: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assembly: string | null
          confidence_score: number | null
          coordinate_system: string
          created_at: string
          created_by: string | null
          csi_code: string | null
          division: string | null
          document_id: string | null
          document_revision: string | null
          geo_calib: Json | null
          geom_local: unknown
          geom_sp: unknown
          geom_wgs84: unknown
          geometry: Json | null
          id: string
          label: string | null
          meta: Json
          page: number
          points: Json | null
          project_id: string
          px_per_foot: number | null
          quantity: number | null
          rate: number | null
          rejected_reason: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          scale_unit: string
          sheet_id: string | null
          sheet_revision: string | null
          source_manual_takeoff_id: string | null
          source_method: string | null
          tenant_id: string
          type: string
          unit: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assembly?: string | null
          confidence_score?: number | null
          coordinate_system?: string
          created_at?: string
          created_by?: string | null
          csi_code?: string | null
          division?: string | null
          document_id?: string | null
          document_revision?: string | null
          geo_calib?: Json | null
          geom_local?: unknown
          geom_sp?: unknown
          geom_wgs84?: unknown
          geometry?: Json | null
          id?: string
          label?: string | null
          meta?: Json
          page: number
          points?: Json | null
          project_id: string
          px_per_foot?: number | null
          quantity?: number | null
          rate?: number | null
          rejected_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scale_unit?: string
          sheet_id?: string | null
          sheet_revision?: string | null
          source_manual_takeoff_id?: string | null
          source_method?: string | null
          tenant_id: string
          type: string
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assembly?: string | null
          confidence_score?: number | null
          coordinate_system?: string
          created_at?: string
          created_by?: string | null
          csi_code?: string | null
          division?: string | null
          document_id?: string | null
          document_revision?: string | null
          geo_calib?: Json | null
          geom_local?: unknown
          geom_sp?: unknown
          geom_wgs84?: unknown
          geometry?: Json | null
          id?: string
          label?: string | null
          meta?: Json
          page?: number
          points?: Json | null
          project_id?: string
          px_per_foot?: number | null
          quantity?: number | null
          rate?: number | null
          rejected_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scale_unit?: string
          sheet_id?: string | null
          sheet_revision?: string | null
          source_manual_takeoff_id?: string | null
          source_method?: string | null
          tenant_id?: string
          type?: string
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_items_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_items_source_manual_takeoff_id_fkey"
            columns: ["source_manual_takeoff_id"]
            isOneToOne: false
            referencedRelation: "manual_takeoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_credits_remaining: number | null
          ai_credits_reset_at: string | null
          clerk_org_id: string
          comp_until: string | null
          created_at: string
          id: string
          name: string
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan_tier: string
          seat_limit: number | null
          seats_used: number | null
          subscription_status: string | null
          trial_ends_at: string | null
        }
        Insert: {
          ai_credits_remaining?: number | null
          ai_credits_reset_at?: string | null
          clerk_org_id: string
          comp_until?: string | null
          created_at?: string
          id?: string
          name: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan_tier?: string
          seat_limit?: number | null
          seats_used?: number | null
          subscription_status?: string | null
          trial_ends_at?: string | null
        }
        Update: {
          ai_credits_remaining?: number | null
          ai_credits_reset_at?: string | null
          clerk_org_id?: string
          comp_until?: string | null
          created_at?: string
          id?: string
          name?: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan_tier?: string
          seat_limit?: number | null
          seats_used?: number | null
          subscription_status?: string | null
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      todo_items: {
        Row: {
          assignee: string | null
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          priority: string
          project_id: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string
          project_id: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string
          project_id?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      vendor_bids: {
        Row: {
          contact_email: string
          id: string
          lead_time_days: number | null
          notes: string | null
          request_id: string
          status: string
          submitted_at: string | null
          tenant_id: string
          unit_price: number
          vendor_name: string
        }
        Insert: {
          contact_email: string
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          request_id: string
          status?: string
          submitted_at?: string | null
          tenant_id: string
          unit_price: number
          vendor_name: string
        }
        Update: {
          contact_email?: string
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          request_id?: string
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          unit_price?: number
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_bids_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "marketplace_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_logs: {
        Row: {
          budget_status: string | null
          created_at: string
          decisions_needed: string | null
          generated_at: string | null
          id: string
          milestones_completed: string | null
          open_issues: string | null
          project_id: string
          schedule_status: string | null
          summary: string | null
          tenant_id: string
          upcoming_milestones: string | null
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          budget_status?: string | null
          created_at?: string
          decisions_needed?: string | null
          generated_at?: string | null
          id?: string
          milestones_completed?: string | null
          open_issues?: string | null
          project_id: string
          schedule_status?: string | null
          summary?: string | null
          tenant_id: string
          upcoming_milestones?: string | null
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          budget_status?: string | null
          created_at?: string
          decisions_needed?: string | null
          generated_at?: string | null
          id?: string
          milestones_completed?: string | null
          open_issues?: string | null
          project_id?: string
          schedule_status?: string | null
          summary?: string | null
          tenant_id?: string
          upcoming_milestones?: string | null
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_vision_extraction_takeoff_items: {
        Args: {
          p_document_id: string
          p_items: Json
          p_page_id: string
          p_page_number: number
          p_project_id: string
          p_tenant_id: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          assembly: string | null
          confidence_score: number | null
          coordinate_system: string
          created_at: string
          created_by: string | null
          csi_code: string | null
          division: string | null
          document_id: string | null
          document_revision: string | null
          geo_calib: Json | null
          geom_local: unknown
          geom_sp: unknown
          geom_wgs84: unknown
          geometry: Json | null
          id: string
          label: string | null
          meta: Json
          page: number
          points: Json | null
          project_id: string
          px_per_foot: number | null
          quantity: number | null
          rate: number | null
          rejected_reason: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          scale_unit: string
          sheet_id: string | null
          sheet_revision: string | null
          source_manual_takeoff_id: string | null
          source_method: string | null
          tenant_id: string
          type: string
          unit: string | null
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "takeoff_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_document_checksum: {
        Args: {
          p_checksum: string
          p_document_id: string
          p_file_size: number
          p_project_id: string
          p_tenant_id: string
        }
        Returns: {
          canonical_document_id: string
          result: string
        }[]
      }
      claim_outbox_events: {
        Args: {
          p_limit: number
          p_visibility_timeout_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          event_type: string
          id: string
          last_error: string | null
          manual_takeoff_id: string
          next_attempt_at: string | null
          payload: Json | null
          processed_at: string | null
          project_id: string
          status: string
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "estimate_sync_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_outbox_event: { Args: { p_id: string }; Returns: undefined }
      current_tenant_id: { Args: never; Returns: string }
      fail_outbox_event: {
        Args: { p_error: string; p_id: string; p_max_attempts?: number }
        Returns: undefined
      }
      match_chunks:
        | {
            Args: {
              match_count?: number
              match_project_id: string
              match_tenant_id: string
              query_embedding: string
            }
            Returns: {
              content: string
              document_id: string
              page_number: number
              similarity: number
            }[]
          }
        | {
            Args: {
              match_count?: number
              match_project_id: string
              match_tenant_id: string
              query_embedding: string
              query_text?: string
              rrf_k?: number
            }
            Returns: {
              content: string
              document_id: string
              page_number: number
              rrf_score: number
              similarity: number
            }[]
          }
      prune_ai_rate_limit_hits: {
        Args: { older_than?: string }
        Returns: undefined
      }
      retry_outbox_event: {
        Args: { p_id: string; p_tenant_id: string }
        Returns: undefined
      }
      save_manual_takeoff_tx: {
        Args: {
          p_actor_user_id: string
          p_calculation_formula_version: string
          p_client_key: string
          p_cost_code: string
          p_document_id: string
          p_geometry: Json
          p_is_vision_sourced: boolean
          p_label: string
          p_page_id: string
          p_project_id: string
          p_quantity: number
          p_takeoff_type: string
          p_tenant_id: string
          p_unit: string
        }
        Returns: {
          manual_takeoff: Json
          mirror_takeoff_item_id: string
          was_update: boolean
        }[]
      }
      soft_delete_manual_takeoff_tx: {
        Args: { p_actor_user_id: string; p_id: string; p_tenant_id: string }
        Returns: {
          already_deleted: boolean
          manual_takeoff: Json
        }[]
      }
      update_manual_takeoff_tx: {
        Args: {
          p_actor_user_id: string
          p_calculation_formula_version: string
          p_cost_code: string
          p_expected_row_version: number
          p_geometry: Json
          p_id: string
          p_quantity: number
          p_tenant_id: string
          p_unit: string
        }
        Returns: {
          conflict: boolean
          manual_takeoff: Json
          mirror_takeoff_item_id: string
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
