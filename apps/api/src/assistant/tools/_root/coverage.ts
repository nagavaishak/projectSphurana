import { defineCoverage } from '../coverage.types.js';

/**
 * (ROOT) — 1 endpoint, 0 tools. The area string is the EMPTY STRING, because
 * `AppController` is declared `@Controller()` with no prefix, so its route has
 * no first segment to name it after. The directory is `_root` for the
 * filesystem's sake; the gate keys off the `area` string below, not the folder.
 *
 * Its single route is the API's front door — the thing you get for curling the
 * base URL. It returns a static greeting and nothing else.
 */
export const rootCoverage = defineCoverage('', {
  'GET /': {
    notExposed:
      'The API root, returning a fixed greeting string with no organization scope and no data of any kind. It exists so that hitting the base URL is not a 404; there is nothing in the response for Claire to say to anyone.',
  },
});
