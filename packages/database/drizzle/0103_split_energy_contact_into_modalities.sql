-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Promote body-energy MODALITY from agent to technique
-- ============================================================================
-- 0100 seeded a single `energy_contact` technique covering every handheld
-- body-energy device, on the shot list's premise that RF, EMS, cryolipolysis,
-- laser lipo, endospheres and cavitation are indistinguishable on camera, with
-- the difference carried by `treatment_agent`.
--
-- That premise put the boundary one level too low, and it defeats the design it
-- was meant to serve: licensed footage can never carry an agent_slug (see the
-- CHECK constraint stock_clip_agent_requires_declarable_source), so an RF clip
-- stayed at technique grade and would be offered to an EMS clinic — precisely
-- the failure the whole matching architecture exists to prevent.
--
-- Applying the design's own rule — technique is the visually-distinguishable
-- axis, agent is the one that is not — most of these ARE readable, and the shot
-- list itself describes how: EMS paddles STRAPPED on with visible contraction,
-- a cryo applicator CLAMPED with a vacuum cup, the endospheres sphere-matrix
-- roller, laser lipo's green light array. Only RF and cavitation are genuinely
-- the same shot.
--
-- So: MODALITY is the technique. BRAND stays the agent (Endymed, Exion,
-- Morpheus8, T-Shape under radiofrequency; CoolSculpting, Kaasen under
-- cryolipolysis) and remains correctly unknowable from a frame.
--
-- Evidence that prompted this: of 24 clips classified `energy_contact`, 12 had
-- the modality named in the source filename (9 RF, 3 EMS). The classifier could
-- not have said so — no slug existed for it.
--
-- `energy_contact` is KEPT, narrowed to a genuine fallback for footage where
-- the modality cannot be read. It is not dropped: existing rows reference it,
-- and "unreadable" remains a real and correct answer.
-- ============================================================================

INSERT INTO "technique" (slug, display_name, visual_signature, is_procedural) VALUES

('radiofrequency', 'Radiofrequency',
 'A smooth handpiece glided over skin with gel, usually beside a console or screen. No vacuum cup, no straps, no light emission. Visually the same as cavitation — if ultrasound is indicated, prefer cavitation; otherwise this.', true),

('ems_stimulation', 'Electromagnetic muscle stimulation',
 'Flat paddles or pads STRAPPED to the abdomen, glutes or limbs, or a seated chair unit. The client is passive and visible muscle contraction occurs. Nothing is held or moved by the operator.', true),

('cryolipolysis', 'Cryolipolysis / fat freezing',
 'A bulky applicator CLAMPED onto a fold of tissue, typically flank or abdomen, with a vacuum cup drawing tissue in. Applicator stays fixed in place rather than being moved.', true),

('laser_lipo', 'Laser lipolysis',
 'Flat pads or an overhead array emitting visible RED or GREEN light, laid over or above the torso or limbs. No contact handpiece and no gel.', true),

('endospheres', 'Endospheres / compressive microvibration',
 'A cylindrical roller head covered in a distinctive matrix of spheres, rolled over the body. The sphere pattern is the tell and is unmistakable when visible.', true),

('cavitation', 'Ultrasonic cavitation',
 'A handheld head worked over the body with generous ultrasound gel, often with a visibly wet surface. Visually the same as radiofrequency — choose this only where ultrasound is indicated.', true)

ON CONFLICT (slug) DO NOTHING;

-- Narrow the fallback so the classifier stops treating it as the default for
-- anything handheld. It should now be chosen only when the modality genuinely
-- cannot be determined.
UPDATE "technique"
SET
  display_name = 'Body energy device (modality unclear)',
  visual_signature =
    'FALLBACK ONLY. A handheld or applied device on the body whose modality cannot be determined from the frame — no visible straps, vacuum cup, sphere roller, light array or ultrasound gel to distinguish it. Prefer a specific modality whenever one is readable; choosing this when a specific one fits is an error.'
WHERE slug = 'energy_contact';
