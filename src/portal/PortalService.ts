import { ChatbotDependencies } from '../bootstrap';
import { PortalAuth } from './PortalAuth';
import { PortalBudget } from './PortalBudget';
import { PortalConnections } from './PortalConnections';
import { PortalDocuments } from './PortalDocuments';
import { PortalStore } from './PortalStore';
import { PortalDb } from './types';

export class PortalService {
  readonly store: PortalStore;
  readonly auth: PortalAuth;
  readonly budget: PortalBudget;
  connections!: PortalConnections;
  documents!: PortalDocuments;
  constructor(db: PortalDb) {
    this.store = new PortalStore(db);
    this.auth = new PortalAuth(this.store, {
      publicUrl: process.env.PORTAL_PUBLIC_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'),
      developmentLinks: process.env.PORTAL_DEV_AUTH_LINKS === 'true'
    });
    this.budget = new PortalBudget(this.store);
  }
  attach(deps: ChatbotDependencies) {
    this.connections = new PortalConnections(this.store, deps);
    this.documents = new PortalDocuments(this.store, this.budget, deps.pdfIngestionService, deps.accountConfigService!);
    if (process.env.PORTAL_DOCUMENT_WORKER === 'true' && process.env.NODE_ENV !== 'test') this.documents.start();
  }
  stop() { this.documents?.stop(); this.budget.dispose(); }
}
