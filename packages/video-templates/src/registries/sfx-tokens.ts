import { z } from 'zod';

// SFX token registry (§9). The library has no decided home yet (see punch
// list P2.13). For wave 1 we accept any non-empty string so templates can be
// authored against placeholder names; once the library lands we swap to a
// closed enum like the other registries.
export type SfxToken = string;

// TODO(wave-3): replace with z.enum([...SFX_TOKENS]) once the SFX library
// ships and we have curated names to validate against.
export const sfxRef = z.string().min(1);
