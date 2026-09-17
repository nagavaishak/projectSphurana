ALTER POLICY "child_org_isolation" ON "video_draft_clip" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM video p
    WHERE p.id = video_draft_clip.video_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM video p
    WHERE p.id = video_draft_clip.video_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "lead_activity" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM lead p
    WHERE p.id = lead_activity.lead_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM lead p
    WHERE p.id = lead_activity.lead_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "sequence_execution" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM sequence p
    WHERE p.id = sequence_execution.sequence_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM sequence p
    WHERE p.id = sequence_execution.sequence_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "sequence_step" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM sequence p
    WHERE p.id = sequence_step.sequence_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM sequence p
    WHERE p.id = sequence_step.sequence_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "sequence_version" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM sequence p
    WHERE p.id = sequence_version.sequence_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM sequence p
    WHERE p.id = sequence_version.sequence_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "meta_ads_page" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM meta_ads_integration p
    WHERE p.id = meta_ads_page.meta_ads_integration_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM meta_ads_integration p
    WHERE p.id = meta_ads_page.meta_ads_integration_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "meta_ad_service" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM meta_ad p
    WHERE p.id = meta_ad_service.meta_ad_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM meta_ad p
    WHERE p.id = meta_ad_service.meta_ad_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "voice_call" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM lead p
    WHERE p.id = voice_call.lead_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM lead p
    WHERE p.id = voice_call.lead_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "asset_analysis" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM asset p
    WHERE p.id = asset_analysis.asset_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM asset p
    WHERE p.id = asset_analysis.asset_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "asset_service" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM asset p
    WHERE p.id = asset_service.asset_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM asset p
    WHERE p.id = asset_service.asset_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "organization_package_item" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM organization_package p
    WHERE p.id = organization_package_item.package_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM organization_package p
    WHERE p.id = organization_package_item.package_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "org_location_opening_hours_exception" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM organization_location p
    WHERE p.id = org_location_opening_hours_exception.location_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM organization_location p
    WHERE p.id = org_location_opening_hours_exception.location_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "conversation_message" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM conversation p
    WHERE p.id = conversation_message.conversation_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM conversation p
    WHERE p.id = conversation_message.conversation_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "google_review" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM google_my_business_account p
    WHERE p.id = google_review.google_my_business_account_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM google_my_business_account p
    WHERE p.id = google_review.google_my_business_account_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "face_group_asset" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM face_group p
    WHERE p.id = face_group_asset.face_group_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM face_group p
    WHERE p.id = face_group_asset.face_group_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "practitioner_location" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM practitioner p
    WHERE p.id = practitioner_location.practitioner_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM practitioner p
    WHERE p.id = practitioner_location.practitioner_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "practitioner_service" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM practitioner p
    WHERE p.id = practitioner_service.practitioner_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM practitioner p
    WHERE p.id = practitioner_service.practitioner_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "offer_location" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM offer p
    WHERE p.id = offer_location.offer_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM offer p
    WHERE p.id = offer_location.offer_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "offer_service" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM offer p
    WHERE p.id = offer_service.offer_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM offer p
    WHERE p.id = offer_service.offer_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "assistant_message" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM assistant_conversation p
    WHERE p.id = assistant_message.conversation_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM assistant_conversation p
    WHERE p.id = assistant_message.conversation_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "content_batch_item" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM content_batch p
    WHERE p.id = content_batch_item.batch_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM content_batch p
    WHERE p.id = content_batch_item.batch_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "blocked_time_exception" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_exception.blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_exception.blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "blocked_time_practitioner" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_practitioner.blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_practitioner.blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "membership_plan_service" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM membership_plan p
    WHERE p.id = membership_plan_service.plan_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM membership_plan p
    WHERE p.id = membership_plan_service.plan_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "join_org_isolation" ON "product_stock" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_stock.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_stock.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "stock_order_fee" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_fee.stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_fee.stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "stock_order_item" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_item.stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_item.stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "stock_take_item" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM stock_take p
    WHERE p.id = stock_take_item.stock_take_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM stock_take p
    WHERE p.id = stock_take_item.stock_take_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "sale_item" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_item.sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_item.sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "sale_payment" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_payment.sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_payment.sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "gift_card_transaction" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM gift_card p
    WHERE p.id = gift_card_transaction.gift_card_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM gift_card p
    WHERE p.id = gift_card_transaction.gift_card_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "time_entry_break" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM time_entry p
    WHERE p.id = time_entry_break.time_entry_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM time_entry p
    WHERE p.id = time_entry_break.time_entry_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "campaign_event" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_event.campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_event.campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "campaign_message" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_message.campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_message.campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
ALTER POLICY "child_org_isolation" ON "campaign_recipient" TO app_authenticated,app_public USING (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_recipient.campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_recipient.campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));