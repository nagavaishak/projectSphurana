-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Seed the treatment_agent vocabulary
-- ============================================================================
-- 0098 created the table; nothing has ever populated it. `technique` was seeded
-- in 0100/0103/0104, but a SERVICE reaches its technique through its agents
-- (service_agent -> treatment_agent.technique_slug), so with this table empty
-- no service can carry a spec and the gate has only one side.
--
-- AN AGENT NEED NOT BE A BRAND. For waxing, massage or threading the agent IS
-- the treatment, so every technique gets a default agent named after it. Brands
-- appear only where the market actually has them — and they matter most in the
-- visually-ambiguous classes, because that is where the agent is the ONLY thing
-- separating two treatments that look identical on camera.
--
-- `aliases` is the working part. Service names in production are a mess of
-- registered marks, generics and vague marketing ("BOTOX®", "Body Contouring",
-- "Barrier Repair"), and 93% of distinct names appear exactly once, so there is
-- no shared vocabulary to match on. Aliases let the classifier resolve the bulk
-- deterministically before any model is asked, and a name that matches nothing
-- correctly stays `unknown` rather than being guessed at.
--
-- `requires_exact_match` marks agents that must never be inferred from a
-- generic name — the machine-identity classes. A service called "Body
-- Contouring" must NOT resolve to `endospheres` just because the clinic happens
-- to own one; that is the exact failure the whole design exists to prevent.
-- ============================================================================

INSERT INTO "treatment_agent" (slug, display_name, technique_slug, aliases, requires_exact_match) VALUES

-- ── Injectables ─────────────────────────────────────────────────────────────
-- Same shot at the same site; the product is never visible, so these differ by
-- name alone and matching is region-driven.
('botulinum', 'Anti-wrinkle injections', 'injection',
 ARRAY['botox','azzalure','bocouture','dysport','xeomin','letybo','alluzience','anti wrinkle','antiwrinkle','wrinkle relaxing','muscle relaxing','line softening','baby botox','masseter','jaw slimming','hyperhidrosis','frown lines'], false),
('dermal_filler', 'Dermal filler', 'injection',
 ARRAY['filler','fillers','juvederm','restylane','teoxane','revolax','stylage','belotero','radiesse','sculptra','lip filler','cheek filler','chin filler','jaw filler','tear trough','nasolabial','marionette','russian lips','liquid rhinoplasty','non surgical rhinoplasty','8 point','facial balancing'], false),
('profhilo', 'Profhilo / bio-remodelling', 'injection',
 ARRAY['profhilo','bio remodelling','bioremodelling','bio-remodeling','hyaluronic bio'], false),
('skin_booster', 'Skin boosters', 'injection',
 ARRAY['skin booster','skinbooster','seventy hyal','sunekos','nctf','jalupro','viscoderm','hydro boost'], false),
('polynucleotides', 'Polynucleotides', 'injection',
 ARRAY['polynucleotide','nucleofill','lumi eyes','plinest','ameela','philart'], false),
('fat_dissolving', 'Fat dissolving injections', 'injection',
 ARRAY['aqualyx','lemon bottle','fat dissolving','fat dissolve','kybella','deoxycholic','desoface','lipolysis injection'], false),
('mesotherapy', 'Mesotherapy', 'injection',
 ARRAY['mesotherapy','meso','microinjection'], false),
('prp', 'PRP / platelet therapy', 'injection',
 ARRAY['prp','prgf','platelet rich','vampire facial','vampire lift','plasma injection','hair prp'], false),

-- ── Light and laser ─────────────────────────────────────────────────────────
('laser_hair_removal_generic', 'Laser / IPL hair removal', 'laser_hair_removal',
 ARRAY['laser hair','hair removal','laser epilation','epilation','depilation','ipl hair','diode laser','alexandrite','soprano','candela','lightsheer','elos','permanent hair reduction'], false),
('laser_resurfacing', 'Laser skin resurfacing', 'laser_skin',
 ARRAY['laser resurfacing','fractional','fsr','co2 laser','carbon peel','hollywood peel','laser facial','pigmentation laser','thread vein','vascular laser','rosacea laser','skin resurfacing','laser rejuvenation','q switch','picosecond','tattoo removal'], false),
('led_generic', 'LED light therapy', 'led_therapy',
 ARRAY['led','led mask','light therapy','red light','dermalux','celluma','photobiomodulation','blue light'], false),

-- ── Skin ────────────────────────────────────────────────────────────────────
('microneedling_generic', 'Microneedling', 'microneedling',
 ARRAY['microneedling','micro needling','dermapen','derma pen','skinpen','dermaroller','derma roller','derma stamp','collagen induction','cit'], false),
('rf_microneedling_generic', 'RF microneedling', 'rf_microneedling',
 ARRAY['rf microneedling','morpheus','morpheus8','secret rf','potenza','sylfirm','radiofrequency microneedling'], false),
('chemical_peel_generic', 'Chemical peel', 'chemical_peel',
 ARRAY['chemical peel','skin peel','peel','obagi','zo skin','tca','glycolic','salicylic','mandelic','jessner','blue peel','perfect peel','enzyme peel'], false),
('hydrafacial', 'Hydrafacial', 'facial_device',
 ARRAY['hydrafacial','hydra facial','aquafacial','hydradermabrasion'], false),
('microdermabrasion', 'Microdermabrasion', 'facial_device',
 ARRAY['microdermabrasion','dermabrasion','diamond peel','crystal peel'], false),
('oxygen_facial', 'Oxygen / device facial', 'facial_device',
 ARRAY['oxygen facial','geneo','jet peel','ultrasonic facial','cavitation peel','skin scrubber'], false),
