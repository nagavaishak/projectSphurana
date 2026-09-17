export {
  GRAPH_ENDPOINTS,
  getEndpointById,
  type GraphEndpoint,
  type GraphHost,
  type GraphMethod,
} from './endpoints.js';

export {
  describeGraphRequest,
  isGraphUrl,
  matchGraphRequest,
  parseGraphUrl,
  type EndpointMatch,
  type ParsedGraphUrl,
} from './match.js';

export {
  buildRecording,
  createRecordingInterceptor,
  type GraphRecording,
  type RecordingOptions,
} from './record.js';

export * as graphSchemas from './schemas.js';

export {
  MAGIC_IDS,
  MetaContractError,
  createMetaFakeInterceptor,
  type MetaFakeOptions,
} from './fake/index.js';

export { REQUEST_SCHEMAS } from './fake/request-schemas.js';

// The fake's object graph. `createRedisFakeStore` is how a multi-process host
// shares it — the preview API runs on two machines, so the default in-memory
// store makes a created campaign invisible to the next request.
// `resetFakeStore` is for a host that installs the fake in-process and wants a
// clean slate between suites (see `meta-campaigns-contract-fake.int-spec.ts`).
export {
  type FakeStoreBackend,
  type FakeStoreRedisLike,
  createRedisFakeStore,
  fakeStoreKey,
  resetFakeStore,
  setFakeStoreBackend,
} from './fake/store.js';

export { installMetaContractInterceptor } from './install.js';

// Test helpers for request-contract suites. Framework-free (no vitest import),
// so they are safe to ship in dist — see the note in testing.ts.
export {
  captureAllRequests,
  captureRequest,
  expectMatchesContract,
  okResponse,
  type CapturedRequest,
} from './testing.js';

export { RESPONSE_SCHEMAS } from './response-schemas.js';
export {
  createValidatingInterceptor,
  getDriftReports,
  resetDriftReports,
  validateResponse,
  type DriftReport,
} from './validate.js';
