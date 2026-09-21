import { Router, Request, Response } from 'express';
import { WhatsAppOnboardingService } from './WhatsAppOnboardingService';
import { WhatsAppNumberService } from './WhatsAppNumberService';
import { requireAuth, requireAdmin } from '../../../middleware/authMiddleware';
import { logger } from '../../../utils/logger';

export function createWhatsAppOnboardingRouter(
  onboardingService: WhatsAppOnboardingService,
  numberService: WhatsAppNumberService
): Router {
  const router = Router();

  // 1. Get non-secret Meta App config for Embedded Signup frontend SDK (Public)
  router.get('/config', (_req: Request, res: Response) => {
    res.json({
      appId: process.env.META_APP_ID || '',
      configId: process.env.META_CONFIG_ID || '',
      graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0'
    });
  });

  // Protect all administrative and onboarding mutation routes with authentication
  router.use(requireAuth(), requireAdmin);

  // 2. Generate signed CSRF state token for initiating signup
  router.post('/state', (req: Request, res: Response) => {
    const principalTenantId = (req as any).principal?.tenantId;
    const { tenantId, accountId } = req.body;
    const targetTenantId = principalTenantId || tenantId;

    if (!targetTenantId || !accountId) {
      return res.status(400).json({ error: 'tenantId and accountId are required' });
    }

    const stateToken = onboardingService.generateSignupState(targetTenantId, accountId);
    res.json({ stateToken });
  });

  // 3. Process Embedded Signup OAuth callback
  router.post('/callback', async (req: Request, res: Response) => {
    try {
      const principalTenantId = (req as any).principal?.tenantId;
      const { tenantId, accountId, code, wabaId, phoneNumberId, displayPhoneNumber, stateToken, pin } = req.body;
      const targetTenantId = principalTenantId || tenantId;

      if (!targetTenantId || !accountId || !code || !wabaId || !phoneNumberId || !stateToken) {
        return res.status(400).json({
          error: 'Missing required parameters: tenantId, accountId, code, wabaId, phoneNumberId, stateToken are required'
        });
      }

      const result = await onboardingService.processEmbeddedSignupCallback({
        tenantId: targetTenantId,
        accountId,
        code,
        wabaId,
        phoneNumberId,
        displayPhoneNumber,
        stateToken,
        pin
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.status(200).json(result);
    } catch (err: any) {
      logger.error(`WhatsAppOnboardingRouter: Callback processing error: ${err.message || err}`);
      res.status(500).json({ error: 'Internal server error during onboarding' });
    }
  });

  // 4. List connected WhatsApp numbers for an Account
  router.get('/numbers', async (req: Request, res: Response) => {
    try {
      const principalTenantId = (req as any).principal?.tenantId;
      const tenantId = principalTenantId || String(req.query.tenantId || req.headers['x-tenant-id'] || '');
      const accountId = String(req.query.accountId || '');

      if (!tenantId || !accountId) {
        return res.status(400).json({ error: 'tenantId and accountId are required' });
      }

      const numbers = await numberService.listNumbersByAccount(tenantId, accountId);
      res.json({ numbers });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error listing numbers' });
    }
  });

  // 5. Toggle number enabled/disabled
  router.post('/numbers/:phoneNumberId/toggle', async (req: Request, res: Response) => {
    try {
      const principalTenantId = (req as any).principal?.tenantId;
      const { tenantId, enabled } = req.body;
      const phoneNumberId = String(req.params.phoneNumberId);
      const targetTenantId = principalTenantId || tenantId;

      if (!targetTenantId || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'tenantId and enabled (boolean) are required' });
      }

      const updated = await numberService.setNumberEnabled(targetTenantId, phoneNumberId, enabled);
      res.json({ number: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Error updating number status' });
    }
  });

  // 6. Delete number mapping
  router.delete('/numbers/:phoneNumberId', async (req: Request, res: Response) => {
    try {
      const principalTenantId = (req as any).principal?.tenantId;
      const targetTenantId = principalTenantId || String(req.body.tenantId || req.query.tenantId || req.headers['x-tenant-id'] || '');
      const phoneNumberId = String(req.params.phoneNumberId);

      if (!targetTenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }

      await numberService.deleteNumber(targetTenantId, phoneNumberId);
      res.json({ success: true, deletedPhoneNumberId: phoneNumberId });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Error deleting number' });
    }
  });

  return router;
}
