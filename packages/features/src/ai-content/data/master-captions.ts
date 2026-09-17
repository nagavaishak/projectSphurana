/**
 * Master captions data for treatment-specific ad copy.
 *
 * Each treatment has multiple headline + caption variations for rotation.
 * Captions store only the descriptive text; the credibility line and CTA
 * are assembled at runtime from the org's profile.
 *
 * Source: BOR-19 - Borradh Master Captions Document
 */

export interface CaptionVariation {
  headline: string;
  /** Descriptive body text (without credibility line or CTA) */
  caption: string;
}

export interface TreatmentCaptions {
  treatment: string;
  category: string;
  ctaType: 'consultation' | 'appointment';
  /** Lowercase search terms for fuzzy matching against org service names */
  aliases: string[];
  variations: CaptionVariation[];
}

export const masterCaptions: TreatmentCaptions[] = [
  // =========================================================================
  // INJECTABLES
  // =========================================================================
  {
    treatment: 'Anti-Wrinkle Injections (Botox)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['botox', 'anti-wrinkle', 'anti wrinkle', 'wrinkle injections'],
    variations: [
      {
        headline: 'Reduce fine lines by up to 80% in 2 weeks',
        caption:
          "Anti-wrinkle injections relax the muscles that cause frown lines, crow's feet and forehead creases. Results settle in over 7-14 days and last 3-4 months.",
      },
      {
        headline: 'Smooth forehead lines without looking frozen',
        caption:
          'Anti-wrinkle injections target specific muscles to soften lines while keeping your natural expressions. Quick treatment, no downtime, results within 2 weeks.',
      },
      {
        headline: "Crow's feet visibly reduced after one session",
        caption:
          "A few precise injections around the eyes soften crow's feet and keep you looking refreshed, not overdone. Takes 15 minutes, lasts up to 4 months.",
      },
      {
        headline: 'Look 5 years younger in under 15 minutes',
        caption:
          "Targeted anti-wrinkle injections smooth out the lines that age you most. Forehead, frown and crow's feet treated in one quick appointment. Natural results that let you look like you, just more rested.",
      },
    ],
  },
  {
    treatment: 'Dermal Fillers (Lips)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'lip filler',
      'lip fillers',
      'lip enhancement',
      'lip augmentation',
      'dermal fillers lips',
    ],
    variations: [
      {
        headline: 'Fuller, natural-looking lips in under 30 minutes',
        caption:
          "Lip filler adds volume and shape using hyaluronic acid, your body's own hydrating molecule. Results are instant, swelling settles in 5-7 days, lasts 6-12 months.",
      },
      {
        headline: 'Balanced, symmetrical lips tailored to your face',
        caption:
          'Every lip is different. Dermal filler is placed precisely to enhance your natural shape, add volume where needed and define your lip border. No duck lips, just you but better.',
      },
      {
        headline: 'Restore lost lip volume naturally',
        caption:
          'As we age lips lose volume and definition. Hyaluronic acid filler brings back fullness, smooths fine lines around the mouth and gives a naturally hydrated look that lasts up to a year.',
      },
      {
        headline: 'Subtle lip enhancement that still looks like you',
        caption:
          "Not everyone wants dramatic lips. A small amount of filler can add hydration, smooth lip lines and give a gentle plump that looks completely natural. You'll know the difference even if nobody else can tell.",
      },
    ],
  },
  {
    treatment: 'Dermal Fillers (Cheeks)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['cheek filler', 'cheek fillers', 'dermal fillers cheeks'],
    variations: [
      {
        headline: 'Restore cheek volume and lift your face without surgery',
        caption:
          'Cheek filler replaces lost volume in the mid-face, lifting and contouring your cheekbones. Results are immediate with minimal downtime and last 12-18 months.',
      },
      {
        headline: 'Defined cheekbones in one appointment',
        caption:
          'Strategically placed filler adds structure and lift to the cheeks, reducing the appearance of tiredness and sagging. A 30-minute treatment with results lasting over a year.',
      },
      {
        headline: 'Clients love the natural lift cheek filler gives',
        caption:
          "Volume loss in the cheeks is one of the first signs of ageing. Replacing that volume lifts the whole mid-face, softens nasolabial folds and restores the youthful contour you've been missing.",
      },
    ],
  },
  {
    treatment: 'Dermal Fillers (Jawline)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'jawline filler',
      'jawline fillers',
      'dermal fillers jawline',
      'jaw filler',
    ],
    variations: [
      {
        headline: 'A sharper, more defined jawline without surgery',
        caption:
          'Jawline filler adds structure and definition along the jaw, creating a more contoured profile. Results are immediate and last 12-18 months.',
      },
      {
        headline: 'Sculpt your jawline in under 30 minutes',
        caption:
          'Filler placed along the jaw creates a stronger, more defined profile. Smooths jowls, adds projection and brings balance to the lower face. No surgery, no downtime.',
      },
      {
        headline: "The jawline you've always wanted is one appointment away",
        caption:
          'Whether you want to sharpen a soft jawline or smooth out early jowling, strategically placed filler creates a clean, defined jaw that frames your face beautifully. Results last over a year.',
      },
    ],
  },
  {
    treatment: 'Dermal Fillers (Chin)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['chin filler', 'chin fillers', 'dermal fillers chin'],
    variations: [
      {
        headline: 'A balanced profile starts with the chin',
        caption:
          'Chin filler adds projection and length to bring the face into proportion. It can reduce the appearance of a double chin and create a more defined profile. Quick treatment, lasting 12-18 months.',
      },
      {
        headline: 'Reshape your profile without surgery',
        caption:
          'A weak or recessed chin can throw your whole profile off balance. A small amount of filler adds projection and definition, bringing harmony to your jawline and face shape. Takes 20 minutes.',
      },
    ],
  },
  {
    treatment: 'Dermal Fillers (Tear Trough / Under Eyes)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'tear trough',
      'under eye filler',
      'under-eye filler',
      'dark circles',
      'dermal fillers tear trough',
      'dermal fillers under eyes',
    ],
    variations: [
      {
        headline: 'Reduce dark circles and under-eye hollows instantly',
        caption:
          'Tear trough filler gently fills the hollow under the eyes that causes dark shadows and a tired look. Results are subtle, natural and last up to 12 months.',
      },
      {
        headline: "Look rested without a full night's sleep",
        caption:
          'Under-eye filler smooths the hollow between your lower eyelid and cheek. Reduces dark circles and the tired, sunken look. A delicate treatment with natural-looking results.',
      },
      {
        headline: 'Tired of looking tired?',
        caption:
          "Dark circles and hollow under-eyes can make you look exhausted even when you're not. Tear trough filler corrects this in one gentle treatment. Results are instant and last up to a year.",
      },
    ],
  },
  {
    treatment: 'Dermal Fillers (Nasolabial Folds / Smile Lines)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'nasolabial',
      'smile lines',
      'nasolabial folds',
      'dermal fillers nasolabial',
      'nose to mouth lines',
    ],
    variations: [
      {
        headline: 'Soften deep smile lines in one treatment',
        caption:
          'Filler placed along the nasolabial folds smooths the lines running from your nose to your mouth. Results are immediate, natural and last 9-12 months.',
      },
      {
        headline: 'Those deep lines beside your nose can be softened',
        caption:
          "Nasolabial folds deepen with age as we lose volume in the cheeks. Filler placed precisely along the fold softens them without looking overdone. A quick treatment with results you'll see immediately.",
      },
    ],
  },
  {
    treatment: 'Dermal Fillers (Marionette Lines)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'marionette lines',
      'marionette filler',
      'dermal fillers marionette',
    ],
    variations: [
      {
        headline: 'Lift the corners of your mouth and look refreshed',
        caption:
          'Marionette line filler softens the lines that run from the corners of your mouth to your chin. Reduces the appearance of a downturned mouth and restores a more youthful look.',
      },
      {
        headline: "Stop your face looking sad when you're not",
        caption:
          'Marionette lines pull the corners of your mouth downward and add years to your face. A small amount of filler lifts and softens these lines, giving you a more rested, approachable look.',
      },
    ],
  },
  {
    treatment: 'Profhilo',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['profhilo'],
    variations: [
      {
        headline: 'Visibly firmer, more hydrated skin in 2 sessions',
        caption:
          'Profhilo delivers high-concentration hyaluronic acid deep into the skin to boost hydration, elasticity and firmness. Two sessions, four weeks apart, results last up to 6 months.',
      },
      {
        headline: 'The skin quality treatment everyone is asking about',
        caption:
          "Profhilo isn't a filler. It remodels your skin from within, improving tone, texture and firmness. Five injection points per side, two sessions, and your skin looks like it's been turned back five years.",
      },
      {
        headline: 'Your skin will thank you for this one',
        caption:
          "Profhilo floods the skin with the highest concentration of hyaluronic acid available. It doesn't add volume like filler. It makes your actual skin better. Tighter, dewier, more elastic. Two sessions is all it takes.",
      },
    ],
  },
  {
    treatment: 'Skin Boosters',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'skin boosters',
      'skin booster',
      'seventy hyal',
      'juvederm volite',
      'restylane skinboosters',
    ],
    variations: [
      {
        headline: 'Glowing, hydrated skin that lasts for months',
        caption:
          'Skin boosters deliver micro-doses of hyaluronic acid just below the surface to hydrate, plump and improve skin texture. A course of 3 treatments gives you a lasting glow.',
      },
      {
        headline: 'The glow that comes from properly hydrated skin',
        caption:
          "Skin boosters work from the inside out. Tiny deposits of hyaluronic acid are placed across the face to improve hydration, elasticity and that healthy-looking luminosity you can't get from skincare alone.",
      },
    ],
  },
  {
    treatment: 'Sculptra',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['sculptra'],
    variations: [
      {
        headline: 'Clients see gradual collagen restoration over 3-6 months',
        caption:
          'Sculptra stimulates your own collagen production to restore lost volume naturally. Unlike fillers, results build over time and can last up to 2 years. The most natural-looking rejuvenation available.',
      },
      {
        headline: "Rebuild your skin's own collagen from within",
        caption:
          'Sculptra works differently to fillers. It triggers your body to produce new collagen, restoring volume and firmness gradually. Results improve over months and last up to 2 years.',
      },
      {
        headline: 'The treatment that keeps improving for months',
        caption:
          "Sculptra doesn't just fill. It rebuilds. Your body produces fresh collagen in the weeks and months after treatment, giving you results that look natural because they are natural. Lasts up to 2 years.",
      },
    ],
  },
  {
    treatment: 'Dissolving (Hyaluronidase)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'dissolving',
      'hyaluronidase',
      'filler dissolving',
      'dissolve filler',
    ],
    variations: [
      {
        headline: 'Unhappy with old filler? It can be dissolved',
        caption:
          "Hyaluronidase safely breaks down hyaluronic acid filler that has migrated, overfilled or doesn't look right. Results are visible within 24-48 hours. Start fresh with confidence.",
      },
      {
        headline: "Filler gone wrong? There's a fix",
        caption:
          'If previous filler has migrated, looks uneven or you simply want it gone, dissolving injections break it down safely and quickly. Most clients see full correction within 48 hours.',
      },
    ],
  },
  {
    treatment: 'PRP (Platelet Rich Plasma)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'prp',
      'prp treatment',
      'prp facial',
      'vampire facial',
      'platelet rich plasma',
    ],
    variations: [
      {
        headline: 'Your own blood, your best skin',
        caption:
          'PRP uses growth factors from your own blood to stimulate collagen, improve texture and reduce scarring. A natural treatment with no synthetic products. Results build over 4-6 weeks.',
      },
      {
        headline: "Harness your body's own healing power for better skin",
        caption:
          'A small blood sample is taken, spun to concentrate the growth factors, then injected back into your skin. PRP accelerates repair, boosts collagen and improves skin quality naturally.',
      },
    ],
  },
  {
    treatment: 'Fat Dissolving Injections',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'fat dissolving',
      'fat dissolving injections',
      'aqualyx',
      'lemon bottle',
    ],
    variations: [
      {
        headline: 'Reduce stubborn fat pockets without surgery',
        caption:
          'Fat dissolving injections break down small pockets of fat under the chin, jawline or body. Results develop over 4-6 weeks as your body naturally flushes the fat cells. A course of 2-4 sessions is recommended.',
      },
      {
        headline:
          'Clients see up to a 30% reduction in double chin after a course',
        caption:
          "Fat dissolving targets the stubborn fat under your chin that won't shift with diet or exercise. Non-surgical, minimal downtime, visible results after 2-3 sessions.",
      },
      {
        headline: 'That stubborn pocket of fat can finally go',
        caption:
          "Some fat just won't budge no matter what you do. Fat dissolving injections permanently destroy fat cells in small targeted areas like the chin, jowls and bra line. Your body removes them naturally over the following weeks.",
      },
    ],
  },
  {
    treatment: 'Polynucleotides (PDRN)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['polynucleotides', 'pdrn'],
    variations: [
      {
        headline: 'The next generation of skin rejuvenation is here',
        caption:
          'Polynucleotides are bio-stimulators derived from salmon DNA that promote deep tissue repair, boost collagen and improve skin elasticity. Results build over weeks with long-lasting improvement.',
      },
      {
        headline: 'Repair and regenerate your skin at the deepest level',
        caption:
          "Polynucleotides go beyond hydration. They repair damaged cells, stimulate new tissue growth and improve elasticity from within. The treatment the aesthetics industry can't stop talking about.",
      },
    ],
  },
  {
    treatment: 'Thread Lift',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['thread lift', 'pdo threads', 'threads'],
    variations: [
      {
        headline: 'A visible lift without going under the knife',
        caption:
          'PDO threads are placed under the skin to physically lift and tighten sagging areas of the face and neck. Results are immediate with continued improvement over 3-6 months as collagen builds around the threads.',
      },
      {
        headline: 'Lift sagging skin in one lunch-hour appointment',
        caption:
          'Thread lifts physically reposition sagging tissue and stimulate your body to produce collagen around the threads. The lift you see on the day gets even better over the following months.',
      },
    ],
  },
  {
    treatment: 'Non-Surgical Rhinoplasty',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: [
      'non-surgical rhinoplasty',
      'non surgical rhinoplasty',
      'nose filler',
      'nose reshaping',
    ],
    variations: [
      {
        headline: 'Reshape your nose in 15 minutes without surgery',
        caption:
          'Dermal filler is used to smooth bumps, lift the tip and balance the proportions of your nose. Instant results, no downtime, lasts 12-18 months. A fraction of the cost and risk of surgical rhinoplasty.',
      },
      {
        headline: 'Smooth that bump or lift the tip in one quick treatment',
        caption:
          'A few precisely placed drops of filler can completely change the profile of your nose. Straighten a bump, refine the tip or balance asymmetry. No surgery, no bruising, no recovery time.',
      },
    ],
  },

  // =========================================================================
  // SKIN TREATMENTS
  // =========================================================================
  {
    treatment: 'Chemical Peels',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['chemical peel', 'chemical peels', 'peel', 'skin peel'],
    variations: [
      {
        headline: 'Brighter, clearer skin in one peel',
        caption:
          'Chemical peels remove dead skin cells and stimulate cell turnover to reveal fresher, smoother skin underneath. Targets pigmentation, acne scarring, dullness and fine lines. Downtime varies by peel depth.',
      },
      {
        headline:
          'Clients see up to a 50% improvement in skin texture after a course',
        caption:
          'A course of chemical peels progressively improves tone, texture and clarity. Each peel builds on the last, giving cumulative results that genuinely transform your skin.',
      },
      {
        headline: 'Dull, uneven skin? A peel can change that',
        caption:
          "Chemical peels work by removing the damaged outer layers of skin to reveal the healthier skin beneath. From light lunch-time peels to deeper resurfacing, there's a peel for every skin concern.",
      },
    ],
  },
  {
    treatment: 'Microneedling',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['microneedling', 'micro needling', 'skin needling'],
    variations: [
      {
        headline: 'Reduce acne scars by up to 60% with a course of treatments',
        caption:
          "Microneedling creates thousands of micro-channels in the skin to trigger your body's natural healing response. Boosts collagen, reduces scarring, tightens pores and improves overall texture.",
      },
      {
        headline: 'Smoother, tighter skin starts beneath the surface',
        caption:
          'Tiny needles stimulate your skin to repair and rebuild itself. Effective for fine lines, acne scars, stretch marks and enlarged pores. Results improve over 4-6 weeks after each session.',
      },
      {
        headline: 'The treatment that makes your skin repair itself',
        caption:
          "Microneedling triggers your body's wound healing response without damaging the skin's surface. New collagen and elastin form in the weeks after treatment, giving you progressively better skin.",
      },
    ],
  },
  {
    treatment: 'Morpheus8',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['morpheus8', 'morpheus 8'],
    variations: [
      {
        headline: 'Tighter, firmer skin with up to 40% improvement in laxity',
        caption:
          'Morpheus8 combines microneedling with radiofrequency to remodel collagen deep in the skin. Targets sagging, fine lines and uneven texture on the face and body. Results continue improving for up to 3 months.',
      },
      {
        headline: 'The gold standard for skin tightening without surgery',
        caption:
          'Morpheus8 penetrates up to 4mm deep to tighten and contour from within. Effective on face, neck, jawline and body. Minimal downtime with results that build over weeks.',
      },
      {
        headline: 'Clients are blown away by their Morpheus8 results',
        caption:
          'Radiofrequency energy delivered through microneedles remodels fat and tightens skin at a depth no other non-surgical treatment can reach. Face, neck, stomach and arms. One treatment, months of improvement.',
      },
    ],
  },
  {
    treatment: 'Radiofrequency Skin Tightening',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: [
      'radiofrequency',
      'rf skin tightening',
      'skin tightening',
      'forma',
      'thermage',
      'endymed',
    ],
    variations: [
      {
        headline: 'Firmer, tighter skin without needles or surgery',
        caption:
          'Radiofrequency delivers controlled heat deep into the skin to stimulate collagen and tighten tissue. Comfortable treatment with no downtime. Results improve over a course of sessions.',
      },
      {
        headline: 'Tighten and tone your skin while you relax',
        caption:
          'RF skin tightening feels like a warm massage while it works to firm and lift your skin from within. Collagen production ramps up in the weeks following treatment. No needles, no recovery.',
      },
    ],
  },
  {
    treatment: 'LED Light Therapy',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['led', 'led light therapy', 'led therapy', 'light therapy'],
    variations: [
      {
        headline: 'Calm inflammation and boost skin healing naturally',
        caption:
          'LED light therapy uses specific wavelengths to reduce redness, kill acne-causing bacteria and stimulate collagen. Pain-free, no downtime and suitable for all skin types. Best results from a course of treatments.',
      },
      {
        headline: 'The pain-free treatment your skin has been waiting for',
        caption:
          'Different LED wavelengths target different concerns. Red light boosts collagen. Blue light kills bacteria. Near-infrared reduces inflammation. All of them are completely painless with zero downtime.',
      },
    ],
  },
  {
    treatment: 'HydraFacial',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['hydrafacial', 'hydra facial'],
    variations: [
      {
        headline: 'Clearer, glowing skin in 30 minutes',
        caption:
          'HydraFacial cleanses, extracts and hydrates in one session. Removes impurities, unclogs pores and delivers antioxidants deep into the skin. No downtime, instant glow.',
      },
      {
        headline: 'The facial that actually delivers visible results',
        caption:
          'HydraFacial goes beyond a standard facial. Vortex suction clears out pores while simultaneously infusing skin with serums tailored to your concerns. Walk out glowing, no redness, no peeling.',
      },
      {
        headline:
          'See why HydraFacial is the most requested facial in the world',
        caption:
          'Cleanse, peel, extract, hydrate and protect in one 30-minute treatment. HydraFacial is suitable for all skin types and gives you an immediate glow with no downtime. Perfect before any event.',
      },
    ],
  },
  {
    treatment: 'Dermaplaning',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['dermaplaning'],
    variations: [
      {
        headline: 'Instantly smoother skin and better product absorption',
        caption:
          'Dermaplaning removes dead skin cells and fine vellus hair using a sterile blade. Skin feels silky smooth, makeup applies better and skincare penetrates deeper. Zero downtime.',
      },
      {
        headline: 'The smoothest your skin has ever felt',
        caption:
          'A sterile blade gently removes the top layer of dead skin and peach fuzz in one painless treatment. Your skin is immediately smoother, brighter and ready to absorb your skincare properly.',
      },
    ],
  },
  {
    treatment: 'Mesotherapy (Face)',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['mesotherapy', 'mesotherapy face'],
    variations: [
      {
        headline: 'Deliver vitamins directly where your skin needs them most',
        caption:
          'Mesotherapy injects a cocktail of vitamins, minerals and hyaluronic acid directly into the skin. Targets dullness, dehydration and fine lines. A course of treatments delivers cumulative results.',
      },
      {
        headline: 'Feed your skin from the inside',
        caption:
          "Topical products can only penetrate so deep. Mesotherapy delivers active ingredients directly into the skin where they're needed most. Brighter, more hydrated, more nourished skin after every session.",
      },
    ],
  },
  {
    treatment: 'Oxygen Facial',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['oxygen facial'],
    variations: [
      {
        headline: 'Plump, hydrated skin with zero downtime',
        caption:
          'Oxygen facials deliver pressurised oxygen and nutrient-rich serums into the skin. Instantly plumps, hydrates and brightens. Perfect before an event or as part of a regular skin routine.',
      },
    ],
  },
  {
    treatment: 'Carbon Laser Peel (Hollywood Peel)',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['carbon laser peel', 'hollywood peel', 'carbon peel'],
    variations: [
      {
        headline: 'Tighter pores and brighter skin in one session',
        caption:
          'A carbon layer is applied to the skin then targeted with a laser. It deep cleans pores, reduces oil, evens tone and stimulates collagen. Minimal downtime and visible results from one treatment.',
      },
      {
        headline: 'The red carpet facial that actually works',
        caption:
          'The Hollywood Peel uses laser energy to vaporise a carbon mask from your skin, taking dead cells, oil and impurities with it. Leaves you with tighter pores, brighter skin and a smooth, even tone.',
      },
    ],
  },
  {
    treatment: 'Microdermabrasion',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['microdermabrasion'],
    variations: [
      {
        headline: 'Fresher, smoother skin in 30 minutes',
        caption:
          'Microdermabrasion uses fine crystals to gently exfoliate the outer layer of skin, revealing brighter, smoother skin underneath. Improves tone, texture and mild pigmentation. No downtime.',
      },
    ],
  },
  {
    treatment: 'Medical Grade Facial',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['medical facial', 'medical grade facial', 'clinical facial'],
    variations: [
      {
        headline: "Results a regular facial can't deliver",
        caption:
          'Medical grade facials use clinical-strength products and professional techniques to target specific concerns like ageing, acne, pigmentation and dehydration. Visible results from your first treatment.',
      },
      {
        headline: "This isn't a spa facial",
        caption:
          "Medical grade facials use active ingredients at concentrations you can't buy over the counter. Tailored to your skin concerns and delivered by a trained professional. Real results, not just relaxation.",
      },
    ],
  },
  {
    treatment: 'Acne Treatment Programme',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['acne treatment', 'acne programme', 'acne program'],
    variations: [
      {
        headline: 'Clients see up to 70% reduction in active breakouts',
        caption:
          'A structured acne treatment programme combining clinical-grade peels, LED therapy and medical-grade skincare to clear breakouts and prevent scarring. Tailored to your specific skin type and severity.',
      },
      {
        headline: 'Clear skin is possible, even if nothing else has worked',
        caption:
          "Acne needs a proper plan, not just products. A combination of in-clinic treatments and medical-grade homecare tackles breakouts, reduces inflammation and prevents future scarring. Let's build your plan.",
      },
    ],
  },
  {
    treatment: 'Rosacea Treatment',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['rosacea', 'rosacea treatment'],
    variations: [
      {
        headline: 'Reduce redness and flare-ups by up to 50%',
        caption:
          'Targeted treatments including IPL, LED and medical-grade skincare to calm rosacea, reduce visible redness and strengthen the skin barrier. A structured approach that addresses the root cause.',
      },
      {
        headline: "Rosacea doesn't have to control your skin",
        caption:
          'A combination of in-clinic treatments and the right homecare can dramatically reduce the redness, flushing and sensitivity that comes with rosacea. Most clients see visible improvement within weeks.',
      },
    ],
  },
  {
    treatment: 'Pigmentation Treatment',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: [
      'pigmentation',
      'pigmentation treatment',
      'dark spots',
      'melasma',
      'hyperpigmentation',
    ],
    variations: [
      {
        headline: 'Visibly even out your skin tone',
        caption:
          'Targeted laser, IPL and peel treatments break down excess pigment and prevent new dark spots forming. Effective on sun damage, melasma and post-inflammatory hyperpigmentation. Course recommended.',
      },
      {
        headline: 'Those dark patches can be treated',
        caption:
          "Whether it's sun damage, hormonal pigmentation or post-acne marks, the right combination of treatments can break down excess melanin and give you a more even, clear complexion.",
      },
    ],
  },
  {
    treatment: 'Plasma Pen (Fibroblast)',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['plasma pen', 'fibroblast', 'plasma fibroblast'],
    variations: [
      {
        headline: 'Tighten loose skin without surgery or fillers',
        caption:
          'Plasma pen creates tiny controlled micro-injuries on the skin surface to trigger skin tightening and collagen production. Effective on eyelids, neck, stomach and around the mouth. Results last up to 3 years.',
      },
      {
        headline: 'Lift hooded eyelids without going under the knife',
        caption:
          'Plasma pen is one of the only non-surgical treatments that can tighten the delicate skin around the eyes. Reduces hooding, tightens crepey skin and gives a visible lift that lasts years.',
      },
    ],
  },

  // =========================================================================
  // LASER TREATMENTS
  // =========================================================================
  {
    treatment: 'Laser Hair Removal',
    category: 'Laser Treatments',
    ctaType: 'consultation',
    aliases: ['laser hair removal', 'laser hair'],
    variations: [
      {
        headline: 'Up to 90% permanent hair reduction in 6-8 sessions',
        caption:
          'Laser targets the hair follicle to stop regrowth at the root. Works on face, underarms, legs, bikini and full body. Each session reduces growth by 15-20% until hair is virtually gone.',
      },
      {
        headline: 'Stop shaving, waxing and dealing with ingrown hairs',
        caption:
          'Laser hair removal gives you permanently smooth skin. Fast sessions, minimal discomfort and results that last a lifetime. Most clients see major reduction after 4-6 sessions.',
      },
      {
        headline: 'Imagine never having to shave again',
        caption:
          'Laser hair removal permanently reduces hair growth so you can stop the endless cycle of shaving, waxing and plucking. Quick sessions, suitable for almost all areas and skin types.',
      },
    ],
  },
  {
    treatment: 'IPL (Intense Pulsed Light)',
    category: 'Laser Treatments',
    ctaType: 'consultation',
    aliases: ['ipl', 'ipl treatment', 'intense pulsed light'],
    variations: [
      {
        headline: 'Reduce pigmentation and redness by up to 70%',
        caption:
          'IPL uses light energy to target sun damage, age spots, broken capillaries and rosacea. The light breaks down pigment and stimulates collagen for clearer, more even skin. A course of 3-6 sessions recommended.',
      },
      {
        headline: 'Reverse years of sun damage',
        caption:
          'IPL targets the melanin and haemoglobin that cause dark spots and redness. The treated areas darken, flake off and reveal clearer skin underneath. Each session builds on the last.',
      },
    ],
  },
  {
    treatment: 'Laser Skin Resurfacing',
    category: 'Laser Treatments',
    ctaType: 'consultation',
    aliases: [
      'laser skin resurfacing',
      'fractional co2',
      'fractional laser',
      'erbium laser',
      'co2 laser',
    ],
    variations: [
      {
        headline: 'Dramatically improved skin texture and tone',
        caption:
          'Fractional laser creates micro-injuries in the skin to trigger deep collagen remodelling. Targets deep wrinkles, scarring, pigmentation and sun damage. Downtime of 5-10 days with significant results.',
      },
      {
        headline: 'The most powerful skin resurfacing available',
        caption:
          "Fractional laser treats the deepest wrinkles, worst scarring and most stubborn pigmentation that lighter treatments can't reach. Serious downtime but serious results. One session can be transformative.",
      },
    ],
  },
  {
    treatment: 'Laser Tattoo Removal',
    category: 'Laser Treatments',
    ctaType: 'consultation',
    aliases: ['tattoo removal', 'laser tattoo removal'],
    variations: [
      {
        headline: 'Visible fading from your first session',
        caption:
          'Laser breaks down tattoo ink into particles your body naturally removes. Multiple sessions required depending on size, colour and age of the tattoo. Professional-grade lasers target all ink colours safely.',
      },
      {
        headline: "That tattoo doesn't have to be forever",
        caption:
          'Modern laser technology can break down even stubborn ink colours. Your body naturally flushes the ink particles over the weeks following each session. Most tattoos require 6-12 sessions for full removal.',
      },
    ],
  },
  {
    treatment: 'Laser Vein Removal',
    category: 'Laser Treatments',
    ctaType: 'consultation',
    aliases: [
      'vein removal',
      'thread veins',
      'spider veins',
      'laser vein removal',
    ],
    variations: [
      {
        headline: 'Visibly reduce thread veins in 1-3 sessions',
        caption:
          'Laser targets and collapses visible thread veins on the face and legs. The body naturally absorbs them over the following weeks. Quick treatment with minimal downtime.',
      },
      {
        headline: 'Those visible veins on your face and legs can be treated',
        caption:
          'Thread veins are a common concern that laser can effectively treat. The light energy heats and collapses the vein, and your body absorbs it naturally. Most clients see significant improvement in 1-3 sessions.',
      },
    ],
  },

  // =========================================================================
  // BODY TREATMENTS
  // =========================================================================
  {
    treatment: 'CoolSculpting / Fat Freezing',
    category: 'Body Treatments',
    ctaType: 'consultation',
    aliases: [
      'coolsculpting',
      'fat freezing',
      'cryolipolysis',
      'cool sculpting',
    ],
    variations: [
      {
        headline: 'Reduce stubborn fat by up to 25% per session',
        caption:
          'CoolSculpting freezes and destroys fat cells in targeted areas. Your body naturally eliminates them over 8-12 weeks. No surgery, no needles, no downtime. Treats stomach, flanks, thighs, chin and arms.',
      },
      {
        headline: "Freeze away the fat that won't shift with diet and exercise",
        caption:
          'CoolSculpting targets specific areas of stubborn fat that resist diet and exercise. One session can reduce fat in the treated area by up to 25%. Results develop naturally over 2-3 months.',
      },
      {
        headline: 'Finally target that stubborn area',
        caption:
          "Everyone has that one area that won't budge. CoolSculpting freezes and permanently destroys fat cells without affecting the surrounding tissue. No surgery, no downtime, visible results in weeks.",
      },
    ],
  },
  {
    treatment: 'Body Contouring',
    category: 'Body Treatments',
    ctaType: 'consultation',
    aliases: ['body contouring', 'hifu body', 'cavitation', 'rf body'],
    variations: [
      {
        headline: 'Tighter, more contoured body without surgery',
        caption:
          'Body contouring treatments use ultrasound, radiofrequency or HIFU to tighten skin, reduce fat and sculpt the body. Non-invasive with no downtime. Best results from a course of treatments.',
      },
      {
        headline: 'Sculpt and tighten the areas that bother you most',
        caption:
          'Non-invasive body contouring breaks down fat cells and tightens loose skin using targeted energy. Effective on stomach, arms, thighs and flanks. A course of sessions delivers progressive, natural-looking results.',
      },
    ],
  },
  {
    treatment: 'Cellulite Treatment',
    category: 'Body Treatments',
    ctaType: 'consultation',
    aliases: [
      'cellulite',
      'cellulite treatment',
      'endermologie',
      'acoustic wave',
    ],
    variations: [
      {
        headline: 'Visibly smoother skin in the areas that bother you most',
        caption:
          'Targeted cellulite treatments break down fibrous bands, stimulate circulation and tighten skin. Results build over a course of sessions. Non-invasive with zero downtime.',
      },
    ],
  },
  {
    treatment: 'Lymphatic Drainage / Body Wrap',
    category: 'Body Treatments',
    ctaType: 'consultation',
    aliases: ['lymphatic drainage', 'body wrap'],
    variations: [
      {
        headline: 'Reduce bloating and feel lighter in one session',
        caption:
          "Lymphatic drainage stimulates your body's natural detox system to reduce water retention, puffiness and bloating. Relaxing treatment with visible results from your first session.",
      },
    ],
  },
  {
    treatment: 'Stretch Mark Treatment',
    category: 'Body Treatments',
    ctaType: 'consultation',
    aliases: ['stretch marks', 'stretch mark treatment'],
    variations: [
      {
        headline: 'Up to 60% improvement in stretch marks after a course',
        caption:
          'Microneedling, laser and RF treatments stimulate collagen production in stretch-marked skin, reducing their depth, colour and visibility. Results build progressively over multiple sessions.',
      },
      {
        headline: 'Those stretch marks can be treated',
        caption:
          'Whether from pregnancy, weight change or growth, stretch marks respond well to collagen-stimulating treatments. A course of microneedling or laser can significantly reduce their appearance.',
      },
    ],
  },
  {
    treatment: 'Scar Treatment',
    category: 'Body Treatments',
    ctaType: 'consultation',
    aliases: ['scar treatment', 'scar removal', 'acne scars'],
    variations: [
      {
        headline: 'Reduce the appearance of scars by up to 70%',
        caption:
          'Advanced treatments including microneedling, laser and PRP break down scar tissue and stimulate healthy skin regeneration. Effective on acne scars, surgical scars and injury scars. Course required.',
      },
    ],
  },

  // =========================================================================
  // HAIR TREATMENTS
  // =========================================================================
  {
    treatment: 'Hair Transplant (FUE / FUT)',
    category: 'Hair Treatments',
    ctaType: 'consultation',
    aliases: ['hair transplant', 'fue', 'fut', 'hair restoration'],
    variations: [
      {
        headline: 'Natural, permanent hair restoration',
        caption:
          'FUE hair transplant moves individual follicles from donor areas to where you need them most. Results are permanent, natural-looking and grow like your own hair. Full results visible at 12-18 months.',
      },
      {
        headline: 'Your own hair, growing where you want it',
        caption:
          'Hair transplant takes healthy follicles from the back and sides of your head and places them where thinning has occurred. No plugs, no obvious scarring. Just natural hair growth that lasts a lifetime.',
      },
    ],
  },
  {
    treatment: 'PRP Hair Restoration',
    category: 'Hair Treatments',
    ctaType: 'consultation',
    aliases: ['prp hair', 'prp hair treatment', 'prp hair restoration'],
    variations: [
      {
        headline: 'Clients see up to 30% improvement in hair density',
        caption:
          'PRP uses growth factors from your own blood to stimulate dormant hair follicles and strengthen existing hair. A course of 3-4 sessions, 4 weeks apart, with results building over 3-6 months.',
      },
      {
        headline: "Thicker, stronger hair using your body's own healing power",
        caption:
          'PRP is injected directly into the scalp to stimulate blood supply and hair growth. No chemicals, no drugs, just your own concentrated growth factors. Effective for both men and women.',
      },
    ],
  },
  {
    treatment: 'Scalp Micropigmentation',
    category: 'Hair Treatments',
    ctaType: 'consultation',
    aliases: ['scalp micropigmentation', 'smp'],
    variations: [
      {
        headline: 'The appearance of a full head of hair in 2-3 sessions',
        caption:
          'Scalp micropigmentation deposits tiny pigment dots to replicate the look of hair follicles. Creates the appearance of a full buzz cut or adds density to thinning areas. Immediate results, lasts 3-5 years.',
      },
    ],
  },
  {
    treatment: 'Mesotherapy for Hair',
    category: 'Hair Treatments',
    ctaType: 'consultation',
    aliases: ['mesotherapy hair', 'hair mesotherapy'],
    variations: [
      {
        headline: 'Nourish your scalp and slow hair loss',
        caption:
          'Mesotherapy delivers vitamins, minerals and growth factors directly into the scalp to strengthen follicles and reduce hair fall. A course of treatments improves hair density and quality over time.',
      },
    ],
  },

  // =========================================================================
  // HAIR SALON SERVICES
  // =========================================================================
  {
    treatment: 'Hair Extensions (Tape-In)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['tape-in extensions', 'tape in extensions', 'tape extensions'],
    variations: [
      {
        headline: 'Longer, fuller hair in under 2 hours',
        caption:
          'Tape-in extensions are lightweight, flat and sit flush against your head for the most natural look. Add length, volume or both without damage. Last 6-8 weeks before needing to be moved up.',
      },
      {
        headline: "The extensions that don't look like extensions",
        caption:
          "Tape-in extensions blend seamlessly with your natural hair. Thin wefts lay completely flat so nobody can tell they're there. Quick application, comfortable to wear and easy to maintain.",
      },
    ],
  },
  {
    treatment: 'Hair Extensions (Micro Ring / Nano Ring)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: [
      'micro ring extensions',
      'nano ring extensions',
      'micro ring',
      'nano ring',
    ],
    variations: [
      {
        headline: 'Full, natural-looking length with zero damage',
        caption:
          'Micro ring extensions attach to your natural hair using tiny metal rings. No heat, no glue, no damage. They move naturally with your hair and last 3-4 months with proper maintenance.',
      },
      {
        headline:
          'Add up to 20 inches of length without compromising your hair',
        caption:
          'Nano ring extensions use the smallest possible attachment for a completely invisible bond. Ideal for fine hair or anyone who wants extensions that are truly undetectable. Reusable and long-lasting.',
      },
    ],
  },
  {
    treatment: 'Hair Extensions (Weave / Sew-In)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['weave extensions', 'sew-in extensions', 'sew in'],
    variations: [
      {
        headline: 'Volume and length that lasts for months',
        caption:
          'Sew-in extensions are braided into your natural hair for a secure, long-lasting hold. Perfect for adding serious length and volume. Lasts 6-8 weeks and protects your natural hair underneath.',
      },
    ],
  },
  {
    treatment: 'Hair Extensions (Keratin / Fusion Bonds)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['keratin extensions', 'fusion bonds', 'fusion bond extensions'],
    variations: [
      {
        headline: 'The most long-lasting extensions available',
        caption:
          'Keratin bond extensions are fused to your natural hair for up to 4-5 months of wear. Each strand is individually bonded for natural movement and styling versatility. The gold standard for extensions.',
      },
    ],
  },
  {
    treatment: 'Hair Extensions (Clip-In)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['clip-in extensions', 'clip in extensions', 'clip-ins'],
    variations: [
      {
        headline: 'Instant length and volume for any occasion',
        caption:
          'Clip-in extensions give you the hair you want when you want it. Apply in minutes, remove before bed. No commitment, no damage, no salon visit required. Perfect for events and special occasions.',
      },
    ],
  },
  {
    treatment: 'Hair Colouring (Full Head)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: [
      'hair colouring',
      'hair coloring',
      'full head colour',
      'full head color',
      'hair colour',
      'hair color',
    ],
    variations: [
      {
        headline: 'A complete colour transformation by an expert colourist',
        caption:
          'Full head colour gives you a fresh, even tone from root to tip. Whether you want to go lighter, darker or cover greys, professional application ensures even coverage and healthy-looking results.',
      },
      {
        headline:
          "The colour you've been saving on Pinterest is one appointment away",
        caption:
          "From rich brunettes to bold reds to sun-kissed blondes, a professional colourist ensures you get the exact shade you want without compromising your hair's health.",
      },
    ],
  },
  {
    treatment: 'Hair Colouring (Root Touch-Up)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['root touch-up', 'root touch up', 'roots'],
    variations: [
      {
        headline: 'Keep your colour looking fresh between appointments',
        caption:
          'A root touch-up blends your regrowth seamlessly with the rest of your colour. Quick appointment, no need for a full head. Keeps you looking polished between full colour sessions.',
      },
    ],
  },
  {
    treatment: 'Hair Colouring (Highlights / Lowlights)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['highlights', 'lowlights', 'foils'],
    variations: [
      {
        headline: 'Add depth and dimension to your colour',
        caption:
          "Highlights and lowlights create movement, depth and brightness through your hair. Whether you want subtle sun-kissed pieces or bold contrast, they're customised to your skin tone and style.",
      },
      {
        headline: 'Natural-looking dimension that grows out beautifully',
        caption:
          'Strategically placed highlights and lowlights add life to flat colour. Blended by hand to create a natural, multi-tonal look that gets better as it grows. Less maintenance than a full colour.',
      },
    ],
  },
  {
    treatment: 'Balayage / Ombre',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['balayage', 'ombre'],
    variations: [
      {
        headline: 'The effortlessly blended colour everyone wants',
        caption:
          'Balayage is hand-painted onto the hair for a soft, graduated colour that looks completely natural. Lighter through the mid-lengths and ends with a seamless blend into your root colour. Grows out beautifully.',
      },
      {
        headline: 'Low-maintenance colour that still turns heads',
        caption:
          "Balayage gives you that sun-kissed, lived-in look that doesn't need constant upkeep. No harsh root lines, no obvious regrowth. Just beautifully blended colour tailored to your face and skin tone.",
      },
      {
        headline: 'The colour that looks expensive because it is',
        caption:
          "Balayage is an art. Hand-painted highlights create a bespoke, multi-dimensional finish that flat colour can't match. Every head is different because every application is unique to you.",
      },
    ],
  },
  {
    treatment: 'Colour Correction',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['colour correction', 'color correction'],
    variations: [
      {
        headline: 'Fix your colour, restore your confidence',
        caption:
          'Colour correction repairs damage from box dye disasters, uneven bleaching or previous salon mistakes. It takes time and expertise but the results are worth it. Your hair, back to its best.',
      },
    ],
  },
  {
    treatment: 'Toner / Gloss Treatment',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['toner', 'gloss', 'gloss treatment', 'hair gloss'],
    variations: [
      {
        headline: 'Refresh your colour and boost shine instantly',
        caption:
          'A toner or gloss neutralises brassiness, enhances your colour and adds a glass-like shine. Quick treatment that refreshes your colour between full appointments. Your hair will look like you just left the salon.',
      },
    ],
  },
  {
    treatment: 'Grey Coverage / Grey Blending',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: [
      'grey coverage',
      'grey blending',
      'gray coverage',
      'gray blending',
    ],
    variations: [
      {
        headline: 'Cover your greys or learn to love them',
        caption:
          "Whether you want full grey coverage or a softer grey-blending approach that works with your natural silver, there's a technique for every preference. Professional application ensures a natural, flattering result.",
      },
      {
        headline: 'Seamless grey coverage that looks completely natural',
        caption:
          "Nobody wants their colour to look like they're hiding something. Expert grey coverage blends naturally with your existing colour so your hair looks rich, dimensional and real.",
      },
    ],
  },
  {
    treatment: 'Curls / Perm',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['perm', 'curls', 'perming'],
    variations: [
      {
        headline: 'Beautiful, bouncy curls that last for months',
        caption:
          "Modern perms aren't your grandmother's perm. Today's techniques create soft, natural-looking waves and curls tailored to your hair type and desired look. Wake up with perfect curls every morning.",
      },
      {
        headline: "Volume and texture you don't have to style every day",
        caption:
          'Whether you want loose beachy waves or tighter defined curls, a modern perm gives you lasting texture and body. Low maintenance, long-lasting and completely customisable.',
      },
    ],
  },
  {
    treatment: 'Keratin Treatment / Brazilian Blowout',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: [
      'keratin treatment',
      'brazilian blowout',
      'keratin straightening',
    ],
    variations: [
      {
        headline: 'Smooth, frizz-free hair for up to 12 weeks',
        caption:
          'Keratin treatments coat each strand to eliminate frizz, reduce styling time and add a silky shine. Your hair stays smooth even in humidity. Cut your morning routine in half.',
      },
      {
        headline: 'Wake up to smooth, manageable hair every day',
        caption:
          'A keratin treatment smooths the hair cuticle for weeks of frizz-free, easy-to-manage hair. Reduces blow-dry time dramatically. Works on all hair types including curly and coily.',
      },
    ],
  },
  {
    treatment: 'Hair Straightening',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: [
      'hair straightening',
      'japanese straightening',
      'chemical straightening',
    ],
    variations: [
      {
        headline: 'Permanently straight hair without daily straightening',
        caption:
          'Chemical straightening restructures your hair bonds for permanently smooth, straight results. No more daily heat damage from straighteners. New growth comes in natural so maintenance is needed at the roots.',
      },
    ],
  },
  {
    treatment: 'Olaplex / Bond Repair Treatment',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['olaplex', 'bond repair', 'hair repair'],
    variations: [
      {
        headline: 'Repair damaged hair from the inside out',
        caption:
          'Olaplex rebuilds broken bonds inside your hair caused by colour, heat and chemical damage. Your hair feels stronger, looks healthier and holds colour better after just one treatment.',
      },
      {
        headline: 'The treatment that actually repairs, not just coats',
        caption:
          'Most treatments sit on the surface. Olaplex works inside the hair strand to reconnect the broken disulphide bonds that cause weakness, breakage and dullness. Real repair, not a temporary fix.',
      },
    ],
  },
  {
    treatment: 'Deep Conditioning / Hair Mask Treatment',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['deep conditioning', 'hair mask', 'conditioning treatment'],
    variations: [
      {
        headline: 'Bring dry, damaged hair back to life',
        caption:
          'A professional deep conditioning treatment penetrates deeper than anything you can use at home. Restores moisture, softness and shine to dehydrated, over-processed or heat-damaged hair.',
      },
    ],
  },
  {
    treatment: 'Scalp Treatment',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['scalp treatment'],
    variations: [
      {
        headline: 'Healthy hair starts with a healthy scalp',
        caption:
          'A professional scalp treatment clears buildup, balances oil production and stimulates blood flow to the follicles. Addresses flakiness, dryness, oiliness and thinning. Your hair grows better when your scalp is healthy.',
      },
    ],
  },
  {
    treatment: 'Haircut / Restyle',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['haircut', 'restyle', 'cut and style', 'hair cut'],
    variations: [
      {
        headline: 'A cut that actually suits your face shape',
        caption:
          'The right haircut changes everything. An experienced stylist considers your face shape, hair texture, lifestyle and personal style to give you a cut that looks great and works for your day to day.',
      },
      {
        headline: 'Time for a fresh start',
        caption:
          "Whether it's a trim, a completely new style or a dramatic chop, a great haircut boosts your confidence instantly. Walk in ready for a change, walk out feeling like yourself again.",
      },
    ],
  },
  {
    treatment: 'Blow Dry / Styling',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['blow dry', 'blowdry', 'styling', 'blow-dry'],
    variations: [
      {
        headline: 'Salon-perfect hair for your big day or night out',
        caption:
          "A professional blow dry gives you that bouncy, polished look you can't quite achieve at home. Whether it's sleek and straight, big and voluminous or soft waves, you'll leave looking like a million euro.",
      },
      {
        headline: 'Walk into any event with confidence',
        caption:
          'From bouncy blowouts to sleek updos, professional styling ensures you look your absolute best. Perfect for weddings, nights out, photoshoots or any time you want to feel extra special.',
      },
    ],
  },
  {
    treatment: 'Updo / Bridal Hair',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['updo', 'bridal hair', 'wedding hair'],
    variations: [
      {
        headline: 'The perfect hairstyle for your most important day',
        caption:
          "Bridal hair that stays flawless from the ceremony to the last dance. Whether it's a classic updo, loose romantic curls or a modern half-up style, every detail is considered so you don't have to worry.",
      },
      {
        headline: 'Say yes to hair that makes you feel incredible',
        caption:
          'Your wedding hair should make you feel like the best version of yourself. A consultation and trial ensures every pin, curl and detail is exactly right before the big day.',
      },
    ],
  },
  {
    treatment: "Children's Haircut",
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ["children's haircut", 'kids haircut', 'kids cut'],
    variations: [
      {
        headline: 'Stress-free haircuts the kids actually enjoy',
        caption:
          'A patient, friendly stylist who knows how to work with little ones. Quick, gentle cuts that keep them looking smart without the tears. A relaxed experience for kids and parents alike.',
      },
    ],
  },
  {
    treatment: "Men's Haircut / Barbering",
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ["men's haircut", 'barbering', 'mens haircut', 'barber', 'fade'],
    variations: [
      {
        headline: "A sharp cut from someone who knows what they're doing",
        caption:
          "Precision cuts, clean fades and expert styling from an experienced barber. Whether you want a classic look or something more modern, you'll leave looking sharp and feeling confident.",
      },
      {
        headline: 'The cut that gets you compliments',
        caption:
          "A great barber doesn't just cut hair. They read your face shape, hair texture and style to give you something that actually works. Walk out looking better than the photo you showed them.",
      },
    ],
  },
  {
    treatment: 'Beard Trim / Grooming',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['beard trim', 'beard grooming', 'beard'],
    variations: [
      {
        headline: 'A clean, shaped beard from an expert',
        caption:
          "Professional beard shaping defines your jawline, cleans up the neckline and keeps everything looking intentional. Whether you're growing it out or keeping it tight, proper grooming makes all the difference.",
      },
    ],
  },

  // =========================================================================
  // TEETH / SMILE
  // =========================================================================
  {
    treatment: 'Teeth Whitening',
    category: 'Teeth / Smile',
    ctaType: 'consultation',
    aliases: ['teeth whitening', 'tooth whitening', 'whitening'],
    variations: [
      {
        headline: 'Up to 8 shades whiter in one session',
        caption:
          'Professional teeth whitening delivers dramatically brighter results than any at-home kit. In-clinic treatment takes about an hour with instant results. Safe, effective and long-lasting.',
      },
      {
        headline: 'The quickest way to a brighter smile',
        caption:
          'Professional whitening uses clinical-strength gel that penetrates deeper and works faster than anything over the counter. One session, visible results, and a smile you actually want to show off.',
      },
    ],
  },
  {
    treatment: 'Composite Bonding',
    category: 'Teeth / Smile',
    ctaType: 'consultation',
    aliases: ['composite bonding', 'dental bonding', 'tooth bonding'],
    variations: [
      {
        headline: 'Transform your smile in one appointment',
        caption:
          'Composite bonding reshapes, fills gaps and repairs chips using tooth-coloured resin. No drilling, minimal prep and results in a single visit. A fraction of the cost of veneers.',
      },
    ],
  },
  {
    treatment: 'Veneers',
    category: 'Teeth / Smile',
    ctaType: 'consultation',
    aliases: ['veneers', 'porcelain veneers', 'dental veneers'],
    variations: [
      {
        headline: 'A complete smile transformation in 2 visits',
        caption:
          'Porcelain veneers are custom-made shells bonded to the front of your teeth. They correct colour, shape, alignment and gaps. Natural-looking, stain-resistant and built to last 10-15 years.',
      },
    ],
  },
  {
    treatment: 'Invisalign / Clear Aligners',
    category: 'Teeth / Smile',
    ctaType: 'consultation',
    aliases: [
      'invisalign',
      'clear aligners',
      'aligners',
      'teeth straightening',
    ],
    variations: [
      {
        headline: 'Straighter teeth without metal braces',
        caption:
          'Clear aligners gradually shift your teeth into position using custom-made, virtually invisible trays. Removable for eating and cleaning. Most treatments complete in 6-12 months.',
      },
      {
        headline: "Nobody has to know you're straightening your teeth",
        caption:
          'Clear aligners are virtually invisible and removable. Wear them 22 hours a day and watch your teeth gradually move into place. No metal, no wires, no awkward photos.',
      },
    ],
  },

  // =========================================================================
  // BEAUTY TREATMENTS
  // =========================================================================
  {
    treatment: 'Microblading / Brow Lamination',
    category: 'Beauty',
    ctaType: 'consultation',
    aliases: [
      'microblading',
      'brow lamination',
      'eyebrow',
      'eyebrows',
      'brows',
    ],
    variations: [
      {
        headline: 'Wake up with perfect brows every morning',
        caption:
          'Microblading creates hair-like strokes to fill, shape and define your brows. Results look natural and last 12-18 months. No more pencilling in every day.',
      },
      {
        headline: 'Fuller, more defined brows in one session',
        caption:
          'Brow lamination restructures your brow hairs to create a fuller, more uniform shape. Lasts 6-8 weeks and works on all brow types. The low-maintenance brow solution.',
      },
      {
        headline: 'Brows that frame your face perfectly',
        caption:
          "The right brow shape opens up your eyes and changes your whole face. Whether you want microblading for sparse areas or lamination for a fluffy, brushed-up look, there's a technique for every brow.",
      },
    ],
  },
  {
    treatment: 'Lash Lift / Lash Extensions',
    category: 'Beauty',
    ctaType: 'consultation',
    aliases: ['lash lift', 'lash extensions', 'eyelash extensions', 'lashes'],
    variations: [
      {
        headline: 'Open up your eyes without daily mascara',
        caption:
          'A lash lift curls and lifts your natural lashes for a wide-eyed look that lasts 6-8 weeks. Add a tint for extra definition. Zero maintenance, zero damage.',
      },
      {
        headline: 'Wake up with perfect lashes every single day',
        caption:
          'Lash extensions add length, volume and curl to your natural lashes for a full, defined look without mascara. Customisable from natural to dramatic. Infills every 2-3 weeks to keep them fresh.',
      },
    ],
  },
  {
    treatment: 'Spray Tan',
    category: 'Beauty',
    ctaType: 'appointment',
    aliases: ['spray tan', 'tan', 'fake tan'],
    variations: [
      {
        headline: 'A natural, streak-free glow in minutes',
        caption:
          'Professional spray tan applied to your skin tone for a sun-kissed look without UV damage. Customisable depth from a subtle glow to a deep bronze. Lasts 5-10 days.',
      },
      {
        headline: 'Glow without the sun damage',
        caption:
          'A professional spray tan gives you an even, natural-looking bronze in minutes. No streaks, no orange, just a healthy glow tailored to your skin tone. Perfect before holidays, events or just because.',
      },
    ],
  },
  {
    treatment: 'Waxing',
    category: 'Beauty',
    ctaType: 'appointment',
    aliases: ['waxing', 'wax'],
    variations: [
      {
        headline: 'Smooth skin that lasts up to 4 weeks',
        caption:
          'Professional waxing removes hair from the root for longer-lasting smoothness than shaving. Available for face, body, bikini and Brazilian. Quick, efficient and hygienic.',
      },
    ],
  },
  {
    treatment: 'Nail Services',
    category: 'Beauty',
    ctaType: 'appointment',
    aliases: [
      'nails',
      'gel nails',
      'shellac',
      'acrylic nails',
      'biab',
      'manicure',
      'pedicure',
      'nail services',
    ],
    variations: [
      {
        headline: 'Nails that last without chipping',
        caption:
          'Professional gel, shellac and acrylic nails give you a flawless finish that lasts 2-4 weeks. Choose from classic colours, trendy designs or a natural, clean look. Applied by a trained nail technician.',
      },
      {
        headline: 'Builder gel for stronger, healthier natural nails',
        caption:
          "BIAB (Builder In A Bottle) strengthens and protects your natural nails while giving a beautiful, glossy finish. Adds structure without the bulk of acrylics. Perfect if you're growing your nails out.",
      },
    ],
  },
  {
    treatment: 'Eyelash Tinting / Brow Tinting',
    category: 'Beauty',
    ctaType: 'appointment',
    aliases: ['lash tinting', 'brow tinting', 'eyelash tinting', 'tinting'],
    variations: [
      {
        headline: 'Defined brows and lashes without daily makeup',
        caption:
          'A quick tint adds colour and definition to your lashes and brows. Look polished first thing in the morning without touching a pencil or mascara. Lasts 4-6 weeks.',
      },
    ],
  },

  // =========================================================================
  // WELLNESS / OTHER
  // =========================================================================
  {
    treatment: 'IV Drip Therapy',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['iv drip', 'iv therapy', 'vitamin drip', 'drip therapy'],
    variations: [
      {
        headline: 'Feel the difference within hours, not weeks',
        caption:
          'IV drip therapy delivers vitamins, minerals and hydration directly into your bloodstream for maximum absorption. Targets energy, immunity, recovery, skin health and hangovers. 30-60 minute session.',
      },
      {
        headline: 'Skip the tablets, go straight to results',
        caption:
          'Oral supplements lose up to 80% of their potency through digestion. IV delivers 100% of the vitamins directly into your bloodstream. Feel the energy, hydration and clarity within hours.',
      },
    ],
  },
  {
    treatment: 'Vitamin B12 Injections',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['b12', 'b12 injection', 'vitamin b12', 'vitamin injections'],
    variations: [
      {
        headline: 'Boost your energy levels in one quick injection',
        caption:
          'B12 injections bypass your digestive system and deliver the vitamin directly into your muscle for instant absorption. Targets fatigue, brain fog and low energy. Takes 5 minutes.',
      },
    ],
  },
  {
    treatment: 'Excessive Sweating (Hyperhidrosis Treatment)',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['hyperhidrosis', 'excessive sweating', 'sweating treatment'],
    variations: [
      {
        headline: 'Reduce underarm sweating by up to 80%',
        caption:
          'The same anti-wrinkle injection used on the face is placed into the underarm area to block the nerves that trigger sweating. Results last 4-6 months. Life-changing for anyone who suffers with excessive sweating.',
      },
    ],
  },
  {
    treatment: 'Mole / Skin Tag Removal',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['mole removal', 'skin tag removal', 'skin tag', 'mole'],
    variations: [
      {
        headline: 'Quick, safe removal in one appointment',
        caption:
          'Moles, skin tags and minor blemishes removed quickly by a qualified practitioner. Multiple methods available depending on the type and location. Minimal scarring and fast healing.',
      },
    ],
  },
  {
    treatment: 'HIFU (Face)',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['hifu', 'hifu face', 'high intensity focused ultrasound'],
    variations: [
      {
        headline: 'Lift and tighten without a facelift',
        caption:
          'HIFU delivers focused ultrasound energy deep into the skin to stimulate collagen and lift sagging tissue. Targets brow, jawline, neck and chin. One session with results building over 2-3 months.',
      },
      {
        headline: 'Clients see a visible lift in the jawline and neck',
        caption:
          'High-intensity focused ultrasound reaches depths that creams and facials never will. Tightens loose skin, lifts the face and improves overall firmness. No needles, no surgery, no downtime.',
      },
      {
        headline: 'The non-surgical facelift that actually works',
        caption:
          'HIFU heats deep tissue to trigger a natural tightening and lifting response. One session treats the full face and neck. Results develop over 2-3 months as new collagen forms.',
      },
    ],
  },
  {
    treatment: 'Ear Pinning (Non-Surgical Otoplasty)',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['ear pinning', 'otoplasty', 'ear correction'],
    variations: [
      {
        headline: 'Reshape your ears without surgery',
        caption:
          'Non-surgical ear correction uses a special implant or thread to pin prominent ears closer to the head. Quick procedure, local anaesthetic, immediate results and minimal downtime.',
      },
    ],
  },
  {
    treatment: 'Vaginal Rejuvenation (Non-Surgical)',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['vaginal rejuvenation'],
    variations: [
      {
        headline: 'Restore confidence with a non-invasive treatment',
        caption:
          'Non-surgical vaginal rejuvenation uses laser or radiofrequency to improve tone, elasticity and comfort. Addresses concerns related to ageing, childbirth or hormonal changes. Discreet, comfortable and effective.',
      },
    ],
  },
  {
    treatment: 'Cryotherapy (Localised)',
    category: 'Wellness',
    ctaType: 'consultation',
    aliases: ['cryotherapy', 'localised cryotherapy'],
    variations: [
      {
        headline: 'Reduce inflammation and speed up recovery',
        caption:
          'Localised cryotherapy applies extreme cold to targeted areas to reduce pain, inflammation and swelling. Used for sports recovery, joint pain and skin conditions. Quick sessions with immediate relief.',
      },
    ],
  },

  // =========================================================================
  // GENERIC DERMAL FILLERS (catch-all for unspecified filler type)
  // =========================================================================
  {
    treatment: 'Dermal Fillers (General)',
    category: 'Injectables',
    ctaType: 'consultation',
    aliases: ['dermal filler', 'dermal fillers', 'filler', 'fillers'],
    variations: [
      {
        headline: 'Restore volume and contour naturally',
        caption:
          'Dermal fillers use hyaluronic acid to restore lost volume, smooth lines and enhance facial contours. Results are immediate and last 6-18 months depending on the area treated.',
      },
      {
        headline: 'Natural-looking results in one appointment',
        caption:
          'Precisely placed filler restores what time has taken away. Volume, definition and a refreshed appearance. No surgery, minimal downtime and results that let you look like you, just rejuvenated.',
      },
    ],
  },

  // =========================================================================
  // GENERIC EXTENSIONS (catch-all for unspecified type)
  // =========================================================================
  {
    treatment: 'Hair Extensions (General)',
    category: 'Hair Salon',
    ctaType: 'appointment',
    aliases: ['extensions', 'hair extensions'],
    variations: [
      {
        headline: "The length and volume you've always wanted",
        caption:
          'Professional hair extensions add length, volume or both using a method suited to your hair type and lifestyle. Multiple techniques available. Consultation included to find your perfect match.',
      },
    ],
  },

  // =========================================================================
  // GENERIC FACIAL (catch-all)
  // =========================================================================
  {
    treatment: 'Facial',
    category: 'Skin Treatments',
    ctaType: 'consultation',
    aliases: ['facial'],
    variations: [
      {
        headline: 'Give your skin what it actually needs',
        caption:
          'A professional facial goes beyond what skincare alone can do. Deep cleansing, exfoliation and targeted treatment for your specific skin concerns. Walk out with visibly healthier, glowing skin.',
      },
    ],
  },
];
