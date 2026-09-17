import { apiEnv } from '@borradh-workspace/env/api';
import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import { logError } from '@borradh-workspace/observability';

/**
 * Twilio SMS provider for campaign sends.
 *
 * Kept separate from the AWS SNS transactional sender (`SNSSMSService`): Twilio
 * gives per-customer local numbers, 10DLC registration, alphanumeric sender IDs
 * and STOP handling — all of which campaigns need. Auth uses an API Key
 * (`SK…` SID + secret) over HTTP Basic; the parent Account SID (`AC…`) is
 * resolved lazily if not supplied.
 *
 * `dryRun` short-circuits every money-spending / outbound call and returns a
 * synthetic id, so the whole campaign pipeline is testable end-to-end without
 * sending a real message or buying a number.
 */

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';
/** Twilio is a synchronous dependency of campaign sends — bound every call. */
const TWILIO_TIMEOUT_MS = 15_000;

const STOP_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
]);
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);

/** Classify an inbound SMS body as an opt-out / opt-in keyword (or neither). */
export function parseSmsKeyword(body: string): 'opt_out' | 'opt_in' | null {
  const word = (body ?? '').trim().toUpperCase().split(/\s+/)[0] ?? '';
  if (STOP_KEYWORDS.has(word)) return 'opt_out';
  if (START_KEYWORDS.has(word)) return 'opt_in';
  return null;
}

export interface TwilioConfig {
  apiSid?: string;
  secret?: string;
  accountSid?: string;
  messagingServiceSid?: string;
  dryRun?: boolean;
}

export interface TwilioSendOptions {
  to: string;
  body: string;
  /** Either an owned number (E.164) or rely on `messagingServiceSid`. */
  from?: string;
  messagingServiceSid?: string;
  /**
   * Public URL Twilio POSTs delivery-state transitions to. Without it a message
   * is only ever observed as `sent` (accepted by Twilio) and never reaches
   * delivered/undelivered/failed — carrier rejections stay invisible.
   */
  statusCallbackUrl?: string;
}

export interface TwilioSendResult {
  messageId: string;
  success: boolean;
  status?: string;
  error?: string;
}

export interface TwilioValidateResult {
  valid: boolean;
  accountSid?: string;
  status?: string;
  friendlyName?: string;
  error?: string;
}

export interface TwilioAvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
}

export interface TwilioProvisionedNumber {
  sid: string;
  phoneNumber: string;
}

export class TwilioSMSService {
  private readonly apiSid: string;
  private readonly secret: string;
  private accountSid?: string;
  private readonly messagingServiceSid?: string;
  readonly dryRun: boolean;

