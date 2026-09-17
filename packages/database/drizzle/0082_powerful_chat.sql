CREATE TABLE "processed_webhook_event" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhook_event_pkey" PRIMARY KEY("provider","event_id")
);
