-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Seed the technique vocabulary
-- ============================================================================
-- 0098 created `technique` and `treatment_agent` but seeded neither, so both
-- were empty. technique.slug is the FK target for treatment_agent.technique_slug
-- and for the gate's technique branch, so nothing downstream can match until it
-- is populated.
--
-- The gap surfaced concretely: a vision pass over 243 stock clips with no
-- controlled vocabulary invented its own slugs and drifted immediately —
-- `hair_wash` AND `hair_washing`, and `brow_tattooing` AND `microblading` AND
-- `brow_lash` for overlapping concepts. Free text always does this. The
-- classifier now picks from this table instead of generating.
--
-- `technique` is the VISUALLY-DISTINGUISHABLE axis. If two treatments cannot be
-- told apart in a frame they share a technique, and the difference is carried by
-- `treatment_agent` — which is declared, never inferred. `energy_contact` is the
-- deliberate catch-all for exactly that case, and is narrow on purpose: it
-- covers handheld contact energy devices on the BODY, where RF, cavitation, EMS,
-- cryolipolysis and endospheres genuinely look alike. It must NOT absorb classes
-- that ARE distinguishable — which is what happened to laser hair removal on the
-- first classification pass (41 laser clips, exactly 1 classified as laser).
--
-- `visual_signature` is what the frame looks like. It documents why the class
-- exists and is fed to the classifier as the definition of each option.
--
-- Adding a technique later is an INSERT, not a migration. This seed exists only
-- because every environment needs the initial vocabulary.
-- ============================================================================

INSERT INTO "technique" (slug, display_name, visual_signature, is_procedural) VALUES

-- ── Injectables ─────────────────────────────────────────────────────────────
-- One technique for every injectable. Toxin, filler, Profhilo, mesotherapy,
-- polynucleotides and fat dissolving are the same shot at the same site; the
-- product is never visible, so the agent carries the difference.
('injection', 'Injection',
 'A needle, syringe or cannula entering skin. Gloved hands, close-up. Covers single-point and multi-point work alike.', true),

-- ── Light and laser ─────────────────────────────────────────────────────────
('laser_hair_removal', 'Laser / IPL hair removal',
 'A handpiece pressed to skin in overlapping passes for hair reduction, usually with protective eyewear and often a cooling tip. Covers laser and IPL.', true),
('laser_skin', 'Laser skin treatment',
 'A laser applied to the face for resurfacing, pigment or carbon-peel work. Distinguished from hair removal by facial placement and a static or scanning head rather than sweeping passes.', true),
('led_therapy', 'LED / light therapy',
 'A panel or mask of coloured LEDs held over the face or body. No contact and no handpiece.', true),

-- ── Skin ────────────────────────────────────────────────────────────────────
('microneedling', 'Microneedling',
 'A pen-shaped device tracked in short strokes across skin, often over serum, with a fine needle cartridge at the tip.', true),
('chemical_peel', 'Chemical peel',
 'Solution painted onto skin with a brush or gauze, sometimes followed by visible frosting or a neutralising step.', true),
('facial_device', 'Device facial',
 'A wand or tip glided over facial skin using suction, water or gas. Tethered handpiece, visible tubing or console.', true),
('manual_facial', 'Manual facial',
 'Hands-on facial work: steaming, extraction, cleansing, mask application, massage. No powered device.', true),
('dermaplaning', 'Dermaplaning',
 'A blade held at a shallow angle and drawn across taut facial skin.', true),

-- ── Energy and contouring ───────────────────────────────────────────────────
-- THE AMBIGUOUS CLASS. This is why the agent axis exists at all.
('energy_contact', 'Contact energy device (body)',
 'A handheld head or applicator moved over the body, usually with gel, often beside a console or screen. RF, cavitation, EMS, cryolipolysis, endospheres and laser lipo are NOT distinguishable here — never guess which. Use only when the device cannot be identified from the frame.', true),
('hifu', 'HIFU / ultrasound lifting',
 'An ultrasound transducer stepped across facial skin over gel, typically with a grid or guide drawn on the face.', true),
('thread_lift', 'Thread lift',
 'A long cannula or needle inserted under the skin and drawn through, usually at the jaw, cheek or brow.', true),

-- ── Brows, lashes, pigment ──────────────────────────────────────────────────
('brow_lash', 'Brow / lash treatment',
 'Brow lamination, tinting, lash lifting or lash extension. Tweezers, wands, tint and small tools around the eye. No pigment implanted.', true),
('pmu', 'Permanent makeup',
 'Pigment implanted into skin with a hand tool or machine — microblading strokes, powder brows, lip blush, permanent liner.', true),

-- ── Hair removal (non-light) ────────────────────────────────────────────────
('waxing', 'Waxing / threading',
 'Wax spread and stripped from skin, or thread twisted against it. Includes sugaring.', true),

-- ── Body and wellness ───────────────────────────────────────────────────────
('massage', 'Massage',
 'Manual massage with hands, oil or a handheld manual tool. No energy device.', true),
('lymphatic_drainage', 'Lymphatic drainage',
 'Light repetitive directional strokes, or an inflatable compression garment on legs or abdomen.', true),
('iv_drip', 'IV drip / injectable wellness',
 'A cannula placed in the arm or hand with a drip line and hanging bag.', true),

-- ── Hair and nails ──────────────────────────────────────────────────────────
('hair_colour', 'Hair colouring',
 'Colour applied at the root or into foils with a brush.', true),
('hair_styling', 'Hair styling',
 'Washing, cutting, blow-drying or styling. No colour being applied.', true),
('nails', 'Nail treatment',
 'Manicure or pedicure work — filing, gel or polish application, cuticle work, nail art.', true),

-- ── Other ───────────────────────────────────────────────────────────────────
('teeth_whitening', 'Teeth whitening',
 'A tray or LED lamp positioned at the open mouth, gums shielded.', true),
('spray_tan', 'Spray tanning',
 'Tanning solution sprayed onto skin, typically in a booth or tent.', true),

-- ── Non-procedural ──────────────────────────────────────────────────────────
-- No meaningful procedure shot exists. is_procedural = false routes these to
-- graphics and ambient by construction rather than by threshold, so the matcher
-- never hunts for footage that cannot exist.
('consultation', 'Consultation',
 'A practitioner and client talking, examining or planning. No treatment being performed.', false),
('assessment', 'Assessment / testing',
 'Measurement, sampling or diagnostic work — blood tests, scans, hearing or skin analysis.', false),
('wellness_program', 'Wellness programme',
 'Non-procedural services: courses, nutrition plans, credit packs, memberships.', false)

ON CONFLICT (slug) DO NOTHING;
