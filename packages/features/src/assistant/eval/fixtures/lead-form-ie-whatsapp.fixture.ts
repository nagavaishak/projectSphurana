import { buildLeadFormCampaignFixture } from './lead-form-campaign.helpers.js';

const { fixture, toolStubs: stubs } = buildLeadFormCampaignFixture({
  id: 'lead-form-ie-whatsapp',
  country: 'Ireland',
  address: '12 Grafton Street, Dublin 2, Ireland',
  channelLabel: 'WhatsApp',
  channel: 'whatsapp',
});

export const toolStubs = stubs;
export default fixture;
