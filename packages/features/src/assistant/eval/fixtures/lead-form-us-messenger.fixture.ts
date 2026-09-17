import { buildLeadFormCampaignFixture } from './lead-form-campaign.helpers.js';

const { fixture, toolStubs: stubs } = buildLeadFormCampaignFixture({
  id: 'lead-form-us-messenger',
  country: 'US',
  address: '500 W 5th St, Austin, TX, USA',
  channelLabel: 'Messenger',
  channel: 'messenger',
});

export const toolStubs = stubs;
export default fixture;
