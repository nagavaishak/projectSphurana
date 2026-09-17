import { loopsEnv } from '@borradh-workspace/env/loops';
import { logError } from '@borradh-workspace/observability';
import { LoopsClient } from 'loops';
import type {
  LoopsContactProperties,
  SendEventOptions,
  UpdateContactOptions,
} from './loops.types.js';

/** Convert typed properties to the SDK's Record<string, ...> format */
function toContactProps(
  props?: LoopsContactProperties,
  userId?: string
): Record<string, string | number | boolean | null> | undefined {
  if (!props && !userId) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  if (props) Object.assign(out, props);
  if (userId) out.userId = userId;
  return out;
}

export class LoopsService {
  private client: LoopsClient;

  constructor(apiKey?: string) {
    this.client = new LoopsClient(apiKey ?? loopsEnv.LOOPS_API_KEY);
  }

  /**
   * Create or upsert a contact in Loops.
   */
  async createContact(
    email: string,
    properties?: LoopsContactProperties,
    userId?: string
  ): Promise<{ success: boolean; id?: string }> {
    try {
      const result = await this.client.createContact(
        email,
        toContactProps(properties, userId)
      );
      if ('id' in result) {
        return { success: true, id: result.id };
      }
      return { success: false };
    } catch (error) {
      logError('loops.createContact', error, { feature: 'loops' });
      return { success: false };
    }
  }

  /**
   * Update an existing contact (upserts if not found).
   */
  async updateContact(
    options: UpdateContactOptions
  ): Promise<{ success: boolean }> {
    try {
      const result = await this.client.updateContact(
        options.email,
        toContactProps(options.properties, options.userId) ?? {}
      );
      return { success: 'id' in result };
    } catch (error) {
      logError('loops.updateContact', error, { feature: 'loops' });
      return { success: false };
    }
  }

  /**
   * Fire a named event to trigger Loops automations.
   */
  async sendEvent(options: SendEventOptions): Promise<{ success: boolean }> {
    try {
      const result = await this.client.sendEvent({
        ...(options.email ? { email: options.email } : {}),
        ...(options.userId ? { userId: options.userId } : {}),
        eventName: options.eventName,
        contactProperties: toContactProps(options.contactProperties),
        eventProperties: options.eventProperties,
      });
      return { success: 'success' in result && result.success === true };
    } catch (error) {
      logError('loops.sendEvent', error, { feature: 'loops' });
      return { success: false };
    }
  }

  /**
   * Delete a contact from Loops.
   */
  async deleteContact(email: string): Promise<{ success: boolean }> {
    try {
      const result = await this.client.deleteContact({ email });
      return { success: 'success' in result && result.success === true };
    } catch (error) {
      logError('loops.deleteContact', error, { feature: 'loops' });
      return { success: false };
    }
  }
}