('facial_generic', 'Facial', 'manual_facial',
 ARRAY['facial','facials','deep cleanse','classic facial','express facial','signature facial','extraction','milia','barrier repair','skin health','bespoke facial','teen facial','acne facial'], false),
('dermaplaning_generic', 'Dermaplaning', 'dermaplaning',
 ARRAY['dermaplaning','dermaplane','blade facial'], false),

-- ── Body energy — THE AMBIGUOUS CLASS ───────────────────────────────────────
-- requires_exact_match: these look identical on camera, so the agent is the
-- only separator. Never infer one from a generic name like "Body Contouring".
('radiofrequency_generic', 'Radiofrequency skin tightening', 'radiofrequency',
 ARRAY['rf lifting','rf skin tightening','radiofrequency','thermage','tripollar','venus'], true),
('endymed', 'ENDYMED', 'radiofrequency', ARRAY['endymed'], true),
('exion', 'Exion', 'radiofrequency', ARRAY['exion'], true),
('emsculpt', 'Emsculpt', 'ems_stimulation',
 ARRAY['emsculpt','em sculpt','muscle sculpting','electromagnetic muscle'], true),
('emsella', 'Emsella', 'ems_stimulation',
 ARRAY['emsella','pelvic floor','kegel chair'], true),
('cryolipolysis_generic', 'Cryolipolysis / fat freezing', 'cryolipolysis',
 ARRAY['cryolipolysis','fat freezing','fat freeze','coolsculpting','cryoslimming','kaasen','3d lipo'], true),
('laser_lipo_generic', 'Laser lipolysis', 'laser_lipo',
 ARRAY['laser lipo','emerald laser','invisared','lipo laser'], true),
('endospheres_agent', 'Endospheres', 'endospheres',
 ARRAY['endospheres','endosphere','compressive microvibration'], true),
('cavitation_generic', 'Ultrasonic cavitation', 'cavitation',
 ARRAY['cavitation','ultrasonic cavitation','ultrasound fat'], true),
('hifu_generic', 'HIFU / ultrasound lifting', 'hifu',
 ARRAY['hifu','ultherapy','sofwave','endolift','ultrasound lifting','non surgical facelift','nonsurgical facelift'], false),
('shockwave_generic', 'Shockwave therapy', 'shockwave',
 ARRAY['shockwave','shock wave','acoustic wave'], false),

-- ── Threads ─────────────────────────────────────────────────────────────────
('thread_lift_generic', 'Thread lift', 'thread_lift',
 ARRAY['thread lift','threads','pdo thread','silhouette soft','mono thread','cog thread'], false),

-- ── Brows, lashes, pigment ──────────────────────────────────────────────────
('brow_lamination', 'Brow lamination / tint', 'brow_lash',
 ARRAY['brow lamination','brow tint','brow shape','brow wax','henna brow','hybrid brow','brow sculpt'], false),
('lash_treatment', 'Lash lift / extensions', 'brow_lash',
 ARRAY['lash lift','lash extension','lashes','eyelash','lash tint','russian volume','classic lash','hybrid lash','ldn lash'], false),
('pmu_generic', 'Permanent makeup', 'pmu',
 ARRAY['microblading','powder brow','ombre brow','lip blush','permanent makeup','semi permanent makeup','pmu','phibrows','nano brow','freckle tattoo','smp','scalp micropigmentation'], false),

-- ── Hair removal (non-light) ────────────────────────────────────────────────
('waxing_generic', 'Waxing / threading', 'waxing',
 ARRAY['wax','waxing','sugaring','threading','hollywood','brazilian','bikini'], false),

-- ── Body and wellness ───────────────────────────────────────────────────────
('massage_generic', 'Massage', 'massage',
 ARRAY['massage','swedish','deep tissue','sports massage','aromatherapy','hot stone','indian head','reflexology'], false),
('lymphatic_generic', 'Lymphatic drainage', 'lymphatic_drainage',
 ARRAY['lymphatic','lymph drainage','pressotherapy','compression therapy'], false),
('iv_drip_generic', 'IV drip', 'iv_drip',
 ARRAY['iv drip','iv therapy','vitamin drip','infusion','booster shot','b12','glutathione drip'], false),
('head_spa_generic', 'Head spa', 'head_spa',
 ARRAY['head spa','japanese head spa','scalp treatment','scalp facial'], false),

-- ── Hair, nails, other ──────────────────────────────────────────────────────
('hair_colour_generic', 'Hair colouring', 'hair_colour',
 ARRAY['colour','color','highlights','balayage','tint','root touch','ombre hair','toner','bleach'], false),
('hair_styling_generic', 'Hair styling', 'hair_styling',
 ARRAY['cut','blow dry','blowdry','styling','wash and','hair up','keratin','olaplex','treatment wash'], false),
('nails_generic', 'Nails', 'nails',
 ARRAY['manicure','pedicure','gel polish','shellac','acrylic','builder gel','nail art','biab','infill'], false),
('teeth_whitening_generic', 'Teeth whitening', 'teeth_whitening',
 ARRAY['teeth whitening','tooth whitening','whitening','smile'], false),
('spray_tan_generic', 'Spray tanning', 'spray_tan',
 ARRAY['spray tan','tanning','fake tan','st tropez'], false),

-- ── Fallback ────────────────────────────────────────────────────────────────
-- Exists so a service that is clearly a body-energy treatment but names no
-- modality ("Body Contouring") can still carry a technique. It gates to
-- technique grade only, which is the honest outcome.
('energy_contact_generic', 'Body energy device', 'energy_contact',
 ARRAY['body contouring','body sculpting','body shaping','inch loss','cellulite','skin tightening body','figure correction'], false)

ON CONFLICT (slug) DO NOTHING;
