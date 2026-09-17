import { notionEnv } from '@borradh-workspace/env/notion';
import { logError } from '@borradh-workspace/observability';
import { Client } from '@notionhq/client';
import type {
  CreateContactOptions,
  UpdateContactOptions,
  UpsertContactOptions,
} from './notion-crm.types.js';

function nextCheckIn(days = 14): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export class NotionCrmService {
  private client: Client;
  private crmDbId: string;

  constructor(apiKey?: string, crmDbId?: string) {
    const key = apiKey ?? notionEnv.NOTION_API_KEY;
    const db = crmDbId ?? notionEnv.NOTION_CRM_DB_ID;

    if (!key || !db) {
      throw new Error(
        'Notion CRM not configured — missing NOTION_API_KEY or NOTION_CRM_DB_ID'
      );
    }

    this.client = new Client({ auth: key });
    this.crmDbId = db;
  }

  /**
   * Find a contact page by email. Returns the page ID or null.
   */
  async findByEmail(email: string): Promise<string | null> {
    try {
      const res = await this.client.databases.query({
        database_id: this.crmDbId,
        filter: { property: 'Email', email: { equals: email } },
        page_size: 1,
      });
      return res.results[0]?.id ?? null;
    } catch (error) {
      logError('notion.findByEmail', error, {
        feature: 'notion',
        extra: { email },
      });
      return null;
    }
  }

  /**
   * Create a contact row in the CRM database.
   */
  async createContact(
    options: CreateContactOptions
  ): Promise<{ success: boolean; pageId?: string }> {
    try {
      const properties: Record<string, unknown> = {
        Name: { title: [{ text: { content: options.name } }] },
        Email: { email: options.email },
        Stage: { select: { name: options.stage ?? 'New' } },
        'Next Check-In': { date: { start: nextCheckIn() } },
      };

      if (options.businessName) {
        properties['Business Name'] = {
          rich_text: [{ text: { content: options.businessName } }],
        };
      }

      if (options.businessType) {
        properties['Business Type'] = {
          rich_text: [{ text: { content: options.businessType } }],
        };
      }

      if (options.notes) {
        properties.Notes = {
          rich_text: [
            { text: { content: `[${timestamp()}] ${options.notes}` } },
          ],
        };
      }

      const page = await this.client.pages.create({
        parent: { database_id: this.crmDbId },
        properties: properties as Parameters<
          typeof this.client.pages.create
        >[0]['properties'],
      });

      return { success: true, pageId: page.id };
    } catch (error) {
      logError('notion.createContact', error, {
        feature: 'notion',
        extra: { email: options.email },
      });
      return { success: false };
    }
  }

  /**
   * Update a contact row found by email.
   */
  async updateContact(
    options: UpdateContactOptions
  ): Promise<{ success: boolean }> {
    try {
      const pageId = await this.findByEmail(options.email);
      if (!pageId) return { success: false };

      const properties: Record<string, unknown> = {};

      if (options.stage) {
        properties.Stage = { select: { name: options.stage } };
      }

      if (options.businessName) {
        properties['Business Name'] = {
          rich_text: [{ text: { content: options.businessName } }],
        };
      }

      if (options.businessType) {
        properties['Business Type'] = {
          rich_text: [{ text: { content: options.businessType } }],
        };
      }

      if (options.notes) {
        properties.Notes = {
          rich_text: [
            { text: { content: `[${timestamp()}] ${options.notes}` } },
          ],
        };
      }

      await this.client.pages.update({
        page_id: pageId,
        properties: properties as Parameters<
          typeof this.client.pages.update
        >[0]['properties'],
      });

      return { success: true };
    } catch (error) {
      logError('notion.updateContact', error, {
        feature: 'notion',
        extra: { email: options.email },
      });
      return { success: false };
    }
  }

  /**
   * Upsert: find by email → update if exists, create if not.
   */
  async upsertContact(
    options: UpsertContactOptions
  ): Promise<{ success: boolean; pageId?: string }> {
    try {
      const existingId = await this.findByEmail(options.email);

      if (existingId) {
        const result = await this.updateContact(options);
        return { ...result, pageId: existingId };
      }

      // Create requires a name — fall back to email prefix
      return await this.createContact({
        ...options,
        name: options.name ?? options.email.split('@')[0],
      });
    } catch (error) {
      logError('notion.upsertContact', error, {
        feature: 'notion',
        extra: { email: options.email },
      });
      return { success: false };
    }
  }
}
