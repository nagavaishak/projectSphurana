-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Put the body-energy modalities under a parent, and add electrolysis
-- ============================================================================
-- 0103 promoted RF, EMS, cryolipolysis, laser lipo, endospheres and cavitation
-- out of `energy_contact` into techniques of their own. That was right for
-- clips — the modalities ARE distinguishable, and lumping them meant an EMS
-- clinic could be shown endospheres.
--
-- But it stranded the vague services. A service named "Body Contouring" — ten
-- of them locally — resolves to no modality, so after the split it could reach
-- only the handful of clips whose modality could not be read, while 18 perfectly
-- good RF/EMS/cryo clips sat unreachable. Ambient reception footage is a worse
-- answer than a handpiece worked over an abdomen, which is what body contouring
-- looks like whichever machine is doing it.
--
-- The hierarchy makes the match asymmetric, which serves both cases honestly:
--
--   "Body Contouring"  -> energy_contact -> matches parent AND all children
--   "Emsculpt"         -> ems_stimulation -> matches ems_stimulation ONLY
--
-- Told only the category, we answer with the category. Told the machine, we
-- respect it. `energy_contact` therefore stops being a sibling fallback and
-- becomes the genuine parent of the class.
--
-- Also adds `electrolysis`. Ten local services sell it and it was resolving to
-- null — not because the name is vague, but because the taxonomy had no slot.
-- It is a fine probe worked hair by hair, nothing like a laser handpiece, so it
-- could not be filed under laser_hair_removal.
-- ============================================================================

UPDATE "technique" SET parent_slug = 'energy_contact'
WHERE slug IN (
  'radiofrequency',
  'ems_stimulation',
  'cryolipolysis',
  'laser_lipo',
  'endospheres',
  'cavitation'
);

-- Reworded: it is no longer only a fallback, it is the class every body-energy
-- modality belongs to. A clip still lands here only when the modality cannot be
-- read, but a SERVICE lands here whenever it names the category.
UPDATE "technique"
SET
  display_name = 'Body contouring (energy device)',
  visual_signature =
    'A handheld head or applicator worked over the body, usually with gel and often beside a console. For a CLIP, choose this only when the modality cannot be determined — prefer a specific modality whenever straps, a vacuum cup, a sphere roller, a light array or ultrasound gel identify one. For a SERVICE, this is the correct answer whenever the name gives only the category ("Body Contouring", "Inch Loss").'
WHERE slug = 'energy_contact';

INSERT INTO "technique" (slug, display_name, visual_signature, is_procedural) VALUES
('electrolysis', 'Electrolysis hair removal',
 'A very fine probe inserted alongside individual hairs, worked one at a time under magnification, with tweezers lifting each treated hair. Slow and hair-by-hair — unlike a laser handpiece, which is pressed and moved in overlapping passes.', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "treatment_agent" (slug, display_name, technique_slug, aliases, requires_exact_match) VALUES
('electrolysis_generic', 'Electrolysis', 'electrolysis',
 ARRAY['electrolysis','galvanic hair','blend method','thermolysis','permanent hair removal probe'], false)
ON CONFLICT (slug) DO NOTHING;
