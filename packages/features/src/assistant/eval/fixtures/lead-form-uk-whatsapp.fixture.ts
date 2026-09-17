import { buildLeadFormCampaignFixture } from './lead-form-campaign.helpers.js';

const { fixture, toolStubs: stubs } = buildLeadFormCampaignFixture({
  id: 'lead-form-uk-whatsapp',
  country: 'UK',
  address: '24 Bold Street, Liverpool, UK',
  channelLabel: 'WhatsApp',
  channel: 'whatsapp',
});

export const toolStubs = stubs;
export default fixture;