  constructor(config: TwilioConfig = {}) {
    this.apiSid = config.apiSid ?? apiEnv.TWILIO_API_SID ?? '';
    this.secret = config.secret ?? apiEnv.TWILIO_CLIENT_SECRET ?? '';
    this.accountSid = config.accountSid ?? apiEnv.TWILIO_ACCOUNT_SID;
    this.messagingServiceSid =
      config.messagingServiceSid ?? apiEnv.TWILIO_MESSAGING_SERVICE_SID;
    this.dryRun = config.dryRun ?? apiEnv.CAMPAIGNS_DRY_RUN;

    if (!this.dryRun && (!this.apiSid || !this.secret)) {
      throw new Error(
        'Twilio credentials not configured (TWILIO_API_SID / TWILIO_CLIENT_SECRET missing)'
      );
    }
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.apiSid}:${this.secret}`).toString('base64')}`;
  }

  private async request<T = Record<string, unknown>>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string | undefined>
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { Authorization: this.authHeader() },
    };
    if (method === 'POST' && form) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) {
        if (v !== undefined) body.set(k, v);
      }
      init.body = body;
      (init.headers as Record<string, string>)['Content-Type'] =
        'application/x-www-form-urlencoded';
    }
    // GETs are safe to retry; POSTs are not — a retried send could dispatch the
    // same SMS twice, which costs money and looks like a bug to the recipient.
    // Both get a hard timeout so a hung Twilio call can't pin the request.
    const res =
      method === 'GET'
        ? await fetchWithRetry(`${TWILIO_BASE}${path}`, {
            ...init,
            timeoutMs: TWILIO_TIMEOUT_MS,
          })
        : await fetchWithTimeout(`${TWILIO_BASE}${path}`, {
            ...init,
            timeoutMs: TWILIO_TIMEOUT_MS,
          });

    // Read the body as text FIRST. Parsing straight to JSON meant a proxy's
    // HTML error page (a 502 between us and Twilio) threw
    // `Unexpected token '<'` instead of the actual status — the real failure
    // was invisible in the error.
    const bodyText = await res.text();
    let json: (T & { message?: string; code?: number }) | undefined;
    try {
      json = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      throw new Error(
        `Twilio ${method} ${path} failed (${res.status}): ${
          json?.message ?? (bodyText.slice(0, 200) || 'unknown error')
        }`
      );
    }
    if (json === undefined) {
      throw new Error(
        `Twilio ${method} ${path} returned a non-JSON body (${res.status}): ${bodyText.slice(0, 200)}`
      );
    }
    return json;
  }

  /** The parent Account SID (`AC…`), resolved from the API key if not set. */
  async resolveAccountSid(): Promise<string> {
    if (this.accountSid) return this.accountSid;
    const data = await this.request<{ accounts?: Array<{ sid: string }> }>(
      'GET',
      '/Accounts.json'
    );
    this.accountSid = data.accounts?.[0]?.sid;
    return this.accountSid ?? '';
  }

  /** Read-only credential check (no side effects, no cost). */
  async validateCredentials(): Promise<TwilioValidateResult> {
    try {
      const data = await this.request<{
        accounts?: Array<{
          sid: string;
          status: string;
          friendly_name: string;
        }>;
      }>('GET', '/Accounts.json');
      const acct = data.accounts?.[0];
      if (!acct)
        return { valid: false, error: 'No account found for credentials' };
      this.accountSid ??= acct.sid;
      return {
        valid: true,
        accountSid: acct.sid,
        status: acct.status,
        friendlyName: acct.friendly_name,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    }
  }

  /** Read-only search for purchasable local numbers (no cost). */
  async listAvailableNumbers(
    country: string,
    opts: { areaCode?: string; limit?: number } = {}
  ): Promise<TwilioAvailableNumber[]> {
    const accountSid = await this.resolveAccountSid();
    const params = new URLSearchParams({
      SmsEnabled: 'true',
      PageSize: String(opts.limit ?? 5),
    });
    if (opts.areaCode) params.set('AreaCode', opts.areaCode);
    const data = await this.request<{
      available_phone_numbers?: Array<{
        phone_number: string;
        friendly_name: string;
        locality?: string;
        region?: string;
      }>;
    }>(
      'GET',
      `/Accounts/${accountSid}/AvailablePhoneNumbers/${country}/Local.json?${params}`
    );
    return (data.available_phone_numbers ?? []).map((n) => ({
      phoneNumber: n.phone_number,
      friendlyName: n.friendly_name,
      locality: n.locality,
      region: n.region,
    }));
  }

  /** List numbers this account already owns (no cost). */
  async listOwnedNumbers(): Promise<TwilioProvisionedNumber[]> {
    const accountSid = await this.resolveAccountSid();
    const data = await this.request<{
      incoming_phone_numbers?: Array<{ sid: string; phone_number: string }>;
    }>('GET', `/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=50`);
    return (data.incoming_phone_numbers ?? []).map((n) => ({
      sid: n.sid,
      phoneNumber: n.phone_number,
    }));
  }

  /**
   * Purchase a number. COSTS MONEY — callers must gate this behind explicit
   * user confirmation. `dryRun` returns a synthetic SID.
   */
  async provisionNumber(opts: {
    phoneNumber: string;
    friendlyName?: string;
    smsWebhookUrl?: string;
  }): Promise<TwilioProvisionedNumber> {
    if (this.dryRun) {
      return { sid: `PNdryrun${Date.now()}`, phoneNumber: opts.phoneNumber };
    }
    const accountSid = await this.resolveAccountSid();
    const data = await this.request<{ sid: string; phone_number: string }>(
      'POST',
      `/Accounts/${accountSid}/IncomingPhoneNumbers.json`,
      {
        PhoneNumber: opts.phoneNumber,
        FriendlyName: opts.friendlyName,
        SmsUrl: opts.smsWebhookUrl,
      }
    );
    return { sid: data.sid, phoneNumber: data.phone_number };
  }

  /**
   * Send one SMS. COSTS MONEY (and texts a real handset). `dryRun` returns a
   * synthetic message id without calling Twilio.
   */
  async sendSMS(opts: TwilioSendOptions): Promise<TwilioSendResult> {
    if (this.dryRun) {
      return {
        messageId: `SMdryrun${Date.now()}${Math.round(performance.now())}`,
        success: true,
        status: 'dry_run',
      };
    }
    try {
      const accountSid = await this.resolveAccountSid();
      const from = opts.from;
      const messagingServiceSid =
        opts.messagingServiceSid ?? this.messagingServiceSid;
      if (!from && !messagingServiceSid) {
        return {
          messageId: '',
          success: false,
          error: 'No `from` number or messagingServiceSid configured',
        };
      }
      const data = await this.request<{ sid: string; status: string }>(
        'POST',
        `/Accounts/${accountSid}/Messages.json`,
        {
          To: opts.to,
          Body: opts.body,
          From: from,
          MessagingServiceSid: from ? undefined : messagingServiceSid,
          StatusCallback: opts.statusCallbackUrl,
        }
      );
      return { messageId: data.sid, success: true, status: data.status };
    } catch (error) {
      logError('twilio.sendSMS', error, { feature: 'sms' });
      return {
        messageId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Send failed',
      };
    }
  }
}
