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
          project_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
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
      documents: {
        Row: {
          doc_type: string | null
          drive_file_id: string | null
          file_name: string
          id: string
          meta: Json
          page_count: number | null
          processed_at: string | null
          project_id: string | null
          status: string
          tenant_id: string
          uploaded_at: string
        }
        Insert: {
          doc_type?: string | null
          drive_file_id?: string | null
          file_name: string
          id: string
          meta?: Json
          page_count?: number | null
          processed_at?: string | null
          project_id?: string | null
          status?: string
          tenant_id: string
          uploaded_at?: string
        }
        Update: {
          doc_type?: string | null
          drive_file_id?: string | null
          file_name?: string
          id?: string
          meta?: Json
          page_count?: number | null
          processed_at?: string | null
          project_id?: string | null
          status?: string
          tenant_id?: string
          uploaded_at?: string
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
      estimate_items: {
        Row: {
          created_at: string
          csi_code: string | null
          description: string
          id: string
          item_type: string
          notes: string | null
          project_id: string
          quantity: number | null
          sort_order: number
          tenant_id: string
          trade: string | null
          unit_cost: number | null
          uom: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          csi_code?: string | null
          description: string
          id?: string
          item_type?: string
          notes?: string | null
          project_id: string
          quantity?: number | null
          sort_order?: number
          tenant_id: string
          trade?: string | null
          unit_cost?: number | null
          uom?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          csi_code?: string | null
          description?: string
          id?: string
          item_type?: string
          notes?: string | null
          project_id?: string
          quantity?: number | null
          sort_order?: number
          tenant_id?: string
          trade?: string | null
          unit_cost?: number | null
          uom?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      projects: {
        Row: {
          address: string | null
          budget: number | null
          city: string | null
          created_at: string
          end_date: string | null
          id: string
          meta: Json
          name: string
          start_date: string | null
          state: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          budget?: number | null
          city?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          meta?: Json
          name: string
          start_date?: string | null
          state?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          budget?: number | null
          city?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          meta?: Json
          name?: string
          start_date?: string | null
          state?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
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
      takeoff_items: {
        Row: {
          created_at: string
          csi_code: string | null
          division: string | null
          document_id: string | null
          geo_calib: Json | null
          geom_local: unknown
          geom_sp: unknown
          geom_wgs84: unknown
          id: string
          label: string | null
          meta: Json
          page: number
          points: Json | null
          project_id: string
          px_per_foot: number | null
          quantity: number | null
          rate: number | null
          tenant_id: string
          type: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          csi_code?: string | null
          division?: string | null
          document_id?: string | null
          geo_calib?: Json | null
          geom_local?: unknown
          geom_sp?: unknown
          geom_wgs84?: unknown
          id?: string
          label?: string | null
          meta?: Json
          page: number
          points?: Json | null
          project_id: string
          px_per_foot?: number | null
          quantity?: number | null
          rate?: number | null
          tenant_id: string
          type: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          csi_code?: string | null
          division?: string | null
          document_id?: string | null
          geo_calib?: Json | null
          geom_local?: unknown
          geom_sp?: unknown
          geom_wgs84?: unknown
          id?: string
          label?: string | null
          meta?: Json
          page?: number
          points?: Json | null
          project_id?: string
          px_per_foot?: number | null
          quantity?: number | null
          rate?: number | null
          tenant_id?: string
          type?: string
          unit?: string | null
          updated_at?: string
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
          clerk_org_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          clerk_org_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          clerk_org_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
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
