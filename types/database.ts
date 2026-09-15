export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      response_revisions: {
        Row: { user_id: string; kind: string; session_id: string; question_id: string; revision: number; mutation_id: string; receipt: Json };
        Insert: { user_id: string; kind: string; session_id: string; question_id: string; revision: number; mutation_id: string; receipt: Json };
        Update: Partial<Database["public"]["Tables"]["response_revisions"]["Insert"]>;
        Relationships: [];
      };
      rate_limit_buckets: {
        Row: { bucket_key: string; tokens: number; updated_at: string };
        Insert: { bucket_key: string; tokens: number; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["rate_limit_buckets"]["Insert"]>;
        Relationships: [];
      };
      session_creation_claims: {
        Row: { user_id: string; kind: string; fingerprint: string; session_id: string | null; claimed_at: string };
        Insert: { user_id: string; kind: string; fingerprint: string; session_id?: string | null; claimed_at?: string };
        Update: Partial<Database["public"]["Tables"]["session_creation_claims"]["Insert"]>;
        Relationships: [];
      };
      billing_plans: {
        Row: {
          slug: string;
          name: string;
          tier: "free" | "master";
          price_kobo: number;
          currency: string;
          duration_days: number | null;
          is_active: boolean;
          is_popular: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          slug: string;
          name: string;
          tier: "free" | "master";
          price_kobo: number;
          currency?: string;
          duration_days?: number | null;
          is_active?: boolean;
          is_popular?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["billing_plans"]["Insert"]>;
        Relationships: [];
      };
      payment_transactions: {
        Row: {
          id: string;
          user_id: string;
          plan_slug: string;
          reference: string;
          provider: string;
          environment: "test" | "live";
          amount_kobo: number;
          currency: string;
          access_days: number;
          status: "pending" | "success" | "failed" | "abandoned" | "reversed";
          authorization_url: string | null;
          provider_transaction_id: string | null;
          provider_status: string | null;
          failure_reason: string | null;
          paid_at: string | null;
          applied_at: string | null;
          entitlement_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan_slug: string;
          reference: string;
          provider?: string;
          environment: "test" | "live";
          amount_kobo: number;
          currency: string;
          access_days: number;
          status: "pending" | "success" | "failed" | "abandoned" | "reversed";
          authorization_url?: string | null;
          provider_transaction_id?: string | null;
          provider_status?: string | null;
          failure_reason?: string | null;
          paid_at?: string | null;
          applied_at?: string | null;
          entitlement_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["payment_transactions"]["Insert"]>;
        Relationships: [];
      };
      user_entitlements: {
        Row: {
          user_id: string;
          tier: "free" | "master";
          plan_slug: string | null;
          expires_at: string | null;
          activated_at: string | null;
          last_payment_id: string | null;
          total_paid_kobo: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          tier?: "free" | "master";
          plan_slug?: string | null;
          expires_at?: string | null;
          activated_at?: string | null;
          last_payment_id?: string | null;
          total_paid_kobo?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_entitlements"]["Insert"]>;
        Relationships: [];
      };
      entitlement_events: {
        Row: {
          id: number;
          user_id: string;
          payment_id: string | null;
          event_type: "granted" | "extended";
          plan_slug: string | null;
          previous_tier: string | null;
          previous_expires_at: string | null;
          new_tier: string | null;
          new_expires_at: string | null;
          source: "payment" | "admin";
          actor_id: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          payment_id?: string | null;
          event_type: "granted" | "extended";
          plan_slug?: string | null;
          previous_tier?: string | null;
          previous_expires_at?: string | null;
          new_tier?: string | null;
          new_expires_at?: string | null;
          source?: "payment" | "admin";
          actor_id?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["entitlement_events"]["Insert"]>;
        Relationships: [];
      };
      billing_webhook_events: {
        Row: {
          id: number;
          provider: string;
          event_id: string;
          event_type: string;
          reference: string | null;
          outcome: "received" | "applied" | "ignored" | "rejected" | "duplicate";
          detail: string | null;
          claim_expires_at: string;
          received_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: number;
          provider?: string;
          event_id: string;
          event_type: string;
          reference?: string | null;
          outcome: "received" | "applied" | "ignored" | "rejected" | "duplicate";
          detail?: string | null;
          claim_expires_at?: string;
          received_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["billing_webhook_events"]["Insert"]>;
        Relationships: [];
      };
      product_usage_windows: {
        Row: { user_id: string; capability: string; window_key: string; updated_at: string };
        Insert: { user_id: string; capability: string; window_key: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["product_usage_windows"]["Insert"]>;
        Relationships: [];
      };
      product_usage_reservations: {
        Row: {
          id: string;
          user_id: string;
          capability: string;
          window_key: string;
          state: "reserved" | "committed";
          lease_expires_at: string | null;
          committed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          capability: string;
          window_key: string;
          state: "reserved" | "committed";
          lease_expires_at?: string | null;
          committed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["product_usage_reservations"]["Insert"]>;
        Relationships: [];
      };
      external_api_usage: {
        Row: {
          id: number;
          provider: string;
          endpoint: string;
          request_type: "practice" | "mock" | "probe" | "other";
          exam_body: string | null;
          subject: string | null;
          requested_question_count: number | null;
          question_count: number;
          http_status: number | null;
          outcome: "ok" | "retry" | "failed";
          duration_ms: number;
          credits_used: number | null;
          credits_remaining: number | null;
          provider_request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          provider: string;
          endpoint: string;
          request_type: "practice" | "mock" | "probe" | "other";
          exam_body?: string | null;
          subject?: string | null;
          requested_question_count?: number | null;
          question_count?: number;
          http_status?: number | null;
          outcome: "ok" | "retry" | "failed";
          duration_ms: number;
          credits_used?: number | null;
          credits_remaining?: number | null;
          provider_request_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["external_api_usage"]["Insert"]>;
        Relationships: [];
      };
      ai_explanation_cache: {
        Row: {
          cache_key: string;
          question_fingerprint: string;
          explanation_type: "explain_better" | "why_wrong";
          selected_option_key: string | null;
          prompt_version: string;
          provider: string;
          model: string;
          status: "pending" | "completed";
          content: Json | null;
          lease_expires_at: string;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          cache_key: string;
          question_fingerprint: string;
          explanation_type: "explain_better" | "why_wrong";
          selected_option_key?: string | null;
          prompt_version: string;
          provider: string;
          model: string;
          status?: "pending" | "completed";
          content?: Json | null;
          lease_expires_at: string;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_explanation_cache"]["Insert"]>;
        Relationships: [];
      };
      ai_daily_usage: {
        Row: { user_id: string; usage_date: string; feature: "question_explanation"; generation_count: number; updated_at: string };
        Insert: { user_id: string; usage_date?: string; feature: "question_explanation"; generation_count?: number; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["ai_daily_usage"]["Insert"]>;
        Relationships: [];
      };
      ai_usage: {
        Row: {
          id: number;
          user_id: string;
          feature: "question_explanation";
          explanation_type: "explain_better" | "why_wrong";
          provider: string;
          model: string;
          input_tokens: number | null;
          output_tokens: number | null;
          cache_hit: boolean;
          duration_ms: number;
          status: "ok" | "failed";
          error_category: string | null;
          prompt_version: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          feature: "question_explanation";
          explanation_type: "explain_better" | "why_wrong";
          provider: string;
          model: string;
          input_tokens?: number | null;
          output_tokens?: number | null;
          cache_hit?: boolean;
          duration_ms: number;
          status: "ok" | "failed";
          error_category?: string | null;
          prompt_version: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_usage"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          avatar_url?: string | null;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          avatar_url?: string | null;
          onboarding_completed?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      exam_bodies: {
        Row: {
          id: string;
          code: string;
          name: string;
          short_name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          short_name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_bodies"]["Insert"]>;
        Relationships: [];
      };
      subjects: {
        Row: {
          id: string;
          slug: string;
          name: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subjects"]["Insert"]>;
        Relationships: [];
      };
      exam_subjects: {
        Row: {
          exam_body_id: string;
          subject_id: string;
          is_compulsory: boolean;
          display_order: number;
          created_at: string;
        };
        Insert: {
          exam_body_id: string;
          subject_id: string;
          is_compulsory?: boolean;
          display_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_subjects"]["Insert"]>;
        Relationships: [];
      };
      topics: {
        Row: {
          id: string;
          subject_id: string;
          slug: string;
          name: string;
          description: string | null;
          display_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          subject_id: string;
          slug: string;
          name: string;
          description?: string | null;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["topics"]["Insert"]>;
        Relationships: [];
      };
      question_passages: {
        Row: {
          id: string;
          exam_body_id: string;
          subject_id: string;
          title: string | null;
          body: string;
          source_provider: string;
          source_passage_id: string | null;
          source_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          exam_body_id: string;
          subject_id: string;
          title?: string | null;
          body: string;
          source_provider?: string;
          source_passage_id?: string | null;
          source_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["question_passages"]["Insert"]>;
        Relationships: [];
      };
      questions: {
        Row: {
          id: string;
          exam_body_id: string;
          subject_id: string;
          topic_id: string | null;
          passage_id: string | null;
          year: number | null;
          question_kind: Database["public"]["Enums"]["question_kind"];
          question_text: string;
          correct_option_key: string;
          explanation: string | null;
          difficulty: Database["public"]["Enums"]["question_difficulty"] | null;
          source_provider: string;
          source_question_id: string | null;
          source_metadata: Json;
          status: Database["public"]["Enums"]["question_status"];
          review_notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          exam_body_id: string;
          subject_id: string;
          topic_id?: string | null;
          passage_id?: string | null;
          year?: number | null;
          question_kind?: Database["public"]["Enums"]["question_kind"];
          question_text: string;
          correct_option_key: string;
          explanation?: string | null;
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null;
          source_provider?: string;
          source_question_id?: string | null;
          source_metadata?: Json;
          status?: Database["public"]["Enums"]["question_status"];
          review_notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["questions"]["Insert"]>;
        Relationships: [];
      };
      question_options: {
        Row: {
          id: string;
          question_id: string;
          option_key: string;
          option_text: string;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          question_id: string;
          option_key: string;
          option_text: string;
          display_order: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["question_options"]["Insert"]>;
        Relationships: [];
      };
      question_assets: {
        Row: {
          id: string;
          question_id: string;
          kind: Database["public"]["Enums"]["question_asset_kind"];
          url: string;
          alt_text: string | null;
          caption: string | null;
          display_order: number;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          question_id: string;
          kind: Database["public"]["Enums"]["question_asset_kind"];
          url: string;
          alt_text?: string | null;
          caption?: string | null;
          display_order?: number;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["question_assets"]["Insert"]>;
        Relationships: [];
      };
      question_provider_subject_mappings: {
        Row: {
          provider: string;
          exam_body_id: string;
          subject_id: string;
          provider_exam_code: string | null;
          provider_subject_code: string;
          provider_subject_name: string | null;
          metadata: Json;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          provider: string;
          exam_body_id: string;
          subject_id: string;
          provider_exam_code?: string | null;
          provider_subject_code: string;
          provider_subject_name?: string | null;
          metadata?: Json;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["question_provider_subject_mappings"]["Insert"]>;
        Relationships: [];
      };
      question_provider_topic_mappings: {
        Row: {
          provider: string;
          topic_id: string;
          provider_topic_code: string | null;
          provider_topic_name: string;
          metadata: Json;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          provider: string;
          topic_id: string;
          provider_topic_code?: string | null;
          provider_topic_name: string;
          metadata?: Json;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["question_provider_topic_mappings"]["Insert"]>;
        Relationships: [];
      };
      practice_sessions: {
        Row: {
          id: string;
          user_id: string;
          exam_body_id: string;
          subject_id: string;
          topic_id: string | null;
          mode: Database["public"]["Enums"]["practice_mode"];
          difficulty: Database["public"]["Enums"]["question_difficulty"] | null;
          year_filter: number | null;
          requested_count: number;
          question_count: number;
          source_provider: string;
          status: Database["public"]["Enums"]["practice_session_status"];
          duration_seconds: number | null;
          started_at: string;
          expires_at: string | null;
          completed_at: string | null;
          answered_count: number;
          correct_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          exam_body_id: string;
          subject_id: string;
          topic_id?: string | null;
          mode: Database["public"]["Enums"]["practice_mode"];
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null;
          year_filter?: number | null;
          requested_count: number;
          question_count: number;
          source_provider: string;
          status?: Database["public"]["Enums"]["practice_session_status"];
          duration_seconds?: number | null;
          started_at?: string;
          expires_at?: string | null;
          completed_at?: string | null;
          answered_count?: number;
          correct_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["practice_sessions"]["Insert"]>;
        Relationships: [];
      };
      practice_session_questions: {
        Row: {
          id: string;
          session_id: string;
          position: number;
          source_provider: string;
          source_question_id: string;
          internal_question_id: string | null;
          student_snapshot: Json;
          correct_option_key: string;
          explanation: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          position: number;
          source_provider: string;
          source_question_id: string;
          internal_question_id?: string | null;
          student_snapshot: Json;
          correct_option_key: string;
          explanation?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["practice_session_questions"]["Insert"]>;
        Relationships: [];
      };
      practice_answers: {
        Row: {
          id: string;
          session_id: string;
          session_question_id: string;
          user_id: string;
          selected_option_key: string;
          is_correct: boolean;
          answered_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          session_question_id: string;
          user_id: string;
          selected_option_key: string;
          is_correct: boolean;
          answered_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["practice_answers"]["Insert"]>;
        Relationships: [];
      };

      exam_blueprints: {
        Row: {
          id: string;
          exam_body_id: string;
          code: string;
          name: string;
          duration_seconds: number;
          expected_subject_count: number;
          default_question_count: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          exam_body_id: string;
          code: string;
          name: string;
          duration_seconds: number;
          expected_subject_count: number;
          default_question_count: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_blueprints"]["Insert"]>;
        Relationships: [];
      };
      exam_blueprint_subject_overrides: {
        Row: {
          blueprint_id: string;
          subject_id: string;
          question_count: number;
          created_at: string;
        };
        Insert: {
          blueprint_id: string;
          subject_id: string;
          question_count: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_blueprint_subject_overrides"]["Insert"]>;
        Relationships: [];
      };
      exam_attempts: {
        Row: {
          id: string;
          user_id: string;
          exam_body_id: string;
          blueprint_id: string;
          exam_year: number;
          source_provider: string;
          status: Database["public"]["Enums"]["exam_attempt_status"];
          duration_seconds: number;
          total_questions: number;
          answered_count: number;
          flagged_count: number;
          correct_count: number;
          started_at: string | null;
          expires_at: string | null;
          submitted_at: string | null;
          submission_reason: Database["public"]["Enums"]["exam_submission_reason"] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          exam_body_id: string;
          blueprint_id: string;
          exam_year: number;
          source_provider: string;
          status?: Database["public"]["Enums"]["exam_attempt_status"];
          duration_seconds: number;
          total_questions: number;
          answered_count?: number;
          flagged_count?: number;
          correct_count?: number;
          started_at?: string | null;
          expires_at?: string | null;
          submitted_at?: string | null;
          submission_reason?: Database["public"]["Enums"]["exam_submission_reason"] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_attempts"]["Insert"]>;
        Relationships: [];
      };
      exam_attempt_subjects: {
        Row: {
          id: string;
          attempt_id: string;
          subject_id: string;
          display_order: number;
          question_count: number;
          answered_count: number;
          flagged_count: number;
          correct_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          subject_id: string;
          display_order: number;
          question_count: number;
          answered_count?: number;
          flagged_count?: number;
          correct_count?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_attempt_subjects"]["Insert"]>;
        Relationships: [];
      };
      exam_attempt_questions: {
        Row: {
          id: string;
          attempt_id: string;
          attempt_subject_id: string;
          subject_id: string;
          subject_position: number;
          overall_position: number;
          source_provider: string;
          source_question_id: string;
          internal_question_id: string | null;
          student_snapshot: Json;
          correct_option_key: string;
          explanation: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          attempt_subject_id: string;
          subject_id: string;
          subject_position: number;
          overall_position: number;
          source_provider: string;
          source_question_id: string;
          internal_question_id?: string | null;
          student_snapshot: Json;
          correct_option_key: string;
          explanation?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_attempt_questions"]["Insert"]>;
        Relationships: [];
      };
      exam_attempt_answers: {
        Row: {
          id: string;
          attempt_id: string;
          attempt_question_id: string;
          user_id: string;
          selected_option_key: string | null;
          is_flagged: boolean;
          is_correct: boolean | null;
          answered_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          attempt_question_id: string;
          user_id: string;
          selected_option_key?: string | null;
          is_flagged?: boolean;
          is_correct?: boolean | null;
          answered_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_attempt_answers"]["Insert"]>;
        Relationships: [];
      };
      student_exam_preferences: {
        Row: {
          id: string;
          user_id: string;
          exam_body_id: string;
          exam_year: number;
          target_score: number | null;
          intended_course: string | null;
          study_intensity: Database["public"]["Enums"]["study_intensity"];
          is_primary: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          exam_body_id: string;
          exam_year: number;
          target_score?: number | null;
          intended_course?: string | null;
          study_intensity?: Database["public"]["Enums"]["study_intensity"];
          is_primary?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["student_exam_preferences"]["Insert"]>;
        Relationships: [];
      };
      student_subject_preferences: {
        Row: {
          preference_id: string;
          subject_id: string;
          display_order: number;
          created_at: string;
        };
        Insert: {
          preference_id: string;
          subject_id: string;
          display_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["student_subject_preferences"]["Insert"]>;
        Relationships: [];
      };
      app_admins: {
        Row: {
          user_id: string; role: Database["public"]["Enums"]["admin_role"]; is_active: boolean;
          granted_by: string | null; created_at: string; updated_at: string; deactivated_at: string | null;
        };
        Insert: {
          user_id: string; role: Database["public"]["Enums"]["admin_role"]; is_active?: boolean;
          granted_by?: string | null; created_at?: string; updated_at?: string; deactivated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["app_admins"]["Insert"]>;
        Relationships: [];
      };
      admin_role_permissions: {
        Row: { role: Database["public"]["Enums"]["admin_role"]; permission: string; created_at: string };
        Insert: { role: Database["public"]["Enums"]["admin_role"]; permission: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["admin_role_permissions"]["Insert"]>;
        Relationships: [];
      };
      admin_audit_log: {
        Row: {
          id: number; actor_id: string | null; actor_role: Database["public"]["Enums"]["admin_role"] | null;
          action: string; entity_type: string; entity_id: string; reason: string | null;
          before_state: Json | null; after_state: Json | null; created_at: string;
        };
        Insert: {
          id?: number; actor_id?: string | null; actor_role?: Database["public"]["Enums"]["admin_role"] | null;
          action: string; entity_type: string; entity_id: string; reason?: string | null;
          before_state?: Json | null; after_state?: Json | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_audit_log"]["Insert"]>;
        Relationships: [];
      };
      admin_internal_notes: {
        Row: { id: string; entity_type: "class_lead" | "support_case"; entity_id: string; author_id: string | null; body: string; created_at: string };
        Insert: { id?: string; entity_type: "class_lead" | "support_case"; entity_id: string; author_id?: string | null; body: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["admin_internal_notes"]["Insert"]>;
        Relationships: [];
      };
      support_cases: {
        Row: {
          id: string; user_id: string | null;
          category: "account" | "billing" | "academic" | "exam_session" | "classes" | "technical" | "other";
          channel: "whatsapp" | "email" | "phone" | "in_app" | "other";
          subject: string; message: string | null; status: "open" | "in_progress" | "resolved";
          assigned_to: string | null; created_by: string | null; created_at: string; updated_at: string; resolved_at: string | null;
        };
        Insert: {
          id?: string; user_id?: string | null;
          category: "account" | "billing" | "academic" | "exam_session" | "classes" | "technical" | "other";
          channel?: "whatsapp" | "email" | "phone" | "in_app" | "other";
          subject: string; message?: string | null; status?: "open" | "in_progress" | "resolved";
          assigned_to?: string | null; created_by?: string | null; created_at?: string; updated_at?: string; resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["support_cases"]["Insert"]>;
        Relationships: [];
      };
      question_blocks: {
        Row: {
          id: string; source_provider: string; exam_code: string; subject_slug: string; source_question_id: string;
          reason: string; blocked_by: string | null; created_at: string;
          lifted_at: string | null; lifted_by: string | null; lift_reason: string | null;
        };
        Insert: {
          id?: string; source_provider: string; exam_code: string; subject_slug: string; source_question_id: string;
          reason: string; blocked_by?: string | null; created_at?: string;
          lifted_at?: string | null; lifted_by?: string | null; lift_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["question_blocks"]["Insert"]>;
        Relationships: [];
      };
      account_suspensions: {
        Row: { user_id: string; reason: string; suspended_by: string | null; suspended_at: string };
        Insert: { user_id: string; reason: string; suspended_by?: string | null; suspended_at?: string };
        Update: Partial<Database["public"]["Tables"]["account_suspensions"]["Insert"]>;
        Relationships: [];
      };
      premium_class_leads: {
        Row: {
          id: string; user_id: string; student_name: string; exam_type: "jamb" | "waec";
          subject_slug: string; subject_name: string; topic: string | null;
          class_type: Database["public"]["Enums"]["class_type"]; phone: string; email: string | null;
          preferred_contact_method: Database["public"]["Enums"]["contact_method"];
          preferred_schedule: string; message: string | null;
          source: Database["public"]["Enums"]["class_lead_source"];
          recommendation_reason: Database["public"]["Enums"]["class_recommendation_reason"];
          recent_accuracy: number | null; fingerprint: string;
          status: Database["public"]["Enums"]["class_lead_status"];
          assigned_to: string | null; admin_notes: string | null;
          created_at: string; updated_at: string; contacted_at: string | null;
          enrolled_at: string | null; closed_at: string | null;
        };
        Insert: {
          id?: string; user_id: string; student_name: string; exam_type: "jamb" | "waec";
          subject_slug: string; subject_name: string; topic?: string | null;
          class_type: Database["public"]["Enums"]["class_type"]; phone: string; email?: string | null;
          preferred_contact_method: Database["public"]["Enums"]["contact_method"];
          preferred_schedule: string; message?: string | null;
          source: Database["public"]["Enums"]["class_lead_source"];
          recommendation_reason?: Database["public"]["Enums"]["class_recommendation_reason"];
          recent_accuracy?: number | null; fingerprint: string;
          status?: Database["public"]["Enums"]["class_lead_status"];
          assigned_to?: string | null; admin_notes?: string | null; created_at?: string; updated_at?: string;
          contacted_at?: string | null; enrolled_at?: string | null; closed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["premium_class_leads"]["Insert"]>;
        Relationships: [];
      };
      marketing_consents: {
        Row: { id: number; user_id: string; channel: Database["public"]["Enums"]["marketing_channel"]; purpose: string; source_lead_id: string | null; granted_at: string; revoked_at: string | null };
        Insert: { id?: number; user_id: string; channel: Database["public"]["Enums"]["marketing_channel"]; purpose?: string; source_lead_id?: string | null; granted_at?: string; revoked_at?: string | null };
        Update: Partial<Database["public"]["Tables"]["marketing_consents"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      save_exam_preparations: { Args: { p_configurations: Json; p_default_code: string }; Returns: undefined };
      admin_grant_membership: {
        Args: { p_actor_id: string; p_email: string; p_role: Database["public"]["Enums"]["admin_role"]; p_reason: string };
        Returns: Json;
      };
      admin_update_membership: {
        Args: { p_actor_id: string; p_user_id: string; p_role: Database["public"]["Enums"]["admin_role"] | null; p_is_active: boolean | null; p_reason: string };
        Returns: Json;
      };
      admin_record_suspension: {
        Args: { p_actor_id: string; p_user_id: string; p_reason: string };
        Returns: Json;
      };
      admin_clear_suspension: {
        Args: { p_actor_id: string; p_user_id: string; p_reason: string };
        Returns: Json;
      };
      admin_grant_master_access: {
        Args: { p_actor_id: string; p_user_id: string; p_days: number | null; p_expires_at: string | null; p_reason: string };
        Returns: Json;
      };
      admin_update_class_lead: {
        Args: {
          p_actor_id: string; p_lead_id: string; p_status?: Database["public"]["Enums"]["class_lead_status"] | null;
          p_update_assignment?: boolean; p_assigned_to?: string | null; p_note?: string | null;
        };
        Returns: Json;
      };
      admin_create_support_case: {
        Args: {
          p_actor_id: string; p_user_id: string | null; p_category: string; p_channel: string;
          p_subject: string; p_message: string | null; p_assigned_to?: string | null;
        };
        Returns: string;
      };
      admin_update_support_case: {
        Args: {
          p_actor_id: string; p_case_id: string; p_status?: string | null;
          p_update_assignment?: boolean; p_assigned_to?: string | null; p_note?: string | null;
        };
        Returns: Json;
      };
      admin_save_internal_question: {
        Args: { p_actor_id: string; p_question_id: string | null; p_payload: Json; p_reason?: string | null };
        Returns: string;
      };
      admin_set_question_status: {
        Args: { p_actor_id: string; p_question_id: string; p_status: Database["public"]["Enums"]["question_status"]; p_reason?: string | null };
        Returns: Json;
      };
      admin_block_question: {
        Args: {
          p_actor_id: string; p_source_provider: string; p_exam_code: string; p_subject_slug: string;
          p_source_question_id: string; p_reason: string;
        };
        Returns: string;
      };
      admin_lift_question_block: {
        Args: { p_actor_id: string; p_block_id: string; p_reason: string };
        Returns: Json;
      };
      admin_finalize_overdue_session: {
        Args: { p_actor_id: string; p_kind: "exam" | "practice"; p_session_id: string; p_reason: string };
        Returns: Json;
      };
      admin_overview_metrics: {
        Args: { p_actor_id: string };
        Returns: Json;
      };
      admin_list_students: {
        Args: {
          p_actor_id: string; p_search?: string | null; p_exam?: string | null; p_plan?: string | null;
          p_activity?: string | null; p_sort?: string; p_limit?: number; p_offset?: number;
        };
        Returns: {
          user_id: string; full_name: string; email: string | null; exam_code: string | null; exam_year: number | null;
          plan_tier: "free" | "master"; master_expires_at: string | null; subject_names: string[];
          joined_at: string; last_session_at: string | null; finished_sessions: number;
          onboarding_completed: boolean; is_suspended: boolean; total_count: number;
        }[];
      };
      admin_list_sessions: {
        Args: {
          p_actor_id: string; p_kind?: string | null; p_state?: string | null; p_exam?: string | null;
          p_subject_slug?: string | null; p_user_id?: string | null; p_search?: string | null;
          p_from?: string | null; p_to?: string | null; p_limit?: number; p_offset?: number;
        };
        Returns: {
          session_kind: "practice" | "exam"; session_id: string; user_id: string; student_name: string | null;
          student_email: string | null; exam_code: string | null; session_type: "practice" | "timed" | "revision" | "mock";
          subject_names: string | null; status: string; question_count: number; answered_count: number;
          correct_count: number; source_provider: string; started_at: string | null; finished_at: string | null;
          expires_at: string | null; total_count: number;
        }[];
      };
      admin_academic_performance: {
        Args: {
          p_actor_id: string; p_exam_code?: string | null; p_subject_slug?: string | null;
          p_since?: string | null; p_until?: string | null; p_min_attempts?: number;
        };
        Returns: Json;
      };
      admin_weekly_analytics: {
        Args: { p_actor_id: string; p_weeks?: number };
        Returns: Json;
      };
      admin_list_admins: {
        Args: { p_actor_id: string };
        Returns: {
          user_id: string; email: string | null; full_name: string; role: Database["public"]["Enums"]["admin_role"];
          is_active: boolean; granted_by_email: string | null; created_at: string; updated_at: string; deactivated_at: string | null;
        }[];
      };
      admin_list_assignees: {
        Args: { p_actor_id: string; p_permission: string };
        Returns: { user_id: string; email: string | null; full_name: string }[];
      };
      admin_user_directory: {
        Args: { p_actor_id: string; p_user_ids: string[] };
        Returns: { user_id: string; email: string | null; full_name: string }[];
      };
      admin_search_users: {
        Args: { p_actor_id: string; p_search: string; p_limit?: number };
        Returns: { user_id: string; email: string | null; full_name: string }[];
      };
      consume_rate_limit: {
        Args: { p_key: string; p_capacity: number; p_refill_per_second: number; p_cost?: number };
        Returns: { allowed: boolean; remaining: number; retry_after_seconds: number }[];
      };
      create_premium_class_lead: {
        Args: {
          p_user_id: string; p_student_name: string; p_exam_type: string; p_subject_slug: string;
          p_subject_name: string; p_topic: string | null; p_class_type: Database["public"]["Enums"]["class_type"];
          p_phone: string; p_email: string | null; p_preferred_contact_method: Database["public"]["Enums"]["contact_method"];
          p_preferred_schedule: string; p_message: string | null; p_source: Database["public"]["Enums"]["class_lead_source"];
          p_recommendation_reason: Database["public"]["Enums"]["class_recommendation_reason"];
          p_recent_accuracy: number | null; p_fingerprint: string;
        };
        Returns: { lead_id: string; deduplicated: boolean }[];
      };
      claim_ai_explanation: {
        Args: {
          p_cache_key: string;
          p_question_fingerprint: string;
          p_explanation_type: "explain_better" | "why_wrong";
          p_selected_option_key: string | null;
          p_prompt_version: string;
          p_provider: string;
          p_model: string;
          p_lease_seconds?: number;
          p_ttl_seconds?: number;
        };
        Returns: { outcome: "claimed" | "completed" | "in_progress"; content: Json | null }[];
      };
      settle_ai_explanation: {
        Args: { p_cache_key: string; p_content: Json; p_ttl_seconds?: number };
        Returns: undefined;
      };
      release_ai_explanation_claim: {
        Args: { p_cache_key: string };
        Returns: undefined;
      };
      consume_ai_daily_quota: {
        Args: { p_user_id: string; p_feature: "question_explanation"; p_limit: number };
        Returns: { allowed: boolean; remaining: number }[];
      };
      refund_ai_daily_quota: {
        Args: { p_user_id: string; p_feature: "question_explanation" };
        Returns: number;
      };
      open_billing_checkout: {
        Args: {
          p_user_id: string;
          p_plan_slug: string;
          p_reference: string;
          p_environment: "test" | "live";
          p_reuse_seconds?: number;
        };
        Returns: {
          outcome: "created" | "reused";
          payment_id: string;
          reference: string;
          amount_kobo: number;
          currency: string;
          access_days: number;
          authorization_url: string | null;
        }[];
      };
      attach_billing_authorization_url: {
        Args: { p_reference: string; p_authorization_url: string };
        Returns: undefined;
      };
      apply_successful_payment: {
        Args: {
          p_reference: string;
          p_amount_kobo: number;
          p_currency: string;
          p_environment: "test" | "live";
          p_provider_transaction_id?: string | null;
          p_provider_status?: string | null;
          p_paid_at?: string | null;
        };
        Returns: {
          outcome: string;
          user_id: string | null;
          plan_slug: string | null;
          tier: string | null;
          expires_at: string | null;
          access_days: number | null;
        }[];
      };
      mark_billing_payment_unsuccessful: {
        Args: {
          p_reference: string;
          p_status: "failed" | "abandoned" | "reversed";
          p_reason?: string | null;
          p_provider_transaction_id?: string | null;
          p_provider_status?: string | null;
        };
        Returns: { outcome: string; user_id: string | null }[];
      };
      current_billing_entitlement: {
        Args: { p_user_id: string };
        Returns: {
          tier: "free" | "master";
          plan_slug: string | null;
          expires_at: string | null;
          is_master: boolean;
        }[];
      };
      reserve_product_quota: {
        Args: {
          p_user_id: string;
          p_capability: "practice_session" | "mock_attempt";
          p_window_key: string;
          p_limit: number;
          p_lease_seconds?: number;
        };
        Returns: { allowed: boolean; used: number; remaining: number; reservation_id: string | null }[];
      };
      commit_product_quota: {
        Args: { p_reservation_id: string };
        Returns: boolean;
      };
      release_product_quota: {
        Args: { p_reservation_id: string };
        Returns: boolean;
      };
      record_billing_webhook_event: {
        Args: {
          p_provider: string;
          p_event_id: string;
          p_event_type: string;
          p_reference?: string | null;
          p_lease_seconds?: number;
        };
        Returns: { is_new: boolean; event_row_id: number | null }[];
      };
      finish_billing_webhook_event: {
        Args: { p_event_row_id: number; p_outcome: string; p_detail?: string | null };
        Returns: undefined;
      };
      release_billing_webhook_event: {
        Args: { p_event_row_id: number; p_detail?: string | null };
        Returns: undefined;
      };
      claim_session_creation: {
        Args: {
          p_user_id: string;
          p_kind: string;
          p_fingerprint: string;
          p_inflight_seconds?: number;
          p_duplicate_seconds?: number;
        };
        Returns: { outcome: string; session_id: string | null }[];
      };
      settle_session_creation: {
        Args: { p_user_id: string; p_kind: string; p_fingerprint: string; p_session_id?: string | null };
        Returns: undefined;
      };

      save_response_v2: {
        Args: { p_user_id: string; p_kind: string; p_session_id: string; p_question_id: string; p_selected_option_key: string | null; p_is_flagged: boolean; p_expected_revision: number; p_mutation_id: string };
        Returns: Json;
      };

      create_exam_attempt: {
        Args: {
          p_user_id: string;
          p_exam_body_id: string;
          p_blueprint_id: string;
          p_exam_year: number;
          p_provider: string;
          p_duration_seconds: number;
          p_subjects: Json;
        };
        Returns: string;
      };
      save_exam_response: {
        Args: {
          p_user_id: string;
          p_attempt_id: string;
          p_attempt_question_id: string;
          p_selected_option_key: string | null;
          p_is_flagged: boolean;
        };
        Returns: {
          selected_option_key: string | null;
          is_flagged: boolean;
          answered_count: number;
          flagged_count: number;
          total_questions: number;
          expires_at: string | null;
        }[];
      };
      submit_exam_attempt: {
        Args: {
          p_user_id: string;
          p_attempt_id: string;
          p_reason: Database["public"]["Enums"]["exam_submission_reason"];
        };
        Returns: {
          attempt_id: string;
          status: Database["public"]["Enums"]["exam_attempt_status"];
          answered_count: number;
          flagged_count: number;
          total_questions: number;
          submitted_at: string | null;
          submission_reason: Database["public"]["Enums"]["exam_submission_reason"] | null;
        }[];
      };
      create_practice_session: {
        Args: {
          p_user_id: string;
          p_exam_body_id: string;
          p_subject_id: string;
          p_topic_id: string | null;
          p_mode: Database["public"]["Enums"]["practice_mode"];
          p_difficulty: Database["public"]["Enums"]["question_difficulty"] | null;
          p_year_filter: number | null;
          p_requested_count: number;
          p_provider: string;
          p_duration_seconds: number | null;
          p_questions: Json;
        };
        Returns: string;
      };
      save_practice_answer: {
        Args: {
          p_user_id: string;
          p_session_id: string;
          p_session_question_id: string;
          p_selected_option_key: string;
        };
        Returns: {
          selected_option_key: string;
          is_correct: boolean;
          correct_option_key: string;
          explanation: string | null;
          answered_count: number;
          question_count: number;
          mode: Database["public"]["Enums"]["practice_mode"];
          expires_at: string | null;
        }[];
      };
      complete_practice_session: {
        Args: { p_user_id: string; p_session_id: string };
        Returns: {
          session_id: string;
          status: Database["public"]["Enums"]["practice_session_status"];
          answered_count: number;
          correct_count: number;
          question_count: number;
          completed_at: string | null;
        }[];
      };
      complete_jamb_onboarding: {
        Args: {
          p_exam_year: number;
          p_target_score: number;
          p_intended_course: string;
          p_study_intensity: Database["public"]["Enums"]["study_intensity"];
          p_subject_ids: string[];
        };
        Returns: string;
      };
      complete_exam_onboarding: {
        Args: {
          p_exam_code: string;
          p_exam_year: number;
          p_target_score: number;
          p_intended_course: string;
          p_study_intensity: Database["public"]["Enums"]["study_intensity"];
          p_subject_ids: string[];
        };
        Returns: string;
      };
      question_catalog_counts: {
        Args: { p_exam_code?: string | null };
        Returns: {
          exam_body_id: string;
          subject_id: string;
          topic_id: string | null;
          year: number | null;
          question_count: number;
        }[];
      };
    };
    Enums: {
      study_intensity: "light" | "moderate" | "intensive";
      question_difficulty: "easy" | "medium" | "hard";
      question_status: "draft" | "pending_review" | "active" | "flagged" | "disabled";
      question_kind: "single_choice";
      question_asset_kind: "image" | "diagram" | "graph" | "table" | "map" | "illustration";
      practice_mode: "practice" | "timed";
      practice_session_status: "in_progress" | "completed" | "expired" | "abandoned";
      exam_attempt_status: "created" | "in_progress" | "submitted" | "expired" | "abandoned";
      exam_submission_reason: "manual" | "time_expired";
      class_lead_status: "new" | "contacted" | "interested" | "follow_up" | "enrolled" | "not_interested" | "closed";
      class_type: "group" | "private" | "topic_clinic" | "jamb_bootcamp" | "waec_bootcamp" | "mock_review" | "not_sure";
      class_lead_source: "class_page" | "result" | "progress" | "mistake_bank" | "topic_recommendation" | "subject_recommendation" | "persistent_support_cta" | "public_classes_cta" | "other";
      contact_method: "whatsapp" | "phone" | "email";
      class_recommendation_reason: "weak_topic" | "weak_subject" | "repeated_mistakes" | "student_requested";
      marketing_channel: "whatsapp" | "email";
      admin_role: "super_admin" | "academic_admin" | "support_admin" | "classes_admin";
    };
    CompositeTypes: Record<string, never>;
  };
};
