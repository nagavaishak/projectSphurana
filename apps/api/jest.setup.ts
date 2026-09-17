// Skip @t3-oss/env-core validation in the unit suite. Specs mock the services
// that read env, so requiring real values (S3 buckets, LOOPS_API_KEY, etc.)
// only breaks module loading. Every env module already honors this flag — this
// is the Jest equivalent of the VITEST skip the features suite relies on.
process.env.SKIP_ENV_VALIDATION = 'true';
