CREATE TYPE "public"."business_type" AS ENUM('hairdresser', 'barber', 'salon', 'spa', 'nail_salon', 'tattoo_studio', 'aesthetic_clinic', 'cosmetic_clinic', 'skin_clinic', 'dermatology_clinic', 'laser_clinic', 'fat_freezing_clinic', 'dental_practice', 'medical_spa', 'wellness_clinic', 'physiotherapy', 'chiropractic', 'beauty_clinic', 'iv_therapy_clinic', 'weight_loss_clinic', 'anti_aging_clinic', 'hair_restoration', 'other');--> statement-breakpoint
CREATE TYPE "public"."content_style_template" AS ENUM('clean_minimal', 'bold_energetic', 'elegant_professional', 'playful_colorful');--> statement-breakpoint
CREATE TYPE "public"."country" AS ENUM('af', 'al', 'dz', 'ad', 'ao', 'ag', 'ar', 'am', 'au', 'at', 'az', 'bs', 'bh', 'bd', 'bb', 'by', 'be', 'bz', 'bj', 'bt', 'bo', 'ba', 'bw', 'br', 'bn', 'bg', 'bf', 'bi', 'cv', 'kh', 'cm', 'ca', 'cf', 'td', 'cl', 'cn', 'co', 'km', 'cg', 'cr', 'hr', 'cu', 'cy', 'cz', 'cd', 'dk', 'dj', 'dm', 'do', 'ec', 'eg', 'sv', 'gq', 'er', 'ee', 'sz', 'et', 'fj', 'fi', 'fr', 'ga', 'gm', 'ge', 'de', 'gh', 'gr', 'gd', 'gt', 'gn', 'gw', 'gy', 'ht', 'hn', 'hu', 'is', 'in', 'id', 'ir', 'iq', 'ie', 'il', 'it', 'jm', 'jp', 'jo', 'kz', 'ke', 'ki', 'kw', 'kg', 'la', 'lv', 'lb', 'ls', 'lr', 'ly', 'li', 'lt', 'lu', 'mg', 'mw', 'my', 'mv', 'ml', 'mt', 'mh', 'mr', 'mu', 'mx', 'fm', 'md', 'mc', 'mn', 'me', 'ma', 'mz', 'mm', 'na', 'nr', 'np', 'nl', 'nz', 'ni', 'ne', 'ng', 'kp', 'mk', 'no', 'om', 'pk', 'pw', 'pa', 'pg', 'py', 'pe', 'ph', 'pl', 'pt', 'qa', 'ro', 'ru', 'rw', 'kn', 'lc', 'vc', 'ws', 'sm', 'st', 'sa', 'sn', 'rs', 'sc', 'sl', 'sg', 'sk', 'si', 'sb', 'so', 'za', 'kr', 'ss', 'es', 'lk', 'sd', 'sr', 'se', 'ch', 'sy', 'tw', 'tj', 'tz', 'th', 'tl', 'tg', 'to', 'tt', 'tn', 'tr', 'tm', 'tv', 'ug', 'ua', 'ae', 'gb', 'us', 'uy', 'uz', 'vu', 'va', 've', 'vn', 'ye', 'zm', 'zw');--> statement-breakpoint
CREATE TYPE "public"."outro_style" AS ENUM('offer', 'location', 'tagline');--> statement-breakpoint
CREATE TYPE "public"."primary_calendar_type" AS ENUM('borradh', 'google_calendar', 'calendly', 'timely', 'phorest', 'fresha');--> statement-breakpoint
CREATE TYPE "public"."asset_source" AS ENUM('raw', 'edited');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('video', 'image');--> statement-breakpoint
CREATE TYPE "public"."video_processing_stage" AS ENUM('downloading', 'generating_voiceover', 'analyzing', 'transcribing', 'building_captions', 'resolving_assets', 'rendering');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('draft', 'queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('meta_form', 'manual_entry', 'csv_import', 'grandfathered', 'user_update');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('facebook', 'instagram', 'whatsapp', 'website', 'manual', 'referral', 'other', 'meta_lead_form');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'booked', 'cold');--> statement-breakpoint
CREATE TYPE "public"."sequence_execution_status" AS ENUM('pending', 'running', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."sequence_step_type" AS ENUM('email', 'sms', 'whatsapp', 'voice_call', 'wait', 'condition', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."sequence_version_change_type" AS ENUM('created', 'updated', 'published', 'restored');--> statement-breakpoint
CREATE TYPE "public"."integration_type" AS ENUM('facebook_leads', 'facebook_ads', 'whatsapp', 'sms', 'email', 'voice', 'gmail', 'outlook', 'google_calendar', 'meta_ads');--> statement-breakpoint
CREATE TYPE "public"."email_provider" AS ENUM('gmail', 'outlook');--> statement-breakpoint
CREATE TYPE "public"."meta_integration_status" AS ENUM('pending_selection', 'configured');--> statement-breakpoint
CREATE TYPE "public"."token_status" AS ENUM('valid', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "public"."meta_page_platform" AS ENUM('facebook', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."lead_form_status" AS ENUM('draft', 'synced', 'error', 'archived');--> statement-breakpoint
CREATE TYPE "public"."training_category" AS ENUM('getting-started', 'dashboard-guide', 'video-creation', 'lead-management', 'sequences', 'best-practices', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."ad_placement" AS ENUM('facebook', 'instagram', 'both');--> statement-breakpoint
CREATE TYPE "public"."conversion_destination" AS ENUM('messenger', 'whatsapp', 'instagram_direct');--> statement-breakpoint
CREATE TYPE "public"."follow_up_type" AS ENUM('sequence', 'chatbot', 'email_only', 'lead_form');--> statement-breakpoint
CREATE TYPE "public"."meta_ad_status" AS ENUM('draft', 'launching', 'pending', 'active', 'paused', 'rejected', 'error');--> statement-breakpoint
CREATE TYPE "public"."meta_call_to_action" AS ENUM('LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'WATCH_MORE', 'BOOK_NOW', 'GET_QUOTE', 'SUBSCRIBE', 'DOWNLOAD', 'GET_OFFER', 'WHATSAPP_MESSAGE');--> statement-breakpoint
CREATE TYPE "public"."meta_campaign_objective" AS ENUM('OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC');--> statement-breakpoint
CREATE TYPE "public"."meta_campaign_status" AS ENUM('draft', 'pending', 'active', 'paused', 'archived', 'error');--> statement-breakpoint
CREATE TYPE "public"."booking_provider" AS ENUM('calendly', 'timely', 'phorest', 'fresha');--> statement-breakpoint
CREATE TYPE "public"."voice_call_outcome" AS ENUM('booked', 'callback_scheduled', 'interested', 'not_interested', 'no_answer', 'error', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."voice_call_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."voice_sentiment" AS ENUM('Positive', 'Negative', 'Neutral', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."phone_number_provider" AS ENUM('telnyx', 'manual');--> statement-breakpoint
CREATE TYPE "public"."phone_number_status" AS ENUM('pending_registration', 'active', 'suspended', 'releasing', 'released', 'failed');--> statement-breakpoint
CREATE TYPE "public"."aspect_ratio" AS ENUM('1:1', '9:16', '16:9', '4:5', '4:3');--> statement-breakpoint
CREATE TYPE "public"."graphic_template_category" AS ENUM('credibility', 'hook_claim', 'offer', 'qa_mythbuster', 'testimonial');--> statement-breakpoint
CREATE TYPE "public"."graphic_status" AS ENUM('draft', 'rendering', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."appointment_color" AS ENUM('blue', 'green', 'red', 'yellow', 'purple', 'orange');--> statement-breakpoint
CREATE TYPE "public"."appointment_source" AS ENUM('manual', 'ai_voice_caller', 'calendar_sync', 'booking_form');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show', 'deposit_expired');--> statement-breakpoint
CREATE TYPE "public"."credit_channel" AS ENUM('sms', 'email', 'voice', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('subscription_refill', 'purchase', 'usage', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid', 'paused');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('facebook', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."social_post_media_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."social_post_status" AS ENUM('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('pending', 'paid', 'expired', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."asset_analysis_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."asset_content_type" AS ENUM('talking_head', 'procedure', 'environment', 'testimonial', 'result', 'other');--> statement-breakpoint
CREATE TYPE "public"."service_category" AS ENUM('treatment', 'procedure', 'product', 'consultation', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_upload_batch_status" AS ENUM('pending', 'processing', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'bot_handling', 'agent_handling', 'closed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('bot', 'user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'quick_reply', 'template', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."messaging_platform" AS ENUM('facebook_messenger', 'instagram_dm', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."face_detection_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."face_group_asset_role" AS ENUM('before', 'after', 'untagged');--> statement-breakpoint
CREATE TYPE "public"."face_group_exclusion_reason" AS ENUM('content_type', 'frequency', 'cross_batch_frequency', 'manual', 'staff_enrollment');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'expired', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."offer_type" AS ENUM('price_discount', 'percentage_discount', 'buy_x_get_y');--> statement-breakpoint
CREATE TYPE "public"."assistant_message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."knowledge_entry_type" AS ENUM('org_profile', 'service', 'ad_insight', 'post_insight', 'video_preference', 'customer_pattern', 'area_info', 'industry_benchmark', 'faq', 'chatbot_insight');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source" AS ENUM('auto', 'ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('active', 'paused', 'completed');--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"currency" text DEFAULT 'USD',
	"timezone" text DEFAULT 'UTC',
	"role" text DEFAULT 'user',
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" integer,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"business_type" "business_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" text,
	"api_key" text,
	"website_url" text,
	"facebook_page_url" text,
	"brand_voice" jsonb DEFAULT '[]'::jsonb,
	"target_audience_description" text,
	"credibility_line" text,
	"primary_color" text DEFAULT '#6366f1',
	"secondary_color" text DEFAULT '#8b5cf6',
	"background_color" text DEFAULT '#FFFFFF',
	"tagline" text,
	"address" text,
	"content_style_template" "content_style_template" DEFAULT 'clean_minimal',
	"outro_style" "outro_style" DEFAULT 'tagline',
	"business_hours" jsonb DEFAULT '{"0":{"from":0,"to":0},"1":{"from":540,"to":1080},"2":{"from":540,"to":1080},"3":{"from":540,"to":1080},"4":{"from":540,"to":1080},"5":{"from":540,"to":1080},"6":{"from":0,"to":0}}'::jsonb NOT NULL,
	"default_booking_link" text,
	"deposit_enabled" boolean DEFAULT false,
	"deposit_amount" integer,
	"deposit_link" text,
	"completed_onboarding_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_calendar_type" "primary_calendar_type",
	"primary_calendar_account_id" text,
	"default_appointment_duration" integer DEFAULT 30,
	"contribute_to_aggregate_insights" boolean DEFAULT true NOT NULL,
	"stripe_customer_id" text,
	"chatbot_settings" jsonb,
	"chatbot_system_prompt" text,
	"knowledge_base" jsonb,
	"knowledge_base_last_synced_at" timestamp,
	"voice_style_profile" text,
	"voice_style_profile_updated_at" timestamp,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organization_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT false NOT NULL,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"blob_url" text NOT NULL,
	"thumbnail_url" text,
	"source_file_name" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"client_name" text,
	"type" "asset_type" DEFAULT 'video' NOT NULL,
	"source" "asset_source" DEFAULT 'raw' NOT NULL,
	"placeholder_types" text[] DEFAULT '{}' NOT NULL,
	"duration" real,
	"width" integer,
	"height" integer,
	"codec" text,
	"pix_fmt" text,
	"bitrate_kbps" integer,
	"probe_status" text DEFAULT 'pending' NOT NULL,
	"probed_at" timestamp,
	"transcode_status" text DEFAULT 'skipped' NOT NULL,
	"transcoded_blob_url" text,
	"transcoded_at" timestamp,
	"transcript" text,
	"captured_at" timestamp,
	"batch_id" text,
	"organization_id" text NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" "video_status" DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"progress" integer DEFAULT 0,
	"processing_stage" "video_processing_stage",
	"stage_started_at" timestamp,
	"draft_config" jsonb,
	"blob_url" text,
	"thumbnail_url" text,
	"duration_ms" integer,
	"template_id" text,
	"variation_id" text,
	"service_id" text,
	"offer_id" text,
	"organization_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"exported_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text,
	"phone" text,
	"whatsapp" text,
	"source" "lead_source" DEFAULT 'manual' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"facebook_lead_id" text,
	"form_data" jsonb,
	"sequence_id" text,
	"sequence_status" text,
	"current_step_id" text,
	"sequence_started_at" timestamp,
	"next_action_at" timestamp,
	"assigned_to_id" text,
	"tags" text[],
	"notes" text,
	"metadata" jsonb,
	"human_takeover_requested" boolean DEFAULT false,
	"human_takeover_reason" text,
	"human_takeover_at" timestamp,
	"consent_email" boolean DEFAULT false NOT NULL,
	"consent_sms" boolean DEFAULT false NOT NULL,
	"consent_voice" boolean DEFAULT false NOT NULL,
	"consent_source" "consent_source",
	"consented_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"performed_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT false,
	"trigger_on_new_lead" boolean DEFAULT true,
	"schedule_next_day" boolean DEFAULT false,
	"setup_completed" boolean DEFAULT false NOT NULL,
	"nodes" jsonb,
	"edges" jsonb,
	"settings" jsonb,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"sequence_id" text NOT NULL,
	"step_id" text NOT NULL,
	"status" "sequence_execution_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"scheduled_at" timestamp,
	"executed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_step" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL,
	"node_id" text NOT NULL,
	"type" "sequence_step_type" NOT NULL,
	"config" jsonb NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_version" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL,
	"version" integer NOT NULL,
	"nodes" jsonb NOT NULL,
	"edges" jsonb NOT NULL,
	"change_type" "sequence_version_change_type" NOT NULL,
	"change_summary" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" "integration_type" NOT NULL,
	"is_active" boolean DEFAULT false,
	"config" jsonb,
	"encrypted_credentials" text,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_type" UNIQUE("organization_id","type")
);
--> statement-breakpoint
CREATE TABLE "email_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "email_provider" NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"last_sync_at" timestamp,
	"token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_email" UNIQUE("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "calendar_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"calendar_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"last_sync_at" timestamp,
	"token_expires_at" timestamp,
	"watch_channel_id" text,
	"watch_resource_id" text,
	"watch_expiration" timestamp,
	"sync_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_calendar_email" UNIQUE("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_chatbot_active" boolean DEFAULT false NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"token_expires_at" timestamp,
	"token_status" "token_status" DEFAULT 'valid' NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_phone_number" UNIQUE("organization_id","phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_pending_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"initiated_by_id" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"available_wabas" jsonb NOT NULL,
	"available_phone_numbers" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_pending_connection_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "meta_ads_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_id" text NOT NULL,
	"configuration_status" "meta_integration_status" DEFAULT 'pending_selection' NOT NULL,
	"ad_account_id" text,
	"ad_account_name" text,
	"default_page_id" text,
	"available_businesses" jsonb,
	"available_ad_accounts" jsonb,
	"available_pages" jsonb,
	"facebook_user_name" text,
	"facebook_user_email" text,
	"facebook_user_picture_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"token_status" "token_status" DEFAULT 'valid' NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"token_expires_at" timestamp,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_meta_ads" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "instagram_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_id" text,
	"encrypted_credentials" text,
	"token_expires_at" timestamp,
	"instagram_user_id" text,
	"username" text,
	"name" text,
	"profile_picture_url" text,
	"account_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"chatbot_enabled" boolean DEFAULT false NOT NULL,
	"token_status" "token_status" DEFAULT 'valid' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_instagram" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "meta_ads_page" (
	"id" text PRIMARY KEY NOT NULL,
	"meta_ads_integration_id" text NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text,
	"page_access_token" text,
	"page_username" text,
	"page_picture_url" text,
	"platform" "meta_page_platform" NOT NULL,
	"linked_instagram_account_id" text,
	"linked_instagram_username" text,
	"linked_instagram_name" text,
	"pixel_id" text,
	"pixel_name" text,
	"default_lead_form_id" text,
	"default_lead_form_name" text,
	"default_ad_account_id" text,
	"default_ad_account_name" text,
	"default_ad_account_currency" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_chatbot_active" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_integration_page" UNIQUE("meta_ads_integration_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "lead_form" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "lead_form_status" DEFAULT 'draft' NOT NULL,
	"questions" jsonb NOT NULL,
	"privacy_policy_url" text NOT NULL,
	"privacy_policy_link_text" text,
	"thank_you_title" text,
	"thank_you_body" text,
	"thank_you_button_text" text,
	"thank_you_button_url" text,
	"meta_form_id" text,
	"meta_page_id" text,
	"last_sync_at" timestamp,
	"sync_error" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_video" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cdn_url" text NOT NULL,
	"thumbnail_url" text,
	"duration_seconds" integer,
	"category" "training_category" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_video_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"training_video_id" text NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_video_progress_unique" UNIQUE("user_id","training_video_id")
);
--> statement-breakpoint
CREATE TABLE "meta_ad" (
	"id" text PRIMARY KEY NOT NULL,
	"meta_campaign_id" text,
	"meta_ad_set_id" text,
	"organization_id" text NOT NULL,
	"video_id" text,
	"social_post_id" text,
	"use_existing_post" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"headline" text,
	"primary_text" text,
	"description" text,
	"call_to_action" "meta_call_to_action" DEFAULT 'LEARN_MORE',
	"destination_url" text,
	"is_imported" boolean DEFAULT false NOT NULL,
	"status" "meta_ad_status" DEFAULT 'draft' NOT NULL,
	"targeting_override" jsonb,
	"follow_up_type" "follow_up_type" DEFAULT 'lead_form' NOT NULL,
	"lead_form_id" text,
	"sequence_id" text,
	"ad_placement" "ad_placement" DEFAULT 'facebook' NOT NULL,
	"conversion_destination" "conversion_destination",
	"destinations" text[],
	"meta_ads_page_id" text,
	"ad_account_id" text,
	"meta_ad_id" text,
	"meta_creative_id" text,
	"meta_video_id" text,
	"meta_image_hash" text,
	"meta_status" text,
	"last_sync_at" timestamp,
	"sync_error" text,
	"meta_thumbnail_url" text,
	"meta_permalink" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_ad_service" (
	"id" text PRIMARY KEY NOT NULL,
	"meta_ad_id" text NOT NULL,
	"service_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meta_ad_service_unique" UNIQUE("meta_ad_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "meta_campaign_config" (
	"id" text PRIMARY KEY NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"meta_ads_page_id" text,
	"ad_account_id" text,
	"ad_account_currency" text,
	"follow_up_type" "follow_up_type" DEFAULT 'lead_form' NOT NULL,
	"conversion_destination" "conversion_destination",
	"destination_type" text,
	"location_id" text,
	"targeting" jsonb,
	"meta_ad_set_id" text,
	"experiment_id" text,
	"experiment_variant" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meta_campaign_config_meta_campaign_id_unique" UNIQUE("meta_campaign_id")
);
--> statement-breakpoint
CREATE TABLE "booking_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" "booking_provider" NOT NULL,
	"external_account_id" text,
	"email" text,
	"display_name" text,
	"config" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"last_sync_at" timestamp,
	"token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_booking_provider_account" UNIQUE("organization_id","provider","external_account_id")
);
--> statement-breakpoint
CREATE TABLE "voice_call" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text,
	"agent_id" text NOT NULL,
	"phone_number_id" text,
	"status" "voice_call_status" DEFAULT 'pending' NOT NULL,
	"from_number" text,
	"to_number" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"duration_ms" integer,
	"outcome" "voice_call_outcome",
	"disconnection_reason" text,
	"transcript" text,
	"recording_url" text,
	"ai_summary" text,
	"sentiment" "voice_sentiment",
	"appointment_booked" boolean DEFAULT false,
	"appointment_details" jsonb,
	"callback_requested" boolean DEFAULT false,
	"callback_time" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_script" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text DEFAULT 'Default Script' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"initial_message" text NOT NULL,
	"script" text,
	"qualification_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"follow_ups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voice_provider_agent_id" text,
	"agent_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_number" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"label" text,
	"provider" "phone_number_provider" DEFAULT 'telnyx' NOT NULL,
	"provider_number_id" text,
	"status" "phone_number_status" DEFAULT 'pending_registration' NOT NULL,
	"supports_outbound" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"country_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphic_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" "graphic_template_category" NOT NULL,
	"business_types" text[] DEFAULT '{}' NOT NULL,
	"preview_url" text,
	"canvas_json" jsonb,
	"placeholders" jsonb DEFAULT '[]'::jsonb,
	"slides" jsonb,
	"is_carousel" boolean DEFAULT false NOT NULL,
	"min_slides" integer DEFAULT 1,
	"max_slides" integer DEFAULT 10,
	"aspect_ratio" "aspect_ratio" DEFAULT '1:1' NOT NULL,
	"width" integer DEFAULT 1080 NOT NULL,
	"height" integer DEFAULT 1080 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"organization_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "graphic_template_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "graphic" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"status" "graphic_status" DEFAULT 'draft' NOT NULL,
	"template_id" text,
	"slides" jsonb NOT NULL,
	"aspect_ratio" "aspect_ratio" DEFAULT '1:1',
	"canvas_width" integer DEFAULT 1080,
	"canvas_height" integer DEFAULT 1080,
	"outputs" jsonb,
	"organization_id" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"description" text,
	"color" "appointment_color" DEFAULT 'blue' NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"source" "appointment_source" DEFAULT 'manual' NOT NULL,
	"lead_id" text NOT NULL,
	"assigned_to_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" text,
	"calendar_account_id" text,
	"external_calendar_event_id" text,
	"deposit_required" boolean DEFAULT false NOT NULL,
	"reminder_sent_at_24h" timestamp,
	"reminder_sent_at_1h" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"included_credits" integer DEFAULT 100000 NOT NULL,
	"auto_refill_enabled" boolean DEFAULT false NOT NULL,
	"auto_refill_threshold" integer DEFAULT 10000,
	"auto_refill_package_id" text,
	"low_balance_alert_threshold" integer DEFAULT 20000,
	"low_balance_alert_sent" boolean DEFAULT false NOT NULL,
	"last_refill_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"channel" "credit_channel",
	"reference_id" text,
	"reference_type" text,
	"description" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"subscription_id" text,
	"status" "invoice_status" NOT NULL,
	"amount_due" integer NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"hosted_invoice_url" text,
	"invoice_pdf" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"due_date" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"status" "subscription_status" DEFAULT 'incomplete' NOT NULL,
	"plan_id" text DEFAULT 'pro' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "social_post" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"caption" text,
	"media_type" "social_post_media_type" NOT NULL,
	"media_url" text NOT NULL,
	"thumbnail_url" text,
	"video_id" text,
	"graphic_id" text,
	"platforms" jsonb NOT NULL,
	"platform_settings" jsonb,
	"scheduled_at" timestamp,
	"published_at" timestamp,
	"status" "social_post_status" DEFAULT 'draft' NOT NULL,
	"platform_results" jsonb,
	"error_message" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_connect_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_id" text,
	"stripe_account_id" text NOT NULL,
	"account_name" text,
	"account_email" text,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"default_currency" text,
	"default_deposit_amount_cents" integer,
	"deposit_expiration_hours" integer DEFAULT 24,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_connect_integration_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_deposit" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "deposit_status" DEFAULT 'pending' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_connected_account_id" text NOT NULL,
	"checkout_url" text,
	"expires_at" timestamp NOT NULL,
	"paid_at" timestamp,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"status" "asset_analysis_status" DEFAULT 'queued' NOT NULL,
	"content_type" "asset_content_type",
	"analysis_result" jsonb,
	"error_message" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "asset_analysis_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "asset_service" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"service_id" text NOT NULL,
	"confidence" real,
	"is_auto_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_service_unique" UNIQUE("asset_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "organization_service" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "service_category" DEFAULT 'treatment' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_deposit" boolean DEFAULT false NOT NULL,
	"deposit_amount_cents" integer,
	"deposit_link" text,
	"stripe_payment_link_id" text,
	"stripe_product_id" text,
	"pain_points" jsonb,
	"expected_results" jsonb,
	"process_description" text,
	"target_area" text,
	"pricing_description" text,
	"appointment_duration" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_service_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "organization_location" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"city" text NOT NULL,
	"county" text,
	"postal_code" text,
	"country" "country" NOT NULL,
	"latitude" real,
	"longitude" real,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_upload_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"total_assets" integer NOT NULL,
	"completed_assets" integer DEFAULT 0 NOT NULL,
	"failed_assets" integer DEFAULT 0 NOT NULL,
	"face_detection_completed_count" integer DEFAULT 0 NOT NULL,
	"status" "asset_upload_batch_status" DEFAULT 'pending' NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"profile_picture" text,
	"encrypted_credentials" text NOT NULL,
	"token_expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_drive_email" UNIQUE("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"meta_ads_page_id" text,
	"whatsapp_account_id" text,
	"external_user_id" text NOT NULL,
	"external_user_name" text,
	"external_user_avatar" text,
	"platform" "messaging_platform" NOT NULL,
	"status" "conversation_status" DEFAULT 'bot_handling' NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"assigned_to_id" text,
	"last_message_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_conversation_user" UNIQUE("organization_id","external_user_id","platform")
);
--> statement-breakpoint
CREATE TABLE "conversation_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"message_type" "message_type" DEFAULT 'text' NOT NULL,
	"external_message_id" text,
	"origin" text DEFAULT 'live' NOT NULL,
	"metadata" jsonb,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_my_business_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_id" text,
	"google_account_email" text NOT NULL,
	"account_name" text NOT NULL,
	"location_id" text NOT NULL,
	"location_name" text NOT NULL,
	"place_id" text NOT NULL,
	"review_link" text NOT NULL,
	"average_rating" numeric(2, 1),
	"total_reviews" integer DEFAULT 0,
	"encrypted_credentials" text NOT NULL,
	"token_expires_at" timestamp,
	"last_sync_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_location" UNIQUE("organization_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "google_review" (
	"id" text PRIMARY KEY NOT NULL,
	"google_my_business_account_id" text NOT NULL,
	"review_id" text NOT NULL,
	"reviewer_name" text NOT NULL,
	"reviewer_photo_url" text,
	"rating" integer NOT NULL,
	"comment" text,
	"reply_comment" text,
	"replied_at" timestamp,
	"published_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_account_review" UNIQUE("google_my_business_account_id","review_id")
);
--> statement-breakpoint
CREATE TABLE "face_detection" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"face_group_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"rekognition_face_id" text NOT NULL,
	"bounding_box" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"thumbnail_url" text,
	"frame_index" integer DEFAULT 0 NOT NULL,
	"attributes" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"rekognition_face_id" text NOT NULL,
	"client_name" text,
	"client_notes" text,
	"thumbnail_url" text,
	"service_id" text,
	"practitioner_id" text,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"exclusion_reason" "face_group_exclusion_reason",
	"total_detections" integer DEFAULT 0 NOT NULL,
	"batch_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_group_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"face_group_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"batch_id" text,
	"role" "face_group_asset_role" DEFAULT 'untagged' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "face_group_asset_face_group_id_asset_id_unique" UNIQUE("face_group_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"description" text,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_connected_account_id" text NOT NULL,
	"checkout_url" text,
	"customer_email" text,
	"customer_name" text,
	"metadata" jsonb,
	"expires_at" timestamp,
	"paid_at" timestamp,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practitioner" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"photo" text,
	"bio" text,
	"title" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"profile_setup_completed" boolean DEFAULT false NOT NULL,
	"calendar_account_id" text,
	"booking_account_id" text,
	"external_booking_id" text,
	"booking_link" text,
	"working_hours" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "practitioner_org_email_unique" UNIQUE("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "practitioner_location" (
	"id" text PRIMARY KEY NOT NULL,
	"practitioner_id" text NOT NULL,
	"location_id" text NOT NULL,
	"working_hours" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "practitioner_location_unique" UNIQUE("practitioner_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "practitioner_service" (
	"id" text PRIMARY KEY NOT NULL,
	"practitioner_id" text NOT NULL,
	"service_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "practitioner_service_unique" UNIQUE("practitioner_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "device_push_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_push_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"booking_reminders" boolean DEFAULT true NOT NULL,
	"booking_alerts" boolean DEFAULT true NOT NULL,
	"message_notifications" boolean DEFAULT true NOT NULL,
	"marketing_emails" boolean DEFAULT false NOT NULL,
	"app_updates" boolean DEFAULT false NOT NULL,
	"weekly_digest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"headline" text NOT NULL,
	"description" text,
	"type" "offer_type" NOT NULL,
	"original_price_cents" integer,
	"offer_price_cents" integer,
	"discount_percent" integer,
	"buy_quantity" integer,
	"get_quantity" integer,
	"bullet_points" jsonb,
	"cta_text" text,
	"urgency_text" text,
	"audience_text" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_service" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"service_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offer_service_unique" UNIQUE("offer_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "assistant_message_role" NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"attachments" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"date" date DEFAULT now() NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "unique_assistant_usage_org_date" UNIQUE("organization_id","date")
);
--> statement-breakpoint
CREATE TABLE "knowledge_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"type" "knowledge_entry_type" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb,
	"source" "knowledge_source",
	"confidence" real DEFAULT 1,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"variants" jsonb NOT NULL,
	"status" "experiment_status" DEFAULT 'active' NOT NULL,
	"posthog_feature_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "experiment_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"variant" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_assignment_unique" UNIQUE("experiment_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "voice_embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"meta_ads_page_id" text,
	"customer_message" text NOT NULL,
	"business_reply" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"message_timestamp" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_campaign_daily_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"meta_ad_id" text,
	"date" timestamp NOT NULL,
	"spend" integer NOT NULL,
	"currency" text NOT NULL,
	"cpc" integer,
	"cpm" integer,
	"spend_usd" integer NOT NULL,
	"cpc_usd" integer,
	"cpm_usd" integer,
	"exchange_rate" text,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"ctr" text,
	"frequency" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meta_campaign_daily_insights_meta_campaign_id_meta_ad_id_date_unique" UNIQUE("meta_campaign_id","meta_ad_id","date")
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_performed_by_id_user_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_execution" ADD CONSTRAINT "sequence_execution_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_execution" ADD CONSTRAINT "sequence_execution_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_execution" ADD CONSTRAINT "sequence_execution_step_id_sequence_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step" ADD CONSTRAINT "sequence_step_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_version" ADD CONSTRAINT "sequence_version_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_version" ADD CONSTRAINT "sequence_version_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integration" ADD CONSTRAINT "organization_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_account" ADD CONSTRAINT "email_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_account" ADD CONSTRAINT "calendar_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_account" ADD CONSTRAINT "calendar_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_account" ADD CONSTRAINT "whatsapp_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_account" ADD CONSTRAINT "whatsapp_account_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_pending_connection" ADD CONSTRAINT "whatsapp_pending_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_pending_connection" ADD CONSTRAINT "whatsapp_pending_connection_initiated_by_id_user_id_fk" FOREIGN KEY ("initiated_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_integration" ADD CONSTRAINT "meta_ads_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_integration" ADD CONSTRAINT "meta_ads_integration_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD CONSTRAINT "instagram_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD CONSTRAINT "instagram_integration_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_page" ADD CONSTRAINT "meta_ads_page_meta_ads_integration_id_meta_ads_integration_id_fk" FOREIGN KEY ("meta_ads_integration_id") REFERENCES "public"."meta_ads_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_form" ADD CONSTRAINT "lead_form_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_form" ADD CONSTRAINT "lead_form_meta_page_id_meta_ads_page_id_fk" FOREIGN KEY ("meta_page_id") REFERENCES "public"."meta_ads_page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_form" ADD CONSTRAINT "lead_form_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_video_progress" ADD CONSTRAINT "user_video_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_video_progress" ADD CONSTRAINT "user_video_progress_training_video_id_training_video_id_fk" FOREIGN KEY ("training_video_id") REFERENCES "public"."training_video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad" ADD CONSTRAINT "meta_ad_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad" ADD CONSTRAINT "meta_ad_social_post_id_social_post_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad" ADD CONSTRAINT "meta_ad_lead_form_id_lead_form_id_fk" FOREIGN KEY ("lead_form_id") REFERENCES "public"."lead_form"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad" ADD CONSTRAINT "meta_ad_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad" ADD CONSTRAINT "meta_ad_meta_ads_page_id_meta_ads_page_id_fk" FOREIGN KEY ("meta_ads_page_id") REFERENCES "public"."meta_ads_page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_service" ADD CONSTRAINT "meta_ad_service_meta_ad_id_meta_ad_id_fk" FOREIGN KEY ("meta_ad_id") REFERENCES "public"."meta_ad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_service" ADD CONSTRAINT "meta_ad_service_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaign_config" ADD CONSTRAINT "meta_campaign_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaign_config" ADD CONSTRAINT "meta_campaign_config_meta_ads_page_id_meta_ads_page_id_fk" FOREIGN KEY ("meta_ads_page_id") REFERENCES "public"."meta_ads_page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaign_config" ADD CONSTRAINT "meta_campaign_config_experiment_id_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_account" ADD CONSTRAINT "booking_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_account" ADD CONSTRAINT "booking_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_phone_number_id_phone_number_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_number"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_script" ADD CONSTRAINT "voice_script_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_number" ADD CONSTRAINT "phone_number_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD CONSTRAINT "graphic_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic" ADD CONSTRAINT "graphic_template_id_graphic_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."graphic_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic" ADD CONSTRAINT "graphic_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic" ADD CONSTRAINT "graphic_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_calendar_account_id_calendar_account_id_fk" FOREIGN KEY ("calendar_account_id") REFERENCES "public"."calendar_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_graphic_id_graphic_id_fk" FOREIGN KEY ("graphic_id") REFERENCES "public"."graphic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connect_integration" ADD CONSTRAINT "stripe_connect_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connect_integration" ADD CONSTRAINT "stripe_connect_integration_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD CONSTRAINT "appointment_deposit_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD CONSTRAINT "appointment_deposit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_analysis" ADD CONSTRAINT "asset_analysis_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_service" ADD CONSTRAINT "asset_service_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_service" ADD CONSTRAINT "asset_service_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service" ADD CONSTRAINT "organization_service_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_location" ADD CONSTRAINT "organization_location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload_batch" ADD CONSTRAINT "asset_upload_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload_batch" ADD CONSTRAINT "asset_upload_batch_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_account" ADD CONSTRAINT "drive_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_account" ADD CONSTRAINT "drive_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_meta_ads_page_id_meta_ads_page_id_fk" FOREIGN KEY ("meta_ads_page_id") REFERENCES "public"."meta_ads_page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_whatsapp_account_id_whatsapp_account_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_my_business_account" ADD CONSTRAINT "google_my_business_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_my_business_account" ADD CONSTRAINT "google_my_business_account_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_review" ADD CONSTRAINT "google_review_google_my_business_account_id_google_my_business_account_id_fk" FOREIGN KEY ("google_my_business_account_id") REFERENCES "public"."google_my_business_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_detection" ADD CONSTRAINT "face_detection_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_detection" ADD CONSTRAINT "face_detection_face_group_id_face_group_id_fk" FOREIGN KEY ("face_group_id") REFERENCES "public"."face_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_detection" ADD CONSTRAINT "face_detection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_group" ADD CONSTRAINT "face_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_group" ADD CONSTRAINT "face_group_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_group" ADD CONSTRAINT "face_group_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_group_asset" ADD CONSTRAINT "face_group_asset_face_group_id_face_group_id_fk" FOREIGN KEY ("face_group_id") REFERENCES "public"."face_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_group_asset" ADD CONSTRAINT "face_group_asset_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner" ADD CONSTRAINT "practitioner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner" ADD CONSTRAINT "practitioner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner" ADD CONSTRAINT "practitioner_calendar_account_id_calendar_account_id_fk" FOREIGN KEY ("calendar_account_id") REFERENCES "public"."calendar_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner" ADD CONSTRAINT "practitioner_booking_account_id_booking_account_id_fk" FOREIGN KEY ("booking_account_id") REFERENCES "public"."booking_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_location" ADD CONSTRAINT "practitioner_location_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_location" ADD CONSTRAINT "practitioner_location_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_service" ADD CONSTRAINT "practitioner_service_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_service" ADD CONSTRAINT "practitioner_service_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_push_token" ADD CONSTRAINT "device_push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_service" ADD CONSTRAINT "offer_service_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_service" ADD CONSTRAINT "offer_service_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD CONSTRAINT "knowledge_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignment" ADD CONSTRAINT "experiment_assignment_experiment_id_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignment" ADD CONSTRAINT "experiment_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_embedding" ADD CONSTRAINT "voice_embedding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_embedding" ADD CONSTRAINT "voice_embedding_meta_ads_page_id_meta_ads_page_id_fk" FOREIGN KEY ("meta_ads_page_id") REFERENCES "public"."meta_ads_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaign_daily_insights" ADD CONSTRAINT "meta_campaign_daily_insights_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invitation_org_id" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_invitation_inviter_id" ON "invitation" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "idx_member_org_id" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_member_user_id" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_asset_org_id" ON "asset" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_asset_uploaded_by_id" ON "asset" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE INDEX "idx_video_org_id" ON "video" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_video_created_by_id" ON "video" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_lead_org_id" ON "lead" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_lead_assigned_to_id" ON "lead" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "idx_lead_activity_lead_id" ON "lead_activity" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_org_id" ON "sequence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_created_by_id" ON "sequence" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_execution_lead_id" ON "sequence_execution" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_execution_sequence_id" ON "sequence_execution" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_step_sequence_id" ON "sequence_step" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_version_sequence_id" ON "sequence_version" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_account_user_id" ON "calendar_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_account_connected_by_id" ON "whatsapp_account" USING btree ("connected_by_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ads_integration_connected_by_id" ON "meta_ads_integration" USING btree ("connected_by_id");--> statement-breakpoint
CREATE INDEX "idx_lead_form_org_id" ON "lead_form" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_lead_form_meta_page_id" ON "lead_form" USING btree ("meta_page_id");--> statement-breakpoint
CREATE INDEX "idx_lead_form_created_by_id" ON "lead_form" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_user_video_progress_video_id" ON "user_video_progress" USING btree ("training_video_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ad_org_id" ON "meta_ad" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ad_lead_form_id" ON "meta_ad" USING btree ("lead_form_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ad_sequence_id" ON "meta_ad" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ad_meta_ads_page_id" ON "meta_ad" USING btree ("meta_ads_page_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ad_meta_ad_id" ON "meta_ad" USING btree ("meta_ad_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ad_social_post_id" ON "meta_ad" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "idx_meta_ad_service_service_id" ON "meta_ad_service" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_meta_campaign_config_org_id" ON "meta_campaign_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_meta_campaign_config_page_id" ON "meta_campaign_config" USING btree ("meta_ads_page_id");--> statement-breakpoint
CREATE INDEX "idx_booking_account_user_id" ON "booking_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_voice_call_lead_id" ON "voice_call" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_voice_call_phone_number_id" ON "voice_call" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "idx_voice_script_org_id" ON "voice_script" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_phone_number_org_id" ON "phone_number" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_org_id" ON "graphic" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_template_id" ON "graphic" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_created_by_id" ON "graphic" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_org_id" ON "appointment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_lead_id" ON "appointment" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_assigned_to_id" ON "appointment" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_practitioner_id" ON "appointment" USING btree ("practitioner_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_calendar_account_id" ON "appointment" USING btree ("calendar_account_id");--> statement-breakpoint
CREATE INDEX "idx_credit_transaction_org_id" ON "credit_transactions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_org_id" ON "invoices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_subscription_id" ON "invoices" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_social_post_org_id" ON "social_post" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_social_post_video_id" ON "social_post" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_social_post_graphic_id" ON "social_post" USING btree ("graphic_id");--> statement-breakpoint
CREATE INDEX "idx_social_post_created_by_id" ON "social_post" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_stripe_connect_connected_by_id" ON "stripe_connect_integration" USING btree ("connected_by_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_deposit_appointment_id" ON "appointment_deposit" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_deposit_org_id" ON "appointment_deposit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_asset_service_service_id" ON "asset_service" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_org_location_org_id" ON "organization_location" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_asset_upload_batch_org_id" ON "asset_upload_batch" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_asset_upload_batch_created_by_id" ON "asset_upload_batch" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_drive_account_user_id" ON "drive_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_org_id" ON "conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_assigned_to_id" ON "conversation" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_message_conversation_id" ON "conversation_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_conversation_message_ext_id" ON "conversation_message" USING btree ("conversation_id","external_message_id") WHERE external_message_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_conversation_message_dedup" ON "conversation_message" USING btree ("conversation_id","role","sent_at");--> statement-breakpoint
CREATE INDEX "idx_gmb_account_connected_by_id" ON "google_my_business_account" USING btree ("connected_by_id");--> statement-breakpoint
CREATE INDEX "idx_face_detection_asset_id" ON "face_detection" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_face_detection_face_group_id" ON "face_detection" USING btree ("face_group_id");--> statement-breakpoint
CREATE INDEX "idx_face_detection_org_id" ON "face_detection" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_face_group_org_id" ON "face_group" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_face_group_service_id" ON "face_group" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_face_group_asset_asset_id" ON "face_group_asset" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_payment_org_id" ON "payment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_payment_lead_id" ON "payment" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_practitioner_user_id" ON "practitioner" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_practitioner_calendar_account_id" ON "practitioner" USING btree ("calendar_account_id");--> statement-breakpoint
CREATE INDEX "idx_practitioner_booking_account_id" ON "practitioner" USING btree ("booking_account_id");--> statement-breakpoint
CREATE INDEX "idx_practitioner_location_location_id" ON "practitioner_location" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_practitioner_service_service_id" ON "practitioner_service" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_offer_org_id" ON "offer" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_offer_is_active" ON "offer" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_offer_service_service_id" ON "offer_service" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_assistant_conversation_org_id" ON "assistant_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_assistant_conversation_user_id" ON "assistant_conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_assistant_message_conversation_id" ON "assistant_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_assistant_usage_org_id" ON "assistant_usage" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_entry_org_id" ON "knowledge_entry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_entry_type" ON "knowledge_entry" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_experiment_assignment_org_id" ON "experiment_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_experiment_assignment_experiment_id" ON "experiment_assignment" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "idx_voice_embedding_org_id" ON "voice_embedding" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_voice_embedding_meta_ads_page_id" ON "voice_embedding" USING btree ("meta_ads_page_id");--> statement-breakpoint
CREATE INDEX "idx_voice_embedding_vector" ON "voice_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_meta_insights_org" ON "meta_campaign_daily_insights" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_meta_insights_date" ON "meta_campaign_daily_insights" USING btree ("date");