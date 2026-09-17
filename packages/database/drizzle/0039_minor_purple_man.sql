CREATE TABLE "organization_service_category" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_service_category_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "organization_package" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" text,
	"price_cents" integer NOT NULL,
	"validity_days" integer,
	"requires_deposit" boolean DEFAULT false NOT NULL,
	"deposit_amount_cents" integer,
	"deposit_link" text,
	"stripe_payment_link_id" text,
	"stripe_product_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_package_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "organization_package_item" (
	"id" text PRIMARY KEY NOT NULL,
	"package_id" text NOT NULL,
	"service_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_package_item_unique" UNIQUE("package_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "organization_service" RENAME COLUMN "pricing_description" TO "price_text";--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "requires_consultation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "organization_service_category" ADD CONSTRAINT "organization_service_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_package" ADD CONSTRAINT "organization_package_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_package" ADD CONSTRAINT "organization_package_category_id_organization_service_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."organization_service_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_package_item" ADD CONSTRAINT "organization_package_item_package_id_organization_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."organization_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_package_item" ADD CONSTRAINT "organization_package_item_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_organization_service_category_organization_id" ON "organization_service_category" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_organization_package_organization_id" ON "organization_package" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_organization_package_item_package_id" ON "organization_package_item" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "idx_organization_package_item_service_id" ON "organization_package_item" USING btree ("service_id");--> statement-breakpoint
ALTER TABLE "organization_service" ADD CONSTRAINT "organization_service_category_id_organization_service_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."organization_service_category"("id") ON DELETE set null ON UPDATE no action;