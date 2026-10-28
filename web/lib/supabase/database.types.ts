
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "assets": {
                  Row: {
                    "created_at": string,"document_id": string,"id": string,"image_path": string | null,"kind": Database["public"]['Enums']["asset_kind"],"page": number,"payload": NonNullable<Json>,"picture_kind": string | null,"tier": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"document_id": string,"id": string,"image_path"?: string | null,"kind": Database["public"]['Enums']["asset_kind"],"page": number,"payload": NonNullable<Json>,"picture_kind"?: string | null,"tier": number,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"document_id"?: string,"id"?: string,"image_path"?: string | null,"kind"?: Database["public"]['Enums']["asset_kind"],"page"?: number,"payload"?: NonNullable<Json>,"picture_kind"?: string | null,"tier"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assets_document_id_user_id_fkey"
      columns: ["document_id","user_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"attempts": {
                  Row: {
                    "answered_at": string,"correct": boolean,"id": string,"marking": Json | null,"question_id": string,"response": NonNullable<Json>,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answered_at"?: string,"correct": boolean,"id"?: string,"marking"?: Json | null,"question_id": string,"response": NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "answered_at"?: string,"correct"?: boolean,"id"?: string,"marking"?: Json | null,"question_id"?: string,"response"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attempts_question_id_user_id_fkey"
      columns: ["question_id","user_id"]
isOneToOne: false
      referencedRelation: "questions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"credit_ledger": {
                  Row: {
                    "created_at": string,"delta": number,"document_id": string | null,"hold_id": string | null,"id": string,"note": string | null,"reason": Database["public"]['Enums']["credit_reason"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"delta": number,"document_id"?: string | null,"hold_id"?: string | null,"id"?: string,"note"?: string | null,"reason": Database["public"]['Enums']["credit_reason"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"delta"?: number,"document_id"?: string | null,"hold_id"?: string | null,"id"?: string,"note"?: string | null,"reason"?: Database["public"]['Enums']["credit_reason"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_ledger_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_ledger_hold_id_fkey"
      columns: ["hold_id"]
isOneToOne: false
      referencedRelation: "credit_ledger"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "created_at": string,"error": string | null,"filename": string,"id": string,"mime": string,"page_count": number | null,"pages_waiting": number,"size_bytes": number,"status": Database["public"]['Enums']["document_status"],"storage_path": string,"unit_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"error"?: string | null,"filename": string,"id"?: string,"mime": string,"page_count"?: number | null,"pages_waiting"?: number,"size_bytes": number,"status"?: Database["public"]['Enums']["document_status"],"storage_path": string,"unit_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"error"?: string | null,"filename"?: string,"id"?: string,"mime"?: string,"page_count"?: number | null,"pages_waiting"?: number,"size_bytes"?: number,"status"?: Database["public"]['Enums']["document_status"],"storage_path"?: string,"unit_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_unit_id_user_id_fkey"
      columns: ["unit_id","user_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"guest_starts": {
                  Row: {
                    "created_at": string,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never
                  }
                  Update: {
                    "created_at"?: string,"id"?: never
                  }
                  Relationships: [
                    
                  ]
                },"llm_requests": {
                  Row: {
                    "batch": boolean,"cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number,"created_at": string,"document_id": string | null,"id": string,"input_tokens": number,"model": string,"output_tokens": number,"provider_request_id": string | null,"route": string,"stop_reason": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch"?: boolean,"cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd": number,"created_at"?: string,"document_id"?: string | null,"id"?: string,"input_tokens"?: number,"model": string,"output_tokens"?: number,"provider_request_id"?: string | null,"route": string,"stop_reason"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "batch"?: boolean,"cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"document_id"?: string | null,"id"?: string,"input_tokens"?: number,"model"?: string,"output_tokens"?: number,"provider_request_id"?: string | null,"route"?: string,"stop_reason"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "llm_requests_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"question_keys": {
                  Row: {
                    "answer_key": NonNullable<Json>,"created_at": string,"question_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer_key": NonNullable<Json>,"created_at"?: string,"question_id": string
                  }
                  Update: {
                    "answer_key"?: NonNullable<Json>,"created_at"?: string,"question_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_keys_question_id_fkey"
      columns: ["question_id"]
isOneToOne: true
      referencedRelation: "questions"
      referencedColumns: ["id"]
    }
                  ]
                },"questions": {
                  Row: {
                    "asset_id": string | null,"created_at": string,"document_id": string,"error": string | null,"id": string,"image_path": string | null,"model_used": string | null,"payload": NonNullable<Json>,"source_page": number,"source_ref": string,"status": Database["public"]['Enums']["question_status"],"title": string,"type": Database["public"]['Enums']["question_type"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id"?: string | null,"created_at"?: string,"document_id": string,"error"?: string | null,"id"?: string,"image_path"?: string | null,"model_used"?: string | null,"payload": NonNullable<Json>,"source_page": number,"source_ref": string,"status": Database["public"]['Enums']["question_status"],"title": string,"type": Database["public"]['Enums']["question_type"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "asset_id"?: string | null,"created_at"?: string,"document_id"?: string,"error"?: string | null,"id"?: string,"image_path"?: string | null,"model_used"?: string | null,"payload"?: NonNullable<Json>,"source_page"?: number,"source_ref"?: string,"status"?: Database["public"]['Enums']["question_status"],"title"?: string,"type"?: Database["public"]['Enums']["question_type"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "questions_asset_id_document_id_fkey"
      columns: ["asset_id","document_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["id","document_id"]
    },{
      foreignKeyName: "questions_document_id_user_id_fkey"
      columns: ["document_id","user_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"units": {
                  Row: {
                    "created_at": string,"exam_date": string | null,"id": string,"name": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"exam_date"?: string | null,"id"?: string,"name": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"exam_date"?: string | null,"id"?: string,"name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"usage_counters": {
                  Row: {
                    "period_start": string,"questions_generated": number,"uploads_used": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "period_start": string,"questions_generated"?: number,"uploads_used"?: number,"user_id": string
                  }
                  Update: {
                    "period_start"?: string,"questions_generated"?: number,"uploads_used"?: number,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "credit_balance": {
                  Row: {
                    "balance": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"deck_progress": {
                  Row: {
                    "answered": number | null,"cover_image_path": string | null,"document_id": string,"last_answered_at": string | null,"questions": number | null,"types": (Database["public"]['Enums']["question_type"])[] | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "questions_document_id_user_id_fkey"
      columns: ["document_id","user_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id","user_id"]
    }
                  ]
                }
          }
          Functions: {
            "claim_next_job":
{ Args: { "visibility_seconds"?: number }; Returns: {
              "message": Json,"msg_id": number,"queue_name": string,"read_ct": number
            }[]
                           },
"complete_blank":
{ Args: { "image_path": string,"msg_id": number }; Returns: boolean
                           },
"complete_extract":
{ Args: { "assets": Json,"msg_id": number,"page_count": number }; Returns: boolean
                           },
"create_question":
{ Args: { "answer_key"?: Json,"asset_id"?: string,"document_id": string,"model_used"?: string,"payload": Json,"source_page": number,"title": string,"type": Database["public"]['Enums']["question_type"] }; Returns: string
                           },
"enqueue_extract":
{ Args: { "document_id": string,"user_id": string }; Returns: number
                           },
"fail_job":
{ Args: { "msg_id": number,"queue_name": string,"reason": string }; Returns: boolean
                           },
"grant_credits":
{ Args: { "amount": number,"note": string,"user_id": string }; Returns: string
                           },
"grant_guest_credits":
{ Args: { "user_id": string }; Returns: boolean
                           },
"hold_credits":
{ Args: { "document_id": string,"pages": number }; Returns: {
              "held": number,"hold_id": string
            }[]
                           },
"refund_marking":
{ Args: { "spend_id": string }; Returns: undefined
                           },
"release_credits":
{ Args: { "hold_id": string }; Returns: number
                           },
"retry_job_later":
{ Args: { "delay_seconds": number,"msg_id": number,"queue_name": string }; Returns: boolean
                           },
"spend_marking":
{ Args: { "amount": number,"question_id": string }; Returns: string
                           }
          }
          Enums: {
            "asset_kind": "text_block"|"labeled_diagram"|"table","credit_reason": "welcome_guest"|"welcome_account"|"deck_hold"|"deck_release"|"admin_grant"|"marking"|"marking_refund","document_status": "uploading"|"queued"|"processing"|"extracted"|"generating"|"ready"|"failed","question_status": "pending"|"ready"|"failed","question_type": "diagram_blank"|"table_blank"|"mcq"|"short_answer"|"flashcard"|"essay"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "asset_kind": ["text_block", "labeled_diagram", "table"],"credit_reason": ["welcome_guest", "welcome_account", "deck_hold", "deck_release", "admin_grant", "marking", "marking_refund"],"document_status": ["uploading", "queued", "processing", "extracted", "generating", "ready", "failed"],"question_status": ["pending", "ready", "failed"],"question_type": ["diagram_blank", "table_blank", "mcq", "short_answer", "flashcard", "essay"]
          }
        }
} as const
