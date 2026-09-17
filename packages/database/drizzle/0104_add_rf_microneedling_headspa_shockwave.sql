-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Three techniques the taxonomy was missing
-- ============================================================================
-- All three surfaced from a human review pass over 243 classified clips: real
-- treatments with no slug to hold them, so the classifier forced each into a
-- neighbouring bucket where it does not belong.
--
--   rf_microneedling — a reviewer re-tagged "radiofrequency lifting procedure
--     for facial skin" as microneedling. Both readings are half right: it is a
--     needle cartridge AND radiofrequency. Neither `microneedling` nor
--     `radiofrequency` describes it, and the distinction matters because a
--     Morpheus8 clinic and a plain-RF clinic want visibly different footage.
--     This also fixes a latent bug in the shot list, which files Morpheus8 as
--     an agent under `radiofrequency` — on camera it looks like microneedling.
--
--   head_spa — a clip was rejected outright with the note "this is a Japanese
--     head spa". It had landed in `hair_styling`, which is wrong: it is a scalp
--     treatment, not a cut or colour.
--
--   shockwave — "shockwave physiotherapy applied to patient thigh" sat in the
--     `energy_contact` fallback. It is a distinct modality with a distinct
--     instrument and is commonly sold for cellulite alongside body contouring.
--
-- Adding a technique is an INSERT, exactly as the architecture intended. No
-- schema change and no re-classification is required — affected clips can be
-- retagged in the review page now that the options exist.
-- ============================================================================

INSERT INTO "technique" (slug, display_name, visual_signature, is_procedural) VALUES

('rf_microneedling', 'RF microneedling',
 'A pen or stamp-shaped handpiece with a replaceable needle cartridge pressed STRAIGHT DOWN onto skin and lifted, point by point, rather than glided. A console showing depth and energy settings is usually visible. Distinguished from plain microneedling by the stamping motion and the settings console; from radiofrequency by the cartridge and the absence of continuous gliding.', true),

('head_spa', 'Head spa / scalp treatment',
 'A reclined client at a basin or bowl with water jets, foams or oils worked through the scalp, often with a magnified scalp camera. Focused on the scalp and hair roots rather than cutting, colouring or drying.', true),

('shockwave', 'Shockwave therapy',
 'A handheld applicator pressed firmly against tissue — typically thigh, buttock or a joint — delivering visible rhythmic pulses, with gel and a console. The applicator is held in place or moved slowly in small increments rather than glided continuously.', true)

ON CONFLICT (slug) DO NOTHING;
