import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { WhatsAppNumberService } from '../whatsapp/WhatsAppNumberService';
import { ClientSafetyGuard } from './ClientSafetyGuard';
import { SecretBox } from '../../../core/security/SecretBox';
import { logger } from '../../../utils/logger';
import { requirePlatformAdmin, requireAuth, requireAdmin } from '../../../middleware/authMiddleware';
import { QrSessionManager } from '../routing/QrSessionManager';

export function createChannelManagementRouter(
  prisma: PrismaClient,
  numberService: WhatsAppNumberService,
  safetyGuard: ClientSafetyGuard,
  secretBox?: SecretBox,
  qrSessionManager?: QrSessionManager
): Router {
  const router = Router();
  router.use((req, res, next) => {
    const owned = /^\/(channel-connections|channels)(\/|$)/.test(req.path)
      || /^\/whatsapp\/numbers\/[^/]+\/(pause|resume)\/?$/.test(req.path)
      || /^\/conversations\/[^/]+\/(human-takeover|resume-bot)\/?$/.test(req.path)
      || /^\/tenants\/[^/]+\/pause-automation\/?$/.test(req.path);
    if (!owned) return next('router');
    requireAuth({ allowUiQueryToken: true })(req, res, () => requireAdmin(req, res, next));
  });
  const encKey = process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || (process.env.NODE_ENV === 'test' ? 'test-encryption-key-32-bytes-long!' : '');
  const box = secretBox || (encKey ? new SecretBox({ key: encKey }) : (null as any));

  function resolveTenantId(req: Request): string {
    const principal = (req as any).principal || (req as any).user;
    if (principal && principal.tenantId) {
      if (principal.platformAdmin === true) {
        const override = (req.headers['x-tenant-id'] as string) || req.body?.tenantId || (req.query?.tenantId as string);
        if (override && typeof override === 'string' && override.trim()) {
          return override.trim();
        }
      }
      return principal.tenantId;
    }

    const tenantId = req.headers['x-tenant-id'] || req.body?.tenantId || req.query?.tenantId;
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new Error('Tenant context is required');
    }
    return (tenantId as string).trim();
  }

  // --- Channel Connections Management ---

  router.post('/channel-connections/qr', async (req: Request, res: Response) => {
    try {
      if (!qrSessionManager) return res.status(503).json({ error: 'QR session manager is unavailable' });
      const tenantId = resolveTenantId(req);
      const { accountId, label } = req.body;
      if (!accountId) return res.status(400).json({ error: 'accountId is required' });
      const result = await qrSessionManager.createConnection(tenantId, String(accountId), label);
      await safetyGuard.recordAuditEvent({
        tenantId,
        accountId: String(accountId),
        connectionId: result.connection.id,
        phoneNumberId: result.phoneNumberId,
        actorId: (req as any).principal?.id,
        action: 'QR_CONNECTION_CREATED'
      });
      return res.status(201).json({
        connection: { ...result.connection, encryptedCredentials: undefined },
        phoneNumberId: result.phoneNumberId
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || String(err) });
    }
  });

  router.get('/channel-connections/:id/qr', async (req: Request, res: Response) => {
    try {
      if (!qrSessionManager) return res.status(503).json({ error: 'QR session manager is unavailable' });
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);
      const connection = await numberService.getConnection(id, tenantId);
      if (!connection || connection.provider !== 'QR_WEB') return res.status(404).json({ error: 'QR connection not found' });
      const qr = qrSessionManager.getQr(id);
      if (!qr) return res.status(404).json({ error: 'QR code is not currently available; retry shortly' });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(qr);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || String(err) });
    }
  });

  // 1. Create or register Meta Channel Connection
  router.post('/channel-connections/meta', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const { accountId, accessToken, appId, wabaId } = req.body;

      if (!accountId || !accessToken) {
        return res.status(400).json({ error: 'accountId and accessToken are required' });
      }

      const encryptedCredentials = box.encryptJson({ accessToken: accessToken.trim() });

      const connection = await numberService.createOrUpdateConnection({
        tenantId,
        accountId: accountId.trim(),
        provider: 'META_CLOUD',
        // A manually supplied token has not yet completed a Meta health check.
        // Embedded Signup is the only route that may mark a connection CONNECTED.
        status: 'PENDING',
        enabled: false,
        encryptedCredentials,
        appId: appId?.trim() || null,
        wabaId: wabaId?.trim() || null,
        lastConnectedAt: null
      });

      await safetyGuard.recordAuditEvent({
        tenantId,
        accountId,
        connectionId: connection.id,
        action: 'CHANNEL_CONNECTION_CREATED',
        metadata: { provider: 'META_CLOUD', wabaId }
      });

      const { encryptedCredentials: _, ...sanitized } = connection;
      return res.status(201).json({ connection: sanitized });
    } catch (err: any) {
      logger.error(`ChannelManagementRouter: Error creating connection: ${err.message}`);
      return res.status(400).json({ error: err.message });
    }
  });

  // 2. List connections for tenant
  router.get('/channel-connections', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const accountId = req.query.accountId as string | undefined;

      const connections = await numberService.listConnections(tenantId, accountId);
      const sanitized = connections.map(({ encryptedCredentials: _, ...c }) => c);

      return res.json({ connections: sanitized });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // 3. Get single connection
  router.get('/channel-connections/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);

      const connection = await numberService.getConnection(id, tenantId);
      if (!connection) {
        return res.status(404).json({ error: 'Channel connection not found' });
      }

      const { encryptedCredentials: _, ...sanitized } = connection;
      return res.json({ connection: sanitized });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // 4. Update connection status
  router.patch('/channel-connections/:id/status', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);
      const { status, error } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'status is required' });
      }

      const allowedManualStatuses = new Set(['PENDING', 'SUSPENDED', 'DISCONNECTED', 'FAILED']);
      if (!allowedManualStatuses.has(String(status))) {
        return res.status(400).json({
          error: 'Invalid manual status. A connection can become CONNECTED only after provider verification.'
        });
      }

      const updated = await numberService.updateConnectionStatus(id, tenantId, status, error);

      await safetyGuard.recordAuditEvent({
        tenantId,
        connectionId: id,
        action: `CONNECTION_STATUS_${status}`,
        metadata: { status }
      });

      const { encryptedCredentials: _, ...sanitized } = updated;
      return res.json({ connection: sanitized });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // 5. Delete connection
  router.delete('/channel-connections/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);

      const conn = await numberService.getConnection(id, tenantId);
      if (!conn) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      if (conn.provider === 'QR_WEB' && qrSessionManager) {
        await qrSessionManager.disconnect(conn);
      } else {
        await numberService.disconnectConnection(id, tenantId);
      }

      await safetyGuard.recordAuditEvent({
        tenantId,
        connectionId: id,
        action: 'CHANNEL_CONNECTION_DISCONNECTED'
      });

      return res.json({ success: true, disconnectedConnectionId: id });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // --- Number Kill Switches ---

  // 6. Pause Number
  router.post('/whatsapp/numbers/:id/pause', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);

      await safetyGuard.pauseNumber(tenantId, id, (req as any).user?.id);
      return res.json({ success: true, phoneNumberId: id, status: 'PAUSED' });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // 7. Resume Number
  router.post('/whatsapp/numbers/:id/resume', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);

      await safetyGuard.resumeNumber(tenantId, id, (req as any).user?.id);
      return res.json({ success: true, phoneNumberId: id, status: 'CONNECTED' });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // --- Human Takeover Controls ---

  // 8. Human Takeover (Pause Bot)
  router.post('/conversations/:id/human-takeover', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);

      await safetyGuard.setHumanTakeover(tenantId, id, true, (req as any).user?.id);
      return res.json({ success: true, conversationId: id, humanTakeover: true, botEnabled: false });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // 9. Resume Bot
  router.post('/conversations/:id/resume-bot', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = String(req.params.id);

      await safetyGuard.setHumanTakeover(tenantId, id, false, (req as any).user?.id);
      return res.json({ success: true, conversationId: id, humanTakeover: false, botEnabled: true });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // --- Tenant-Wide Automation Kill Switch ---

  // 10. Pause/Resume Tenant Automation
  router.post('/tenants/:id/pause-automation', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      if (tenantId !== id) {
        return res.status(403).json({ error: 'Cannot pause automation for a different tenant' });
      }

      const { paused = true, reason } = req.body;
      await safetyGuard.setTenantAutomationPaused(id, Boolean(paused), reason, (req as any).user?.id);

      return res.json({ success: true, tenantId: id, automationPaused: Boolean(paused) });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // --- Emergency QR Stop ---
  router.post('/channel-connections/qr/emergency-stop', requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const { stopped = true } = req.body;
      const tenantId = (req as any).principal?.tenantId || req.body?.tenantId;
      await safetyGuard.setEmergencyQrStop(Boolean(stopped), tenantId);
      if (qrSessionManager) {
        if (Boolean(stopped)) await qrSessionManager.suspendAll();
        else await qrSessionManager.restoreEnabledSessions();
      }
      return res.json({ success: true, emergencyQrStopped: Boolean(stopped) });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // --- Phase 4: Non-Technical Admin Dashboard API ---
  router.get('/channels/dashboard', async (req: Request, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);

      const numbers = await prisma.whatsAppBusinessNumber.findMany({
        where: { tenantId },
        include: {
          account: { select: { id: true, name: true } },
          connection: {
            select: {
              id: true,
              provider: true,
              status: true,
              lastConnectedAt: true,
              lastError: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      const oneHourAgo = new Date(Date.now() - 3600_000);

      // Compute dashboard metrics per number
      const dashboardItems = await Promise.all(
        numbers.map(async (n) => {
          const recentMessageCount = await prisma.whatsAppMessageJob.count({
            where: {
              phoneNumberId: n.phoneNumberId,
              createdAt: { gte: oneHourAgo }
            }
          });

          const humanTakeoverCount = await prisma.conversationAutomationState.count({
            where: {
              tenantId,
              accountId: n.accountId,
              humanTakeover: true
            }
          });

          const isQr = n.transport === 'QR_WEB' || n.connection?.provider === 'QR_WEB';
          const lastError = n.connection?.lastError || null;
          const sanitizedError = lastError ? (safetyGuard.sanitizeMetadata({ err: lastError }).err as string) : null;

          return {
            id: n.id,
            phoneNumberId: n.phoneNumberId,
            displayPhoneNumber: n.displayPhoneNumber || n.phoneNumberId,
            clientName: n.account.name,
            accountId: n.accountId,
            transport: n.transport,
            transportBadge: isQr ? 'Temporary QR' : 'Official Meta',
            badgeClass: isQr ? 'warning' : 'success',
            warning: isQr ? 'غير رسمي وغير مضمون - مسار مؤقت واستثنائي' : null,
            status: n.status,
            enabled: n.enabled,
            connectionId: n.connectionId,
            lastConnection: n.connection?.lastConnectedAt || n.updatedAt,
            lastErrorSanitized: sanitizedError,
            messageRatePerHour: recentMessageCount,
            humanTakeoverActive: humanTakeoverCount > 0
          };
        })
      );

      const tenantConfig = await prisma.tenantConfig.findUnique({ where: { tenantId } });
      const accounts = await prisma.account.findMany({
        where: { tenantId, enabled: true },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' }
      });
      const tenantAutomationPaused = Boolean(
        tenantConfig?.config &&
        typeof tenantConfig.config === 'object' &&
        !Array.isArray(tenantConfig.config) &&
        (tenantConfig.config as Record<string, unknown>).automationPaused === true
      );

      return res.json({
        tenantId,
        tenantAutomationPaused,
        qrFeatureEnabled: qrSessionManager?.isEnabled() === true,
        accounts,
        totalNumbers: numbers.length,
        items: dashboardItems
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  function escapeHtml(str: any): string {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Phase 4: Non-Technical Admin UI Web Page ---
  router.get('/channels/ui', (req: Request, res: Response) => {
    const rawTenantId = (req as any).principal?.tenantId || (req.query.tenantId as string) || 'default-tenant';
    const safeTenantDisplay = escapeHtml(rawTenantId);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>لوحة إدارة قنوات WhatsApp — Relayqo</title>
  <style>
    :root {
      --primary: #0f172a;
      --accent: #2563eb;
      --success: #16a34a;
      --warning: #d97706;
      --danger: #dc2626;
      --bg: #f8fafc;
      --card: #ffffff;
      --border: #e2e8f0;
      --text: #1e293b;
      --muted: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; direction: rtl; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .title { font-size: 1.5rem; font-weight: 700; }
    .tenant-badge { background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 9999px; font-size: 0.85rem; font-weight: 600; }
    .controls-bar { display: flex; gap: 12px; margin-bottom: 20px; align-items: center; }
    .btn { padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; border: none; font-size: 0.875rem; transition: all 0.2s; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-warning { background: var(--warning); color: #fff; }
    .btn-secondary { background: #e2e8f0; color: var(--text); }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; text-align: right; }
    th { background: #f1f5f9; padding: 12px 16px; font-size: 0.85rem; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--border); }
    td { padding: 14px 16px; border-bottom: 1px solid var(--border); font-size: 0.9rem; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .badge { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
    .badge-success { background: #dcfce7; color: var(--success); }
    .badge-warning { background: #fef3c7; color: var(--warning); }
    .badge-danger { background: #fee2e2; color: var(--danger); }
    .badge-status { text-transform: uppercase; }
    .warning-banner { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; margin-top: 4px; display: inline-block; }
    .actions { display: flex; gap: 6px; }
    .actions button { padding: 6px 12px; font-size: 0.8rem; }
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 100; }
    .modal { background: #fff; border-radius: 8px; max-width: 440px; width: 90%; padding: 24px; text-align: center; }
    .modal-actions { display: flex; justify-content: center; gap: 12px; margin-top: 20px; }
    .field { text-align: right; margin-top: 14px; }
    .field label { display: block; margin-bottom: 6px; font-size: .85rem; font-weight: 700; }
    .field select, .field input { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
    .qr-box { display: none; margin-top: 18px; }
    .qr-box img { width: 280px; max-width: 100%; border: 1px solid var(--border); border-radius: 8px; }
    .status-message { min-height: 20px; margin-top: 10px; color: var(--muted); font-size: .85rem; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="title">لوحة إدارة قنوات WhatsApp (Client Channels)</h1>
      <p style="color: var(--muted); font-size: 0.9rem; margin-top: 4px;">مراقبة حالة الأرقام، عزل العملاء، والتحكم الفوري (Kill Switch)</p>
    </div>
    <div class="tenant-badge" id="tenantBadge">المستأجر: ${safeTenantDisplay}</div>
  </div>

  <div class="controls-bar">
    <button class="btn btn-secondary" onclick="loadDashboard()">تحديث البيانات</button>
    <button class="btn btn-warning" onclick="toggleTenantAutomation()">إيقاف/تشغيل الأتمتة للعميل بالكامل</button>
    <button class="btn btn-primary" id="addQrBtn" onclick="openQrModal()" hidden>ربط رقم عبر QR</button>
    <div style="margin-right: auto; display: flex; gap: 8px; align-items: center;">
      <span class="badge badge-success">Official Meta (رسمي)</span>
      <span class="badge badge-warning">Temporary QR (استثنائي مؤقت)</span>
    </div>
  </div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th>العميل (Client)</th>
          <th>رقم WhatsApp</th>
          <th>نوع المسار (Transport)</th>
          <th>الحالة (Status)</th>
          <th>آخر اتصال</th>
          <th>معدل الرسائل (ساعة)</th>
          <th>Human Takeover</th>
          <th>الإجراءات والتحكم</th>
        </tr>
      </thead>
      <tbody id="channelsBody">
        <tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--muted);">جارٍ تحميل البيانات...</td></tr>
      </tbody>
    </table>
  </div>

  <div class="modal-overlay" id="confirmModal">
    <div class="modal">
      <h3 style="margin-bottom: 12px;" id="modalTitle">تأكيد الإجراء</h3>
      <p id="modalMessage" style="color: var(--muted); font-size: 0.9rem;">هل أنت متأكد من تنفيذ هذا الإجراء؟</p>
      <div class="modal-actions">
        <button class="btn btn-danger" id="modalConfirmBtn">تأكيد</button>
        <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="qrModal">
    <div class="modal">
      <h3 style="margin-bottom: 8px;">ربط رقم WhatsApp مؤقتاً عبر QR</h3>
      <p style="color: var(--warning); font-size: .85rem;">هذا مسار غير رسمي ومؤقت. استخدم Meta Cloud API متى توفرت أوراق العميل.</p>
      <div class="field">
        <label for="qrAccount">الحساب التجاري</label>
        <select id="qrAccount"></select>
      </div>
      <div class="field">
        <label for="qrLabel">اسم الرقم لتمييزه</label>
        <input id="qrLabel" maxlength="80" placeholder="مثال: مبيعات 1">
      </div>
      <div class="status-message" id="qrStatus"></div>
      <div class="qr-box" id="qrBox">
        <img id="qrImage" alt="رمز QR لربط WhatsApp">
        <p style="margin-top: 8px; color: var(--muted); font-size: .82rem;">افتح WhatsApp ← الأجهزة المرتبطة ← ربط جهاز، ثم امسح الرمز.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="createQrBtn" onclick="createQrConnection()">إنشاء رمز QR</button>
        <button class="btn btn-secondary" onclick="closeQrModal()">إغلاق</button>
      </div>
    </div>
  </div>

  <script id="tenant-config-data" type="application/json">${JSON.stringify({ tenantId: rawTenantId }).replace(/</g, '\\u003c')}</script>
  <script>
    const { tenantId } = JSON.parse(document.getElementById('tenant-config-data').textContent || '{}');
    let tenantAutomationPaused = false;
    let dashboardAccounts = [];
    let qrPollTimer = null;

    async function loadDashboard() {
      try {
        const res = await fetch('/api/v1/channels/dashboard', {
          credentials: 'same-origin',
          headers: { 'x-tenant-id': tenantId }
        });
        const data = await res.json();
        tenantAutomationPaused = data.tenantAutomationPaused === true;
        dashboardAccounts = Array.isArray(data.accounts) ? data.accounts : [];
        const addQrBtn = document.getElementById('addQrBtn');
        addQrBtn.hidden = data.qrFeatureEnabled !== true;
        renderTable(data.items || []);
      } catch (err) {
        const tbody = document.getElementById('channelsBody');
        tbody.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.style.cssText = 'text-align:center;color:red;';
        td.textContent = 'فشل جلب البيانات';
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
    }

    function renderTable(items) {
      const tbody = document.getElementById('channelsBody');
      tbody.innerHTML = '';

      if (!items || items.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.style.cssText = 'text-align:center;padding:24px;color:var(--muted);';
        td.textContent = 'لا توجد أرقام مربوطة حالياً لهذا العميل';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      for (const item of items) {
        const tr = document.createElement('tr');

        // Client name
        const tdClient = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = item.clientName || '';
        tdClient.appendChild(strong);
        tr.appendChild(tdClient);

        // Display phone & phone id
        const tdPhone = document.createElement('td');
        tdPhone.appendChild(document.createTextNode(item.displayPhoneNumber || ''));
        tdPhone.appendChild(document.createElement('br'));
        const small = document.createElement('small');
        small.style.color = 'var(--muted)';
        small.textContent = item.phoneNumberId || '';
        tdPhone.appendChild(small);
        tr.appendChild(tdPhone);

        // Transport
        const tdTransport = document.createElement('td');
        const spanTransport = document.createElement('span');
        spanTransport.className = 'badge badge-' + (item.badgeClass || 'secondary');
        spanTransport.textContent = item.transportBadge || '';
        tdTransport.appendChild(spanTransport);
        if (item.warning) {
          const warnDiv = document.createElement('div');
          warnDiv.className = 'warning-banner';
          warnDiv.textContent = '⚠️ ' + item.warning;
          tdTransport.appendChild(warnDiv);
        }
        tr.appendChild(tdTransport);

        // Status
        const tdStatus = document.createElement('td');
        const spanStatus = document.createElement('span');
        spanStatus.className = 'badge badge-' + (item.status === 'CONNECTED' ? 'success' : 'danger') + ' badge-status';
        spanStatus.textContent = item.status || '';
        tdStatus.appendChild(spanStatus);
        tr.appendChild(tdStatus);

        // Last connection
        const tdConn = document.createElement('td');
        tdConn.textContent = item.lastConnection ? new Date(item.lastConnection).toLocaleString('ar-EG') : '—';
        tr.appendChild(tdConn);

        // Message rate
        const tdRate = document.createElement('td');
        tdRate.textContent = (item.messageRatePerHour || '0') + ' رسالة';
        tr.appendChild(tdRate);

        // Human takeover
        const tdTakeover = document.createElement('td');
        const spanTakeover = document.createElement('span');
        spanTakeover.className = 'badge ' + (item.humanTakeoverActive ? 'badge-warning' : 'badge-success');
        spanTakeover.textContent = item.humanTakeoverActive ? 'نشط (الموظف يستلم)' : 'البوت يرد';
        tdTakeover.appendChild(spanTakeover);
        tr.appendChild(tdTakeover);

        // Actions
        const tdActions = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'actions';

        const isPaused = item.status === 'PAUSED' || !item.enabled;
        const pauseResumeBtn = document.createElement('button');
        pauseResumeBtn.className = 'btn ' + (isPaused ? 'btn-primary' : 'btn-warning');
        pauseResumeBtn.textContent = isPaused ? 'استئناف' : 'إيقاف مؤقت';
        pauseResumeBtn.addEventListener('click', () => {
          if (isPaused) {
            resumeNumber(item.phoneNumberId);
          } else {
            pauseNumber(item.phoneNumberId);
          }
        });
        actionsDiv.appendChild(pauseResumeBtn);

        if (item.connectionId) {
          const disconnectBtn = document.createElement('button');
          disconnectBtn.className = 'btn btn-danger';
          disconnectBtn.textContent = 'فصل القناة';
          disconnectBtn.addEventListener('click', () => {
            confirmDisconnect(item.connectionId);
          });
          actionsDiv.appendChild(disconnectBtn);
        }

        tdActions.appendChild(actionsDiv);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      }
    }

    async function pauseNumber(id) {
      await fetch('/api/v1/whatsapp/numbers/' + id + '/pause', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-tenant-id': tenantId }
      });
      loadDashboard();
    }

    async function resumeNumber(id) {
      await fetch('/api/v1/whatsapp/numbers/' + id + '/resume', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-tenant-id': tenantId }
      });
      loadDashboard();
    }

    let pendingDisconnectId = null;
    function confirmDisconnect(connId) {
      pendingDisconnectId = connId;
      document.getElementById('modalTitle').innerText = 'تأكيد فصل القناة';
      document.getElementById('modalMessage').innerText = 'هل أنت متأكد من فصل هذه القناة؟ سيتوقف استقبال وإرسال الرسائل عبرها.';
      document.getElementById('modalConfirmBtn').onclick = executeDisconnect;
      document.getElementById('confirmModal').style.display = 'flex';
    }

    async function executeDisconnect() {
      if (!pendingDisconnectId) return;
      await fetch('/api/v1/channel-connections/' + pendingDisconnectId, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-tenant-id': tenantId }
      });
      closeModal();
      loadDashboard();
    }

    function closeModal() {
      document.getElementById('confirmModal').style.display = 'none';
      pendingDisconnectId = null;
    }

    function openQrModal() {
      const select = document.getElementById('qrAccount');
      select.innerHTML = '';
      for (const account of dashboardAccounts) {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = account.name;
        select.appendChild(option);
      }
      document.getElementById('qrStatus').textContent = dashboardAccounts.length ? '' : 'لا يوجد حساب تجاري متاح لهذا العميل.';
      document.getElementById('createQrBtn').disabled = dashboardAccounts.length === 0;
      document.getElementById('qrBox').style.display = 'none';
      document.getElementById('qrModal').style.display = 'flex';
    }

    function closeQrModal() {
      if (qrPollTimer) clearTimeout(qrPollTimer);
      qrPollTimer = null;
      document.getElementById('qrModal').style.display = 'none';
    }

    async function createQrConnection() {
      const accountId = document.getElementById('qrAccount').value;
      const label = document.getElementById('qrLabel').value.trim();
      const status = document.getElementById('qrStatus');
      const button = document.getElementById('createQrBtn');
      if (!accountId) return;
      button.disabled = true;
      status.textContent = 'جارٍ إنشاء جلسة آمنة...';
      try {
        const response = await fetch('/api/v1/channel-connections/qr', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-tenant-id': tenantId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, label })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر إنشاء الاتصال');
        pollForQr(data.connection.id, 0);
      } catch (error) {
        status.textContent = error.message || 'تعذر إنشاء الاتصال';
        button.disabled = false;
      }
    }

    async function pollForQr(connectionId, attempt) {
      const status = document.getElementById('qrStatus');
      try {
        const response = await fetch('/api/v1/channel-connections/' + encodeURIComponent(connectionId) + '/qr', {
          credentials: 'same-origin',
          headers: { 'x-tenant-id': tenantId }
        });
        if (response.ok) {
          const data = await response.json();
          document.getElementById('qrImage').src = data.dataUrl;
          document.getElementById('qrBox').style.display = 'block';
          status.textContent = 'الرمز جاهز للمسح. ينتهي خلال دقيقة.';
          document.getElementById('createQrBtn').disabled = false;
          return;
        }
      } catch (_) {}
      if (attempt >= 20) {
        status.textContent = 'لم يظهر الرمز. أغلق النافذة وحاول مرة أخرى.';
        document.getElementById('createQrBtn').disabled = false;
        return;
      }
      status.textContent = 'جارٍ انتظار رمز QR...';
      qrPollTimer = setTimeout(function () { pollForQr(connectionId, attempt + 1); }, 1000);
    }

    async function toggleTenantAutomation() {
      const confirmAction = confirm('هل تريد تبديل حالة الأتمتة لجميع أرقام هذا العميل؟');
      if (!confirmAction) return;
      await fetch('/api/v1/tenants/' + tenantId + '/pause-automation', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-tenant-id': tenantId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !tenantAutomationPaused, reason: 'Manual toggle from admin UI' })
      });
      alert('تم تحديث حالة الأتمتة.');
      loadDashboard();
    }

    loadDashboard();
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  });

  return router;
}
