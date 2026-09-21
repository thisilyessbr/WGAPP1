import { OutcomeEvent } from '@prisma/client';

/**
 * OutcomePublisher establishes a clean, decoupled boundary for future external CRM
 * and integration connectors (HubSpot, Zoho, Odoo, Pipedrive, Salesforce).
 */
export interface OutcomePublisher {
  publish(event: OutcomeEvent): Promise<void>;
}

export class NoOpOutcomePublisher implements OutcomePublisher {
  async publish(_event: OutcomeEvent): Promise<void> {
    // Default no-op implementation; no external CRM dependency.
  }
}
