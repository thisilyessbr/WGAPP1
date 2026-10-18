import { ChatbotDependencies } from '../bootstrap';
import { PortalAuth } from './PortalAuth';
import { PortalBudget } from './PortalBudget';
import { PortalConnections } from './PortalConnections';
import { PortalDocuments } from './PortalDocuments';
import { PortalStore } from './PortalStore';
import { PortalStaffActions } from './PortalStaffActions';
import { OperatorAlerts } from './OperatorAlerts';
import { PortalBroadcasts } from './PortalBroadcasts';
import { WhatsAppOutboundAdapter } from '../domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { PortalDb } from './types';

export class PortalService {
  readonly store: PortalStore;
  readonly auth: PortalAuth;
  readonly budget: PortalBudget;
  readonly staffActions: PortalStaffActions;
  readonly operatorAlerts: OperatorAlerts;
  broadcasts: PortalBroadcasts;
  connections!: PortalConnections;
  documents!: PortalDocuments;
  constructor(db: PortalDb) {
    this.store = new PortalStore(db);
    this.auth = new PortalAuth(this.store, {
      publicUrl: process.env.PORTAL_PUBLIC_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'),
      developmentLinks: process.env.PORTAL_DEV_AUTH_LINKS === 'true'
    });
    this.budget = new PortalBudget(this.store);
    this.staffActions = new PortalStaffActions(this.store);
    this.operatorAlerts = new OperatorAlerts(this.store);
    this.broadcasts = new PortalBroadcasts(this.store);
  }
  attach(deps: ChatbotDependencies) {
    // Template sync (web) and sending (worker) use the same per-number token resolution as replies.
    this.broadcasts = new PortalBroadcasts(this.store, deps.whatsAppOutboundAdapter
      || new WhatsAppOutboundAdapter({ numberService: deps.whatsAppNumberService, secretBox: deps.secretBox }));
    this.connections = new PortalConnections(this.store, deps);
    this.documents = new PortalDocuments(this.store, this.budget, deps.pdfIngestionService, deps.accountConfigService!);
    if (process.env.PORTAL_DOCUMENT_WORKER === 'true' && process.env.NODE_ENV !== 'test') this.documents.start();
  }
  stop() { this.documents?.stop(); this.staffActions.stop(); this.operatorAlerts.stop(); this.broadcasts.stop(); this.budget.dispose(); }
}
