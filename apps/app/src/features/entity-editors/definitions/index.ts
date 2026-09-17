/**
 * Every entity the unified editor can render.
 *
 * Adding one is a REGISTRATION, not a new page: the route, the chrome, the
 * section nav, the field rendering, the save bar, the scroll behaviour and the
 * mobile layout are all shared and already built. Each module below registers
 * one entity as a side effect; this barrel is imported once by the route host.
 *
 * One file per entity, deliberately — several people (or agents) add entities
 * in parallel, and a single shared file is a guaranteed merge conflict.
 */
import './membership';
import './promotion';
import './service';
import './lead-form';
import './team-member';
import './stock-take';
import './stock-order';
import './product';
import './customer';
import './location';
