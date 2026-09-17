import { check, sleep } from 'k6';
import {
  authGet,
  authPost,
  authPut,
  ensureAuthenticated,
} from '../helpers/auth.js';
import { checkListResponse, checkStatus200 } from '../helpers/checks.js';

/**
 * CRUD operations scenario: exercises the core business logic.
 *
 * Signs in once per VU, then tests listing, creating, and updating
 * leads — the primary entities that hit the most DB queries.
 */
export function crudOperations() {
  // Sign in once per VU
  const jar = ensureAuthenticated();
  if (!jar) return;

  sleep(0.5);

  // 1. List leads
  const listRes = authGet('/leads');
  checkListResponse(listRes, 'list leads');

  sleep(0.5);

  // 2. Create a lead
  const createRes = authPost('/leads', {
    firstName: `LoadTest-${Date.now()}`,
    lastName: 'User',
    email: `loadtest-${Date.now()}@example.com`,
    phone: '+353851234567',
  });

  const created = check(createRes, {
    'create lead: status 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  sleep(0.5);

  // 3. Get the created lead (if creation succeeded)
  if (created && createRes.status < 300) {
    try {
      const lead = JSON.parse(createRes.body);
      const leadId = lead.id || lead.data?.id;

      if (leadId) {
        const getRes = authGet(`/leads/${leadId}`);
        checkStatus200(getRes, 'get lead');

        sleep(0.3);

        // 4. Update the lead
        const updateRes = authPut(`/leads/${leadId}`, {
          firstName: `LoadTest-Updated-${Date.now()}`,
        });

        check(updateRes, {
          'update lead: status 2xx': (r) => r.status >= 200 && r.status < 300,
        });
      }
    } catch {
      // Parse error — skip get/update
    }
  }

  sleep(1);
}
