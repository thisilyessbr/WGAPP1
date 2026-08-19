export function getAdminUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Monitoring Dashboard</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface-hover: #1a2744;
      --border: #334155;
      --border-light: #475569;
      --text: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --primary-bg: rgba(59,130,246,0.12);
      --success: #22c55e;
      --success-bg: rgba(34,197,94,0.12);
      --success-border: rgba(34,197,94,0.35);
      --danger: #ef4444;
      --danger-bg: rgba(239,68,68,0.12);
      --danger-border: rgba(239,68,68,0.35);
      --warning: #f59e0b;
      --warning-bg: rgba(245,158,11,0.12);
      --warning-border: rgba(245,158,11,0.35);
      --neutral: #94a3b8;
      --neutral-bg: rgba(148,163,184,0.12);
      --neutral-border: rgba(148,163,184,0.35);
      --radius: 10px;
      --radius-sm: 6px;
      --shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;}

    /* Shell */
    .app-shell{display:flex;flex-direction:column;min-height:100vh;}

    /* Top Bar */
    .top-bar{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;height:52px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
    .top-bar-left{display:flex;align-items:center;gap:12px;}
    .top-bar-left h1{font-size:15px;font-weight:600;}
    .top-bar-tenant{font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;}
    .top-bar-tenant .dot{width:7px;height:7px;border-radius:50%;background:var(--success);display:inline-block;}
    .top-bar-right{display:flex;align-items:center;gap:8px;}
    .top-bar-right .btn{font-size:12px;padding:5px 12px;}

    /* Body */
    .app-body{display:flex;flex:1;}

    /* Sidebar */
    .sidebar{width:200px;background:var(--surface);border-right:1px solid var(--border);padding:12px 0;flex-shrink:0;display:flex;flex-direction:column;}
    .nav-section{padding:10px 14px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);}
    .nav-item{display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:13px;font-weight:500;color:var(--text-secondary);cursor:pointer;border-left:3px solid transparent;transition:all 0.12s;user-select:none;}
    .nav-item:hover{background:var(--primary-bg);color:var(--text);}
    .nav-item.active{background:var(--primary-bg);color:var(--primary);border-left-color:var(--primary);font-weight:600;}
    .nav-icon{font-size:15px;width:18px;text-align:center;flex-shrink:0;}
    .nav-badge{margin-left:auto;background:var(--danger-bg);color:var(--danger);border:1px solid var(--danger-border);font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center;}

    /* Main */
    .main-content{flex:1;padding:20px 28px;max-width:920px;overflow-y:auto;}

    /* Shared */
    .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:14px;box-shadow:var(--shadow);}
    .card-sm{padding:12px 14px;}
    .badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.02em;white-space:nowrap;}
    .badge-success{background:var(--success-bg);color:var(--success);border:1px solid var(--success-border);}
    .badge-danger{background:var(--danger-bg);color:var(--danger);border:1px solid var(--danger-border);}
    .badge-warning{background:var(--warning-bg);color:var(--warning);border:1px solid var(--warning-border);}
    .badge-neutral{background:var(--neutral-bg);color:var(--neutral);border:1px solid var(--neutral-border);}
    .badge-info{background:var(--primary-bg);color:var(--primary);border:1px solid rgba(59,130,246,0.35);}
    .badge-stage{background:#334155;color:#cbd5e1;font-size:10px;}

    .btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:var(--radius-sm);font-size:13px;font-weight:500;cursor:pointer;border:none;transition:all 0.12s;white-space:nowrap;text-decoration:none;}
    .btn-primary{background:var(--primary);color:#fff;}
    .btn-primary:hover{background:var(--primary-hover);}
    .btn-ghost{background:transparent;color:var(--primary);border:1px solid var(--border);}
    .btn-ghost:hover{background:var(--primary-bg);border-color:var(--primary);}
    .btn-sm{padding:4px 10px;font-size:12px;}
    .btn-danger-ghost{background:transparent;color:var(--danger);border:1px solid var(--border);}
    .btn-danger-ghost:hover{background:var(--danger-bg);border-color:var(--danger);}

    input[type="password"],input[type="text"],select{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:var(--radius-sm);font-size:13px;outline:none;transition:border-color 0.12s;}
    input:focus,select:focus{border-color:var(--primary);}

    .window-note{font-size:11px;color:var(--text-muted);font-weight:400;}

    /* KPIs */
    .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px;}
    .kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow);}
    .kpi-card .kpi-icon{font-size:20px;margin-bottom:2px;}
    .kpi-card .kpi-value{font-size:26px;font-weight:700;line-height:1.1;}
    .kpi-card .kpi-label{font-size:13px;font-weight:500;color:var(--text-secondary);}
    .kpi-card .kpi-detail{font-size:11px;color:var(--text-muted);margin-top:2px;}

    /* Health */
    .health-banner{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:var(--radius);margin-bottom:18px;font-weight:500;}
    .health-banner .h-icon{font-size:24px;flex-shrink:0;}
    .health-banner .h-text{font-size:14px;}
    .health-banner .h-sub{font-size:12px;color:var(--text-muted);font-weight:400;margin-top:2px;}
    .hb-good{background:var(--success-bg);border:1px solid var(--success-border);}
    .hb-warn{background:var(--warning-bg);border:1px solid var(--warning-border);}
    .hb-bad{background:var(--danger-bg);border:1px solid var(--danger-border);}
    .hb-none{background:var(--neutral-bg);border:1px solid var(--neutral-border);}

    /* Problem cards */
    .prob-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:12px;box-shadow:var(--shadow);transition:border-color 0.12s;}
    .prob-card:hover{border-color:var(--border-light);}
    .prob-hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:10px;}
    .prob-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;}
    .prob-time{font-size:11px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;}
    .prob-body{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;font-size:13px;color:var(--text-secondary);margin-bottom:10px;}
    .prob-field label{display:block;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:1px;}
    .prob-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding-top:8px;}
    .prob-conv{font-size:11px;color:var(--text-muted);}

    /* Conversation Cards / Rows */
    .conv-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;margin-bottom:10px;transition:border-color 0.12s;box-shadow:var(--shadow);display:flex;align-items:center;gap:14px;}
    .conv-card:hover{border-color:var(--border-light);}
    .conv-avatar{font-size:20px;width:32px;height:32px;border-radius:50%;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .conv-main{flex:1;min-width:0;}
    .conv-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;margin-bottom:2px;}
    .conv-meta{font-size:12px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
    .conv-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;}
    .conv-time{font-size:11px;color:var(--text-muted);white-space:nowrap;}

    /* Turn rows (in Overview) */
    .turn-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;transition:border-color 0.12s;box-shadow:var(--shadow);}
    .turn-row:hover{border-color:var(--border-light);}
    .turn-icon{font-size:18px;flex-shrink:0;width:24px;text-align:center;}
    .turn-info{flex:1;min-width:0;}
    .turn-label{font-size:13px;font-weight:500;margin-bottom:1px;}
    .turn-sub{font-size:11px;color:var(--text-muted);}
    .turn-sub .trunc{color:var(--warning);font-weight:600;}
    .turn-time{font-size:11px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;text-align:right;}

    /* Filter bar */
    .filter-bar{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;}
    .filter-bar select, .filter-bar input{font-size:12px;padding:5px 8px;}
    .filter-bar .flabel{font-size:11px;color:var(--text-muted);font-weight:600;}

    /* Conversation Detail Page (Transcript) */
    .transcript-box{display:flex;flex-direction:column;gap:16px;margin-top:16px;}
    .turn-bubble-group{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow);}
    .turn-bubble-hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid var(--border);}
    .turn-bubble-title{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;}
    
    .chat-bubble{padding:10px 14px;border-radius:8px;margin-bottom:8px;font-size:13px;line-height:1.4;}
    .chat-bubble-customer{background:#172554;border:1px solid rgba(59,130,246,0.3);margin-right:40px;}
    .chat-bubble-assistant{background:#1e293b;border:1px solid var(--border);margin-left:40px;}
    .chat-role{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;display:flex;justify-content:space-between;}
    .chat-role-customer{color:#93c5fd;}
    .chat-role-assistant{color:var(--success);}
    .chat-text{color:var(--text-secondary);}

    .turn-diag-box{background:rgba(15,23,42,0.6);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-top:10px;font-size:12px;}
    .turn-diag-row{margin-bottom:4px;}
    .turn-diag-row label{font-weight:600;color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-right:6px;}
    .turn-footer{display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);}

    /* Empty */
    .empty-box{text-align:center;padding:36px 16px;color:var(--text-muted);}
    .empty-box .e-icon{font-size:32px;margin-bottom:10px;}
    .empty-box .e-title{font-size:14px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;}
    .empty-box .e-desc{font-size:12px;max-width:360px;margin:0 auto;}

    /* Page headers */
    .pg-hdr{margin-bottom:16px;}
    .pg-hdr h2{font-size:17px;font-weight:600;margin-bottom:2px;}
    .pg-hdr .pg-sub{font-size:12px;color:var(--text-muted);}

    /* Detail overlay */
    .detail-overlay{display:none;}
    .detail-overlay.visible{display:block;}
    .back-link{color:var(--primary);cursor:pointer;font-size:13px;margin-bottom:14px;display:inline-flex;align-items:center;gap:4px;}
    .back-link:hover{text-decoration:underline;}

    .diag-card{background:#162032;border:1px solid #3b82f6;border-radius:var(--radius);padding:14px;margin-bottom:16px;}
    .diag-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
    .diag-title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:6px;}
    .diag-summary{background:rgba(59,130,246,0.08);border-left:3px solid var(--primary);padding:8px 12px;margin-top:8px;border-radius:0 5px 5px 0;font-size:13px;color:#cbd5e1;}
    .diag-action{margin-top:6px;padding:6px 10px;background:rgba(245,158,11,0.08);border-left:3px solid var(--warning);border-radius:0 4px 4px 0;font-size:12px;color:var(--text-secondary);}
    .diag-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:12px;margin-top:8px;}

    .timeline{position:relative;margin-top:16px;padding-left:26px;}
    .timeline::before{content:"";position:absolute;left:7px;top:7px;bottom:7px;width:2px;background:var(--border);}
    .tl-item{position:relative;margin-bottom:16px;background:#182234;border:1px solid var(--border);border-radius:6px;padding:12px;}
    .tl-dot{position:absolute;left:-24px;top:14px;width:12px;height:12px;border-radius:50%;background:var(--border);border:2px solid var(--bg);}
    .dot-ok{background:var(--success);}
    .dot-fail{background:var(--danger);}
    .dot-warn{background:var(--warning);}
    .tl-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
    .tl-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;}
    .tl-time{color:var(--text-muted);font-size:11px;font-family:monospace;}
    .tl-details{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;font-size:11px;margin-top:6px;color:var(--text-muted);}
    .tl-meta{margin-top:8px;padding:8px;background:#0f172a;border-radius:4px;font-family:monospace;font-size:10px;white-space:pre-wrap;word-break:break-all;}

    /* Connect modal */
    .connect-screen{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 52px);}
    .connect-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:32px;max-width:380px;width:100%;box-shadow:var(--shadow);text-align:center;}
    .connect-box h2{font-size:17px;margin-bottom:6px;}
    .connect-box .cb-sub{color:var(--text-muted);font-size:12px;margin-bottom:18px;}
    .connect-box .field{display:flex;flex-direction:column;gap:4px;text-align:left;margin-bottom:12px;}
    .connect-box .field label{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;}
    .connect-box .field input{width:100%;}
    .connect-box .btn{width:100%;justify-content:center;margin-top:4px;}
    .connect-err{color:var(--danger);font-size:12px;margin-top:8px;min-height:16px;}

    /* Status msgs */
    .status-msg{margin-top:10px;padding:8px 12px;border-radius:var(--radius-sm);font-size:12px;display:none;}
    .status-error{background:var(--danger-bg);border:1px solid var(--danger-border);color:#fca5a5;display:block;}
    .status-info{background:var(--primary-bg);border:1px solid rgba(59,130,246,0.3);color:#93c5fd;display:block;}

    /* Section heading */
    .sec-heading{font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;}
    .sec-heading .window-note{margin-left:8px;}

    @media(max-width:768px){
      .sidebar{display:none;}
      .main-content{padding:14px;}
      .kpi-grid{grid-template-columns:1fr 1fr;}
      .prob-body{grid-template-columns:1fr;}
      .conv-card{flex-direction:column;align-items:flex-start;}
      .conv-side{align-items:flex-start;width:100%;flex-direction:row;justify-content:space-between;}
      .chat-bubble-customer{margin-right:0;}
      .chat-bubble-assistant{margin-left:0;}
    }
  </style>
</head>
<body>
  <div class="app-shell">

    <!-- ========== TOP BAR ========== -->
    <div class="top-bar">
      <div class="top-bar-left">
        <h1>📊 Admin Monitoring</h1>
        <div class="top-bar-tenant" id="topBarTenant" style="display:none">
          <span class="dot"></span>
          <span id="topBarTenantName"></span>
        </div>
      </div>
      <div class="top-bar-right" id="topBarActions" style="display:none">
        <button class="btn btn-ghost btn-sm" id="btnRefresh">Refresh</button>
        <button class="btn btn-danger-ghost btn-sm" id="btnDisconnect">Disconnect</button>
      </div>
    </div>

    <div class="app-body">

      <!-- ========== SIDEBAR ========== -->
      <nav class="sidebar" id="sidebar" style="display:none">
        <div class="nav-section">Monitoring</div>
        <div class="nav-item active" id="navOverview" data-page="overview">
          <span class="nav-icon">📈</span> Overview
        </div>
        <div class="nav-item" id="navProblems" data-page="problems">
          <span class="nav-icon">⚠️</span> Problems
          <span class="nav-badge" id="navProblemsBadge" style="display:none">0</span>
        </div>
        <div class="nav-item" id="navConversations" data-page="conversations">
          <span class="nav-icon">💬</span> Conversations
        </div>
        <div class="nav-section" style="margin-top:12px;">Advanced</div>
        <div class="nav-item" id="navTrace" data-page="trace">
          <span class="nav-icon">🔍</span> Trace Explorer
        </div>
      </nav>

      <!-- ========== MAIN ========== -->
      <div class="main-content" id="mainContent">

        <!-- Connect screen -->
        <div id="connectScreen" class="connect-screen">
          <div class="connect-box">
            <div style="font-size:28px;margin-bottom:8px;">📊</div>
            <h2>Connect Monitoring</h2>
            <div class="cb-sub">Enter your admin credentials to view chatbot monitoring data.</div>
            <div class="field">
              <label>Admin Token</label>
              <input type="password" id="tokenInput" placeholder="Enter monitoring admin token">
            </div>
            <div class="field">
              <label>Tenant ID</label>
              <input type="text" id="tenantInput" placeholder="e.g. dev-tenant">
            </div>
            <button class="btn btn-primary" id="btnConnect">Connect</button>
            <div class="connect-err" id="connectErr"></div>
          </div>
        </div>

        <!-- ========== OVERVIEW ========== -->
        <div id="pageOverview" style="display:none">
          <div class="pg-hdr">
            <h2>Overview</h2>
            <div class="pg-sub" id="overviewSub"></div>
          </div>
          <div id="healthBanner"></div>
          <div class="sec-heading">
            Recent Activity Summary
            <span class="window-note" id="overviewWindowNote"></span>
          </div>
          <div class="kpi-grid" id="kpiGrid"></div>
          <div class="sec-heading">
            Current Health
          </div>
          <div id="healthVerdict" style="margin-bottom:18px;"></div>
          <div class="sec-heading">
            Recent Problems
            <span class="window-note" id="overviewProblemsNote"></span>
          </div>
          <div id="overviewProblems"></div>
          <div class="sec-heading" style="margin-top:18px;">
            Recent Conversations
            <span class="window-note" id="overviewConvsNote"></span>
          </div>
          <div id="overviewConvs"></div>
          <div id="statusOverview" class="status-msg"></div>
        </div>

        <!-- ========== PROBLEMS ========== -->
        <div id="pageProblems" style="display:none">
          <div class="pg-hdr">
            <h2>Problems</h2>
            <div class="pg-sub" id="problemsSub"></div>
          </div>
          <div class="filter-bar">
            <span class="flabel">Window:</span>
            <select id="probLimitSel">
              <option value="50">Latest 50 events</option>
              <option value="100">Latest 100 events</option>
              <option value="200">Latest 200 events</option>
            </select>
            <span class="flabel">Type:</span>
            <select id="probTypeSel">
              <option value="">All problems</option>
              <option value="UNANSWERABLE">Needs Knowledge Coverage</option>
              <option value="FAILURE">Service Interruptions</option>
            </select>
          </div>
          <div id="problemsList"></div>
          <div id="statusProblems" class="status-msg"></div>
        </div>

        <!-- ========== CONVERSATIONS ========== -->
        <div id="pageConversations" style="display:none">
          <div class="pg-hdr">
            <h2>Recent Customer Conversations</h2>
            <div class="pg-sub" id="convSub"></div>
          </div>
          <div class="filter-bar">
            <span class="flabel">Window:</span>
            <select id="convLimitSel">
              <option value="50">Latest 50 events</option>
              <option value="100">Latest 100 events</option>
              <option value="200">Latest 200 events</option>
            </select>
            <span class="flabel">Outcome:</span>
            <select id="convOutcomeSel">
              <option value="">All outcomes</option>
              <option value="ANSWERED">Answered</option>
              <option value="FAILED">Failed</option>
              <option value="INCONCLUSIVE">Inconclusive</option>
            </select>
            <span class="flabel">Status:</span>
            <select id="convAttentionSel">
              <option value="">All Conversations</option>
              <option value="ATTENTION">Needs Attention Only</option>
            </select>
            <span class="flabel">Channel:</span>
            <select disabled title="Channel filtering will be available when multiple channels are connected" style="opacity:0.6;cursor:not-allowed;">
              <option>All Channels (Dev)</option>
            </select>
            <input type="text" id="convSearchInput" placeholder="Search customer ID..." style="width:160px;margin-left:auto;">
          </div>
          <div id="convList"></div>
          <div id="statusConv" class="status-msg"></div>
        </div>

        <!-- ========== CONVERSATION DETAIL ========== -->
        <div id="pageConvDetail" style="display:none">
          <span class="back-link" id="btnConvBack">← Back to Conversations</span>
          <div class="card card-sm" id="convDetailHeader" style="margin-bottom:16px;"></div>
          <div class="sec-heading">Conversation Turns &amp; Transcript</div>
          <div class="transcript-box" id="convTranscript"></div>
          <div id="statusConvDetail" class="status-msg"></div>
        </div>

        <!-- ========== TRACE EXPLORER ========== -->
        <div id="pageTrace" style="display:none">
          <div class="pg-hdr">
            <h2>Trace Explorer</h2>
            <div class="pg-sub">Advanced: search raw telemetry by correlation ID, tenant, or conversation.</div>
          </div>
          <div class="card card-sm">
            <div style="display:flex;gap:6px;margin-bottom:8px;">
              <button class="btn btn-sm traceTabBtn active-trace-tab" data-trace="correlation">Correlation ID</button>
              <button class="btn btn-ghost btn-sm traceTabBtn" data-trace="rawTenant">Tenant Events</button>
              <button class="btn btn-ghost btn-sm traceTabBtn" data-trace="rawConv">Conversation Events</button>
            </div>
            <div style="display:flex;gap:8px;">
              <input type="text" id="traceInput" style="flex:1" placeholder="Enter Correlation ID (UUID)">
              <button class="btn btn-primary btn-sm" id="btnTraceSearch">Search</button>
            </div>
          </div>
          <div id="traceResults"></div>
          <div id="statusTrace" class="status-msg"></div>
        </div>

        <!-- ========== TURN MONITORING DETAIL OVERLAY ========== -->
        <div id="detailOverlay" class="detail-overlay">
          <span class="back-link" id="btnDetailBack">← Back</span>
          <div id="detailDiag"></div>
          <div class="card card-sm" id="detailHeader"></div>
          <div class="timeline" id="detailTimeline"></div>
        </div>

      </div>
    </div>
  </div>

  <script>
    // ======================================================================
    // STATE
    // ======================================================================
    var currentPage = 'overview';
    var traceTab = 'correlation';
    var tenantId = '';
    var previousPage = 'overview';
    var cachedTurns = [];
    var activeConvId = '';

    // ======================================================================
    // INIT
    // ======================================================================
    (function init() {
      var savedToken = sessionStorage.getItem('admin_monitoring_token') || '';
      var savedTenant = sessionStorage.getItem('admin_monitoring_tenant') || '';
      if (savedToken) document.getElementById('tokenInput').value = savedToken;
      if (savedTenant) document.getElementById('tenantInput').value = savedTenant;

      // Wire up event listeners (no inline onclick)
      document.getElementById('btnConnect').addEventListener('click', doConnect);
      document.getElementById('btnRefresh').addEventListener('click', refreshPage);
      document.getElementById('btnDisconnect').addEventListener('click', doDisconnect);
      document.getElementById('btnDetailBack').addEventListener('click', closeDetail);
      document.getElementById('btnConvBack').addEventListener('click', function() { navigate('conversations'); });
      document.getElementById('btnTraceSearch').addEventListener('click', doTraceSearch);

      // Sidebar nav
      document.querySelectorAll('.nav-item[data-page]').forEach(function(el) {
        el.addEventListener('click', function() { navigate(el.getAttribute('data-page')); });
      });

      // Trace tabs
      document.querySelectorAll('.traceTabBtn').forEach(function(el) {
        el.addEventListener('click', function() { switchTraceTab(el.getAttribute('data-trace')); });
      });

      // Filter change listeners
      document.getElementById('probLimitSel').addEventListener('change', loadProblems);
      document.getElementById('probTypeSel').addEventListener('change', loadProblems);
      document.getElementById('convLimitSel').addEventListener('change', loadConversations);
      document.getElementById('convOutcomeSel').addEventListener('change', renderFilteredConversations);
      document.getElementById('convAttentionSel').addEventListener('change', renderFilteredConversations);
      document.getElementById('convSearchInput').addEventListener('input', renderFilteredConversations);

      // Auto-connect if credentials saved
      if (savedToken && savedTenant) {
        tenantId = savedTenant;
        showApp();
      }
    })();

    // ======================================================================
    // AUTH / CONNECTION
    // ======================================================================
    function getToken() {
      return document.getElementById('tokenInput').value.trim() || sessionStorage.getItem('admin_monitoring_token') || '';
    }

    function doConnect() {
      var token = document.getElementById('tokenInput').value.trim();
      var tid = document.getElementById('tenantInput').value.trim();
      var errEl = document.getElementById('connectErr');
      if (!token) { errEl.textContent = 'Admin token is required.'; return; }
      if (!tid) { errEl.textContent = 'Tenant ID is required.'; return; }
      errEl.textContent = '';
      sessionStorage.setItem('admin_monitoring_token', token);
      sessionStorage.setItem('admin_monitoring_tenant', tid);
      tenantId = tid;
      showApp();
    }

    function doDisconnect() {
      sessionStorage.removeItem('admin_monitoring_token');
      sessionStorage.removeItem('admin_monitoring_tenant');
      tenantId = '';
      document.getElementById('connectScreen').style.display = 'flex';
      document.getElementById('sidebar').style.display = 'none';
      document.getElementById('topBarTenant').style.display = 'none';
      document.getElementById('topBarActions').style.display = 'none';
      hideAllPages();
    }

    function showApp() {
      document.getElementById('connectScreen').style.display = 'none';
      document.getElementById('sidebar').style.display = 'flex';
      document.getElementById('topBarTenant').style.display = 'flex';
      document.getElementById('topBarTenantName').textContent = 'Tenant: ' + tenantId;
      document.getElementById('topBarActions').style.display = 'flex';
      navigate('overview');
    }

    function refreshPage() {
      if (currentPage === 'overview') loadOverview();
      else if (currentPage === 'problems') loadProblems();
      else if (currentPage === 'conversations') loadConversations();
      else if (currentPage === 'convDetail') openConversation(activeConvId);
    }

    // ======================================================================
    // NAVIGATION
    // ======================================================================
    function hideAllPages() {
      ['pageOverview','pageProblems','pageConversations','pageConvDetail','pageTrace'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      document.getElementById('detailOverlay').className = 'detail-overlay';
    }

    function navigate(page) {
      if (!tenantId) return;
      closeDetail();
      currentPage = page;
      hideAllPages();

      document.querySelectorAll('.nav-item[data-page]').forEach(function(el) {
        el.classList.toggle('active', el.getAttribute('data-page') === page);
      });

      var targetId = 'page' + page.charAt(0).toUpperCase() + page.slice(1);
      var targetEl = document.getElementById(targetId);
      if (targetEl) targetEl.style.display = 'block';

      if (page === 'overview') loadOverview();
      else if (page === 'problems') loadProblems();
      else if (page === 'conversations') loadConversations();
    }

    // ======================================================================
    // BUSINESS VOCABULARY
    // ======================================================================
    function bizLabel(t) {
      if (!t) return 'Unknown';
      if (t.outcome === 'ANSWERED') {
        var r = t.primaryResolution || '';
        if (r === 'FAQ') return 'Direct FAQ Answer';
        if (r === 'RAG') return 'Document Knowledge Answer';
        if (r === 'LLM' || r === 'GREETING') return 'Grounded AI Answer';
        if (r === 'WORKFLOW') return 'Guided Process Step';
        if (r === 'IMAGE') return 'Photo Analysis Answer';
        return 'Answered';
      }
      if (t.outcome === 'FAILED') {
        return t.primaryReason === 'UNANSWERABLE' ? 'Needs Knowledge Coverage' : 'Service Interruption';
      }
      if (t.outcome === 'INCONCLUSIVE') {
        if (t.primaryReason === 'FALLBACK_WITHOUT_EXPLICIT_FAILURE') return 'Standard Backup Response';
        if (t.primaryReason === 'INSUFFICIENT_TELEMETRY') return 'Monitoring Incomplete';
        return 'Inconclusive';
      }
      return t.outcome || 'Unknown';
    }

    function bizIcon(t) {
      if (!t) return '❓';
      if (t.outcome === 'ANSWERED') return '🟢';
      if (t.outcome === 'FAILED') return t.primaryReason === 'UNANSWERABLE' ? '🟡' : '🔴';
      if (t.outcome === 'INCONCLUSIVE') return t.primaryReason === 'FALLBACK_WITHOUT_EXPLICIT_FAILURE' ? '⚪' : '⚠️';
      return '❓';
    }

    function bizBadge(t) {
      if (!t) return 'badge-neutral';
      if (t.outcome === 'ANSWERED') return 'badge-success';
      if (t.outcome === 'FAILED') return t.primaryReason === 'UNANSWERABLE' ? 'badge-warning' : 'badge-danger';
      return 'badge-neutral';
    }

    function bizExplanation(t) {
      if (!t) return '';
      if (t.outcome === 'ANSWERED') return 'The customer received a helpful answer.';
      if (t.outcome === 'FAILED' && t.primaryReason === 'UNANSWERABLE')
        return 'The assistant could not find enough reliable information in your documents to answer and safely avoided guessing.';
      if (t.outcome === 'FAILED')
        return 'A service needed to complete the request was unavailable or returned an error.';
      if (t.primaryReason === 'FALLBACK_WITHOUT_EXPLICIT_FAILURE')
        return 'A standard fallback response was sent, but no explicit error was recorded in the upstream systems.';
      if (t.primaryReason === 'INSUFFICIENT_TELEMETRY')
        return 'Not enough monitoring data was retrieved to determine the full outcome of this turn.';
      return t.summaryExplanation || '';
    }

    function bizAction(t) {
      if (!t) return '';
      if (t.outcome === 'ANSWERED') return '';
      if (t.outcome === 'FAILED' && t.primaryReason === 'UNANSWERABLE')
        return 'Add information about this topic to your knowledge documents or FAQ library.';
      if (t.outcome === 'FAILED')
        return 'Check the relevant provider or service connection and API key status.';
      if (t.primaryReason === 'FALLBACK_WITHOUT_EXPLICIT_FAILURE')
        return 'Review the conversation context if needed; no immediate action required.';
      return '';
    }

    function customerDisplayLabel(convId) {
      if (!convId || convId === 'null' || convId === 'undefined') return 'Customer (Unassigned)';
      return 'Customer (' + convId.substring(0, 8) + '...)';
    }

    function fmtTime(ts) {
      if (!ts) return '';
      try {
        var d = new Date(ts);
        var ms = Date.now() - d.getTime();
        var m = Math.floor(ms / 60000);
        if (m < 1) return 'Just now';
        if (m < 60) return m + ' min ago';
        var h = Math.floor(m / 60);
        if (h < 24) return h + 'h ago';
        return Math.floor(h / 24) + 'd ago';
      } catch(e) { return ts; }
    }

    function escHtml(s) {
      if (!s) return '';
      var d = document.createElement('div');
      d.appendChild(document.createTextNode(s));
      return d.innerHTML;
    }

    // ======================================================================
    // FETCH HELPER
    // ======================================================================
    function apiFetch(url) {
      var token = getToken();
      return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } }).then(function(res) {
        if (res.status === 401) throw new Error('UNAUTHORIZED');
        if (res.status === 503) throw new Error('SERVICE_UNAVAILABLE');
        if (!res.ok) return res.json().then(function(b) { throw new Error(b.message || 'Request failed'); });
        return res.json();
      });
    }

    function showStatus(id, msg, isErr) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg;
      el.className = isErr ? 'status-msg status-error' : 'status-msg status-info';
    }
    function hideStatus(id) {
      var el = document.getElementById(id);
      if (el) { el.style.display = 'none'; el.className = 'status-msg'; }
    }

    // ======================================================================
    // OVERVIEW
    // ======================================================================
    function loadOverview() {
      if (!tenantId) return;
      document.getElementById('overviewSub').textContent = 'Tenant: ' + tenantId;
      showStatus('statusOverview', 'Loading monitoring data...', false);

      apiFetch('/api/admin/turns?tenantId=' + encodeURIComponent(tenantId) + '&limit=50').then(function(data) {
        hideStatus('statusOverview');
        var turns = data.turns || [];
        cachedTurns = turns;
        var total = turns.length;
        var answered = turns.filter(function(t){ return t.outcome === 'ANSWERED'; }).length;
        var needsKnow = turns.filter(function(t){ return t.outcome === 'FAILED' && t.primaryReason === 'UNANSWERABLE'; }).length;
        var svcIssues = turns.filter(function(t){ return t.outcome === 'FAILED' && t.primaryReason !== 'UNANSWERABLE'; }).length;
        var problems = turns.filter(function(t){ return t.outcome === 'FAILED' || t.outcome === 'INCONCLUSIVE'; });

        var winLabel = 'Based on the latest ' + total + ' retrieved turns';
        document.getElementById('overviewWindowNote').textContent = winLabel;

        // Sidebar badge
        var badge = document.getElementById('navProblemsBadge');
        if (problems.length > 0) {
          badge.textContent = problems.length;
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
        }

        // KPI cards
        var pctAns = total > 0 ? Math.round((answered / total) * 100) : 0;
        document.getElementById('kpiGrid').innerHTML =
          kpiCard('💬', total, 'Recent Turns', winLabel, '') +
          kpiCard('🟢', answered, 'Answered', winLabel, pctAns + '% of window') +
          kpiCard('🟡', needsKnow, 'Needs Knowledge', winLabel, needsKnow > 0 ? 'Topics not covered' : 'All topics covered') +
          kpiCard('🔴', svcIssues, 'Issues Detected', winLabel, svcIssues > 0 ? 'Service interruptions' : 'No service issues');

        // Health verdict
        renderHealthVerdict(total, answered, svcIssues, needsKnow);

        // Recent problems (top 5)
        if (problems.length === 0) {
          document.getElementById('overviewProblemsNote').textContent = '';
          document.getElementById('overviewProblems').innerHTML =
            '<div class="empty-box" style="padding:20px"><div class="e-icon">✅</div><div class="e-title">Nothing needs your attention right now.</div><div class="e-desc">No problems were detected in the current monitoring window.</div></div>';
        } else {
          document.getElementById('overviewProblemsNote').textContent = '(' + problems.length + ' in current window)';
          var ph = '';
          problems.slice(0, 5).forEach(function(t) { ph += buildProblemCard(t); });
          if (problems.length > 5) {
            ph += '<div style="text-align:center;margin-top:6px;"><button class="btn btn-ghost btn-sm" data-nav="problems">View all ' + problems.length + ' problems &#8594;</button></div>';
          }
          document.getElementById('overviewProblems').innerHTML = ph;
          wireNavButtons(document.getElementById('overviewProblems'));
        }

        // Recent conversations (top 6 grouped conversations)
        var convs = groupTurnsIntoConversations(turns);
        if (convs.length === 0) {
          document.getElementById('overviewConvsNote').textContent = '';
          document.getElementById('overviewConvs').innerHTML =
            '<div class="empty-box" style="padding:20px"><div class="e-icon">💬</div><div class="e-title">No recent customer turns found</div><div class="e-desc">No customer turns were found in the current monitoring window.</div></div>';
        } else {
          document.getElementById('overviewConvsNote').textContent = '(' + convs.length + ' conversations in window)';
          var ch = '';
          convs.slice(0, 6).forEach(function(c) { ch += buildConversationCard(c); });
          document.getElementById('overviewConvs').innerHTML = ch;
          wireConvButtons(document.getElementById('overviewConvs'));
        }

      }).catch(function(err) { handlePageErr('statusOverview', err); });
    }

    function kpiCard(icon, value, label, winLabel, detail) {
      return '<div class="kpi-card">' +
        '<div class="kpi-icon">' + icon + '</div>' +
        '<div class="kpi-value">' + value + '</div>' +
        '<div class="kpi-label">' + label + '</div>' +
        (detail ? '<div class="kpi-detail">' + detail + '</div>' : '') +
        '<div class="window-note">' + escHtml(winLabel) + '</div>' +
        '</div>';
    }

    function renderHealthVerdict(total, answered, svcIssues, needsKnow) {
      var el = document.getElementById('healthVerdict');
      if (total === 0) {
        el.innerHTML = '<div class="health-banner hb-none"><div class="h-icon">📭</div><div><div class="h-text" style="color:var(--text-secondary)">No recent activity found</div><div class="h-sub">No customer turns were found in the current monitoring window for this tenant.</div></div></div>';
        return;
      }
      var pct = Math.round((answered / total) * 100);
      if (svcIssues > 0) {
        el.innerHTML = '<div class="health-banner hb-bad"><div class="h-icon">🔴</div><div><div class="h-text" style="color:var(--danger)">Problems detected</div><div class="h-sub">' + svcIssues + ' service issue' + (svcIssues !== 1 ? 's' : '') + ' found in the current monitoring window.</div></div></div>';
      } else if (needsKnow > 0) {
        el.innerHTML = '<div class="health-banner hb-warn"><div class="h-icon">🟡</div><div><div class="h-text" style="color:var(--warning)">Needs attention</div><div class="h-sub">' + needsKnow + ' question' + (needsKnow !== 1 ? 's' : '') + ' could not be answered — your knowledge documents may need updating.</div></div></div>';
      } else {
        el.innerHTML = '<div class="health-banner hb-good"><div class="h-icon">🟢</div><div><div class="h-text" style="color:var(--success)">Working well</div><div class="h-sub">' + pct + '% of recent turns were answered successfully.</div></div></div>';
      }
    }

    // ======================================================================
    // PROBLEMS PAGE
    // ======================================================================
    function loadProblems() {
      if (!tenantId) return;
      var limit = document.getElementById('probLimitSel').value;
      var typeF = document.getElementById('probTypeSel').value;
      showStatus('statusProblems', 'Loading problems...', false);

      var url = '/api/admin/turns?tenantId=' + encodeURIComponent(tenantId) + '&limit=' + limit;
      if (typeF === 'UNANSWERABLE') url += '&outcome=FAILED&primaryFailure=LLM';
      else if (typeF === 'FAILURE') url += '&outcome=FAILED';

      apiFetch(url).then(function(data) {
        hideStatus('statusProblems');
        var turns = data.turns || [];
        var probs = turns.filter(function(t) {
          if (typeF === 'UNANSWERABLE') return t.outcome === 'FAILED' && t.primaryReason === 'UNANSWERABLE';
          if (typeF === 'FAILURE') return t.outcome === 'FAILED' && t.primaryReason !== 'UNANSWERABLE';
          return t.outcome === 'FAILED' || t.outcome === 'INCONCLUSIVE';
        });

        document.getElementById('problemsSub').textContent =
          probs.length + ' problem' + (probs.length !== 1 ? 's' : '') + ' in current monitoring window \u00b7 Latest ' + limit + ' events';

        // Badge
        var badge = document.getElementById('navProblemsBadge');
        if (probs.length > 0) { badge.textContent = probs.length; badge.style.display = 'inline'; }
        else { badge.style.display = 'none'; }

        if (probs.length === 0) {
          document.getElementById('problemsList').innerHTML =
            '<div class="empty-box"><div class="e-icon">✅</div><div class="e-title">Nothing needs your attention right now.</div><div class="e-desc">No problems were detected in the current monitoring window.</div></div>';
          return;
        }
        var h = '';
        probs.forEach(function(t) { h += buildProblemCard(t); });
        document.getElementById('problemsList').innerHTML = h;
        wireDetailButtons(document.getElementById('problemsList'));
      }).catch(function(err) { handlePageErr('statusProblems', err); });
    }

    function buildProblemCard(t) {
      var label = bizLabel(t);
      var icon = bizIcon(t);
      var expl = bizExplanation(t);
      var why = t.summaryExplanation || expl;
      var action = bizAction(t);
      var impact = 'The customer received a backup response instead of a tailored answer.';
      if (t.outcome === 'INCONCLUSIVE' && t.primaryReason === 'FALLBACK_WITHOUT_EXPLICIT_FAILURE')
        impact = 'The customer received a standard backup response.';
      if (t.primaryReason === 'INSUFFICIENT_TELEMETRY' || t.possiblyTruncated)
        impact = 'Customer impact is unknown — monitoring data is incomplete for this turn.';

      var truncHtml = t.possiblyTruncated ? '<div style="font-size:11px;margin-bottom:6px;"><span class="badge badge-warning" style="font-size:10px;">⚠️ Monitoring Incomplete</span> This turn may have additional events outside the current window.</div>' : '';

      var convSnip = t.conversationId ? customerDisplayLabel(t.conversationId) : 'Customer (Unassigned)';

      return '<div class="prob-card">' +
        '<div class="prob-hdr">' +
          '<div class="prob-title">' + icon + ' ' + escHtml(label) + '</div>' +
          '<div class="prob-time">' + fmtTime(t.startTime) + '</div>' +
        '</div>' +
        truncHtml +
        '<div class="prob-body">' +
          '<div class="prob-field"><label>What happened</label>' + escHtml(expl) + '</div>' +
          '<div class="prob-field"><label>Why</label>' + escHtml(why) + '</div>' +
          '<div class="prob-field"><label>Impact</label>' + escHtml(impact) + '</div>' +
          '<div class="prob-field"><label>What should I do</label>' + escHtml(action || 'No immediate action required.') + '</div>' +
        '</div>' +
        '<div class="prob-foot">' +
          '<div class="prob-conv">' + escHtml(convSnip) + '</div>' +
          '<button class="btn btn-ghost btn-sm detail-btn" data-cid="' + escHtml(t.correlationId) + '">View Details &#8594;</button>' +
        '</div>' +
      '</div>';
    }

    // ======================================================================
    // CONVERSATIONS PAGE
    // ======================================================================
    function groupTurnsIntoConversations(turns) {
      var convMap = {};
      var convList = [];

      turns.forEach(function(t) {
        var cid = t.conversationId || 'unassigned';
        if (!convMap[cid]) {
          convMap[cid] = {
            conversationId: cid,
            customerLabel: customerDisplayLabel(t.conversationId),
            turns: [],
            lastActivity: t.startTime,
            hasFailure: false,
            hasUnanswerable: false,
            latestTurn: t
          };
          convList.push(convMap[cid]);
        }
        var c = convMap[cid];
        c.turns.push(t);
        if (new Date(t.startTime).getTime() > new Date(c.lastActivity).getTime()) {
          c.lastActivity = t.startTime;
          c.latestTurn = t;
        }
        if (t.outcome === 'FAILED') {
          c.hasFailure = true;
          if (t.primaryReason === 'UNANSWERABLE') c.hasUnanswerable = true;
        }
        if (t.outcome === 'INCONCLUSIVE') c.hasFailure = true;
      });

      return convList;
    }

    function loadConversations() {
      if (!tenantId) return;
      var limit = document.getElementById('convLimitSel').value;
      showStatus('statusConv', 'Loading conversations...', false);

      var url = '/api/admin/turns?tenantId=' + encodeURIComponent(tenantId) + '&limit=' + limit;

      apiFetch(url).then(function(data) {
        hideStatus('statusConv');
        cachedTurns = data.turns || [];
        renderFilteredConversations();
      }).catch(function(err) { handlePageErr('statusConv', err); });
    }

    function renderFilteredConversations() {
      var limit = document.getElementById('convLimitSel').value;
      var outcomeF = document.getElementById('convOutcomeSel').value;
      var attentionF = document.getElementById('convAttentionSel').value;
      var searchQ = (document.getElementById('convSearchInput').value || '').trim().toLowerCase();

      var turns = cachedTurns;
      var convs = groupTurnsIntoConversations(turns);

      // Filter conversations
      var filtered = convs.filter(function(c) {
        if (outcomeF && c.latestTurn && c.latestTurn.outcome !== outcomeF) return false;
        if (attentionF === 'ATTENTION' && !c.hasFailure) return false;
        if (searchQ) {
          var matchLabel = c.customerLabel.toLowerCase().includes(searchQ);
          var matchId = c.conversationId.toLowerCase().includes(searchQ);
          if (!matchLabel && !matchId) return false;
        }
        return true;
      });

      document.getElementById('convSub').textContent =
        filtered.length + ' customer conversation' + (filtered.length !== 1 ? 's' : '') +
        ' (' + turns.length + ' turns in window) \u00b7 Latest ' + limit + ' events';

      if (filtered.length === 0) {
        if (searchQ || outcomeF || attentionF) {
          document.getElementById('convList').innerHTML =
            '<div class="empty-box"><div class="e-icon">🔍</div><div class="e-title">No matching conversations found</div><div class="e-desc">No customer conversations matched your active filters in the current monitoring window.</div></div>';
        } else {
          document.getElementById('convList').innerHTML =
            '<div class="empty-box"><div class="e-icon">💬</div><div class="e-title">No recent customer turns found</div><div class="e-desc">No customer turns were found in the current monitoring window for this tenant.</div></div>';
        }
        return;
      }

      var h = '';
      filtered.forEach(function(c) { h += buildConversationCard(c); });
      document.getElementById('convList').innerHTML = h;
      wireConvButtons(document.getElementById('convList'));
    }

    function buildConversationCard(c) {
      var latest = c.latestTurn;
      var icon = bizIcon(latest);
      var label = bizLabel(latest);
      var bc = bizBadge(latest);
      var turnsCountText = c.turns.length + ' turn' + (c.turns.length !== 1 ? 's' : '');

      var hasTrunc = c.turns.some(function(t) { return t.possiblyTruncated; });
      var truncBadge = hasTrunc ? ' <span class="badge badge-warning" style="font-size:9px;">⚠️ Partial</span>' : '';

      return '<div class="conv-card">' +
        '<div class="conv-avatar">👤</div>' +
        '<div class="conv-main">' +
          '<div class="conv-title">' +
            escHtml(c.customerLabel) +
            ' <span class="badge ' + bc + '" style="font-size:10px">' + (latest ? latest.outcome : 'ACTIVE') + '</span>' +
            truncBadge +
          '</div>' +
          '<div class="conv-meta">' +
            '<div><strong>Latest:</strong> ' + icon + ' ' + escHtml(label) + '</div>' +
            '<div><strong>Turns:</strong> ' + turnsCountText + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="conv-side">' +
          '<div class="conv-time">' + fmtTime(c.lastActivity) + '</div>' +
          '<button class="btn btn-ghost btn-sm conv-open-btn" data-invid="' + escHtml(c.conversationId) + '">View Conversation &#8594;</button>' +
        '</div>' +
      '</div>';
    }

    // ======================================================================
    // CONVERSATION DETAIL (TRANSCRIPT)
    // ======================================================================
    function openConversation(cid) {
      if (!cid) return;
      activeConvId = cid;
      currentPage = 'convDetail';
      previousPage = 'conversations';
      hideAllPages();

      var detailPage = document.getElementById('pageConvDetail');
      detailPage.style.display = 'block';
      document.getElementById('convDetailHeader').innerHTML = '<div style="color:var(--text-muted)">Loading conversation transcript...</div>';
      document.getElementById('convTranscript').innerHTML = '';
      showStatus('statusConvDetail', 'Loading conversation history...', false);

      var turnsUrl = cid === 'unassigned'
        ? '/api/admin/turns?tenantId=' + encodeURIComponent(tenantId) + '&limit=50'
        : '/api/admin/conversations/' + encodeURIComponent(cid) + '/turns?limit=50';

      var msgsUrl = cid === 'unassigned'
        ? null
        : '/api/admin/conversations/' + encodeURIComponent(cid) + '/messages?tenantId=' + encodeURIComponent(tenantId) + '&limit=50';

      var fetchTurns = apiFetch(turnsUrl);
      var fetchMsgs = msgsUrl ? apiFetch(msgsUrl).catch(function() { return { messages: [] }; }) : Promise.resolve({ messages: [] });

      Promise.all([fetchTurns, fetchMsgs]).then(function(results) {
        hideStatus('statusConvDetail');
        var turnsData = results[0];
        var msgsData = results[1];

        var turns = turnsData.turns || [];
        var messages = msgsData.messages || [];

        // If unassigned query, filter to unassigned
        if (cid === 'unassigned') {
          turns = turns.filter(function(t) { return !t.conversationId; });
        }

        // Sort chronologically ascending for natural conversation flow
        turns.sort(function(a, b) {
          return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        });

        var latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
        var custLabel = customerDisplayLabel(cid);

        var convStatus = '🟢 Working Well';
        if (turns.some(function(t) { return t.outcome === 'FAILED' && t.primaryReason !== 'UNANSWERABLE'; })) {
          convStatus = '🔴 Service Issue';
        } else if (turns.some(function(t) { return t.outcome === 'FAILED'; })) {
          convStatus = '🟡 Needs Attention';
        }

        // Header
        var hdrHtml = '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">' +
          '<div>' +
            '<h2 style="font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;">' +
              '👤 ' + escHtml(custLabel) +
              ' <span class="badge badge-info" style="font-size:11px;">' + convStatus + '</span>' +
            '</h2>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">' +
              'Conversation ID: <span style="font-family:monospace;color:var(--text-secondary);">' + escHtml(cid) + '</span>' +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;font-size:12px;color:var(--text-muted);">' +
            '<div><strong>' + turns.length + '</strong> customer turn' + (turns.length !== 1 ? 's' : '') + ' in window</div>' +
            (messages.length > 0 ? '<div><strong>' + messages.length + '</strong> messages retrieved</div>' : '') +
            '<div>Last active ' + fmtTime(latestTurn ? latestTurn.startTime : '') + '</div>' +
          '</div>' +
        '</div>';
        document.getElementById('convDetailHeader').innerHTML = hdrHtml;

        if (turns.length === 0 && messages.length === 0) {
          document.getElementById('convTranscript').innerHTML =
            '<div class="empty-box"><div class="e-icon">💬</div><div class="e-title">No turns found</div><div class="e-desc">No message turns were found in the current monitoring window for this conversation.</div></div>';
          return;
        }

        // Separate USER and ASSISTANT messages
        var userMsgs = messages.filter(function(m) { return m.role === 'USER'; });
        var assistantMsgs = messages.filter(function(m) { return m.role === 'ASSISTANT'; });

        var turnCount = Math.max(turns.length, Math.max(userMsgs.length, assistantMsgs.length));
        var tHtml = '';
        for (var idx = 0; idx < turnCount; idx++) {
          var t = turns[idx] || {
            correlationId: (userMsgs[idx] && userMsgs[idx].messageId) || ('turn-' + (idx + 1)),
            outcome: 'ANSWERED',
            startTime: (userMsgs[idx] && userMsgs[idx].createdAt) || new Date().toISOString(),
            stages: ['ENTRY', 'RESPONSE']
          };
          var uMsg = userMsgs[idx] || null;
          var aMsg = assistantMsgs[idx] || null;
          tHtml += buildTurnTranscriptBox(t, idx + 1, uMsg, aMsg);
        }
        document.getElementById('convTranscript').innerHTML = tHtml;
        wireDetailButtons(document.getElementById('convTranscript'));

      }).catch(function(err) {
        showStatus('statusConvDetail', 'Failed to load conversation: ' + err.message, true);
      });
    }

    function buildTurnTranscriptBox(t, turnNum, userMsg, assistantMsg) {
      var icon = bizIcon(t);
      var label = bizLabel(t);
      var bc = bizBadge(t);
      var expl = bizExplanation(t);
      var why = t.summaryExplanation || expl;
      var action = bizAction(t);

      var truncNotice = t.possiblyTruncated
        ? '<div style="font-size:11px;color:var(--warning);margin-bottom:8px;">⚠️ Monitoring Incomplete — turn boundary was reached during retrieval.</div>'
        : '';

      // Customer message: real content from database if available, else fallback to stage summary
      var customerText = userMsg && userMsg.content ? userMsg.content : (t.stages && t.stages.length > 0 ? 'Customer Interaction (' + t.stages.join(' → ') + ')' : 'Customer Turn');
      var customerTime = userMsg && userMsg.createdAt ? fmtTime(userMsg.createdAt) : fmtTime(t.startTime);

      // Assistant response: real content from database if available, else fallback to business explanation
      var assistantText = assistantMsg && assistantMsg.content ? assistantMsg.content : (label + ' — ' + expl);
      var assistantSource = t.finalResponseSource ? 'Source: ' + escHtml(t.finalResponseSource) : (assistantMsg ? 'Assistant Response' : '');

      return '<div class="turn-bubble-group">' +
        '<div class="turn-bubble-hdr">' +
          '<div class="turn-bubble-title">' +
            '<span>Turn ' + turnNum + '</span>' +
            '<span>' + icon + ' ' + escHtml(label) + '</span>' +
            '<span class="badge ' + bc + '" style="font-size:10px;">' + t.outcome + '</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);">' +
            (t.totalLatencyMs !== undefined ? '<span>' + t.totalLatencyMs + 'ms · </span>' : '') +
            '<span>' + fmtTime(t.startTime) + '</span>' +
          '</div>' +
        '</div>' +
        truncNotice +
        '<div class="chat-bubble chat-bubble-customer">' +
          '<div class="chat-role chat-role-customer"><span>👤 CUSTOMER</span><span>' + customerTime + '</span></div>' +
          '<div class="chat-text">' + escHtml(customerText) + '</div>' +
        '</div>' +
        '<div class="chat-bubble chat-bubble-assistant">' +
          '<div class="chat-role chat-role-assistant"><span>🤖 ASSISTANT</span><span>' + assistantSource + '</span></div>' +
          '<div class="chat-text" style="white-space:pre-wrap;">' + escHtml(assistantText) + '</div>' +
        '</div>' +
        '<div class="turn-diag-box">' +
          '<div class="turn-diag-row"><label>Diagnosis:</label><span>' + escHtml(why) + '</span></div>' +
          (action ? '<div class="turn-diag-row" style="color:var(--warning)"><label>Action:</label><span>' + escHtml(action) + '</span></div>' : '') +
        '</div>' +
        '<div class="turn-footer">' +
          '<span style="font-size:11px;color:var(--text-muted);font-family:monospace;">' + escHtml(t.correlationId.substring(0, 16)) + '...</span>' +
          '<button class="btn btn-ghost btn-sm detail-btn" data-cid="' + escHtml(t.correlationId) + '">View Monitoring Details &#8594;</button>' +
        '</div>' +
      '</div>';
    }

    // ======================================================================
    // WIRING: delegate click to detail / nav / conversation buttons
    // ======================================================================
    function wireDetailButtons(container) {
      if (!container) return;
      container.querySelectorAll('.detail-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          openDetail(btn.getAttribute('data-cid'));
        });
      });
    }

    function wireConvButtons(container) {
      if (!container) return;
      container.querySelectorAll('.conv-open-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          openConversation(btn.getAttribute('data-invid'));
        });
      });
      wireDetailButtons(container);
    }

    function wireNavButtons(container) {
      if (!container) return;
      container.querySelectorAll('[data-nav]').forEach(function(btn) {
        btn.addEventListener('click', function() { navigate(btn.getAttribute('data-nav')); });
      });
      wireDetailButtons(container);
    }

    // ======================================================================
    // TURN MONITORING DETAIL OVERLAY
    // ======================================================================
    function openDetail(cid) {
      if (!cid) return;
      previousPage = currentPage;
      hideAllPages();
      var ov = document.getElementById('detailOverlay');
      ov.className = 'detail-overlay visible';
      document.getElementById('detailDiag').innerHTML = '<div class="status-msg status-info" style="display:block">Loading turn details...</div>';
      document.getElementById('detailHeader').innerHTML = '';
      document.getElementById('detailTimeline').innerHTML = '';

      apiFetch('/api/admin/turns/' + encodeURIComponent(cid)).then(function(data) {
        var turn = data.turn;
        var events = data.events || [];
        var diag = data.diagnosis;

        // Diagnosis card
        if (diag) {
          var dIcon = turn ? bizIcon(turn) : '🔍';
          var dLabel = turn ? bizLabel(turn) : 'Diagnostic Analysis';
          var dBadge = turn ? bizBadge(turn) : 'badge-neutral';
          var dExpl = turn ? bizExplanation(turn) : (diag.summaryExplanation || '');
          var dAction = turn ? bizAction(turn) : '';

          var truncW = '';
          if (turn && turn.possiblyTruncated) {
            truncW = '<div style="font-size:11px;color:var(--warning);margin-bottom:6px">⚠️ Monitoring Incomplete — this turn may have additional events outside the current window. The diagnosis below is based on available data only and does not replace the underlying diagnostic outcome.</div>';
          }

          document.getElementById('detailDiag').innerHTML =
            '<div class="diag-card">' +
              '<div class="diag-hdr">' +
                '<div class="diag-title">' + dIcon + ' ' + escHtml(dLabel) + ' <span class="badge ' + dBadge + '">' + diag.outcome + '</span></div>' +
                (turn && turn.totalLatencyMs !== undefined ? '<span class="badge badge-stage">' + turn.totalLatencyMs + ' ms</span>' : '') +
              '</div>' +
              truncW +
              '<div class="diag-summary">' + escHtml(dExpl) + '</div>' +
              (dAction ? '<div class="diag-action"><strong>Recommended action:</strong> ' + escHtml(dAction) + '</div>' : '') +
              '<div class="diag-grid">' +
                (diag.primaryResolution ? '<div><strong>Resolution:</strong> <span style="color:var(--success)">' + diag.primaryResolution + '</span></div>' : '') +
                (diag.primaryFailure ? '<div><strong>Failure Subsystem:</strong> <span style="color:var(--danger)">' + diag.primaryFailure + '</span></div>' : '') +
                (diag.primaryReason ? '<div><strong>Reason:</strong> ' + diag.primaryReason + '</div>' : '') +
                (diag.finalResponseSource ? '<div><strong>Response Source:</strong> ' + diag.finalResponseSource + '</div>' : '') +
              '</div>' +
            '</div>';
        } else {
          document.getElementById('detailDiag').innerHTML = '';
        }

        document.getElementById('detailHeader').innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
            '<strong>Turn Events</strong>' +
            '<span class="badge badge-stage">' + events.length + ' event' + (events.length !== 1 ? 's' : '') + '</span>' +
          '</div>';

        renderTimeline(events, document.getElementById('detailTimeline'));

      }).catch(function(err) {
        document.getElementById('detailDiag').innerHTML = '<div class="status-msg status-error" style="display:block">Failed to load: ' + escHtml(err.message) + '</div>';
      });
    }

    function closeDetail() {
      document.getElementById('detailOverlay').className = 'detail-overlay';
      if (previousPage === 'convDetail') {
        var detailPage = document.getElementById('pageConvDetail');
        if (detailPage) detailPage.style.display = 'block';
        return;
      }
      var pid = 'page' + previousPage.charAt(0).toUpperCase() + previousPage.slice(1);
      var el = document.getElementById(pid);
      if (el) el.style.display = 'block';
    }

    // ======================================================================
    // TRACE EXPLORER
    // ======================================================================
    function switchTraceTab(tab) {
      traceTab = tab;
      document.querySelectorAll('.traceTabBtn').forEach(function(b) {
        if (b.getAttribute('data-trace') === tab) {
          b.className = 'btn btn-sm traceTabBtn active-trace-tab';
        } else {
          b.className = 'btn btn-ghost btn-sm traceTabBtn';
        }
      });
      var inp = document.getElementById('traceInput');
      if (tab === 'correlation') inp.placeholder = 'Enter Correlation ID (UUID)';
      else if (tab === 'rawTenant') inp.placeholder = 'Enter Tenant ID';
      else inp.placeholder = 'Enter Conversation ID (UUID)';
    }

    function doTraceSearch() {
      var q = document.getElementById('traceInput').value.trim();
      if (!q) { showStatus('statusTrace', 'Please enter a search value.', true); return; }
      showStatus('statusTrace', 'Searching...', false);

      var url = '';
      if (traceTab === 'correlation') url = '/api/admin/turns/' + encodeURIComponent(q);
      else if (traceTab === 'rawTenant') url = '/api/admin/turns?tenantId=' + encodeURIComponent(q) + '&limit=50';
      else url = '/api/admin/conversations/' + encodeURIComponent(q) + '/turns?limit=50';

      apiFetch(url).then(function(data) {
        hideStatus('statusTrace');
        var el = document.getElementById('traceResults');

        if (data.turn || data.diagnosis) {
          var events = data.events || [];
          var h = '';
          if (data.diagnosis) {
            var dg = data.diagnosis;
            h += '<div class="diag-card" style="margin-top:12px">' +
              '<div class="diag-hdr"><div class="diag-title">🔍 Trace Diagnosis <span class="badge ' + outcomeBadge(dg.outcome) + '">' + dg.outcome + '</span></div></div>' +
              '<div class="diag-summary">' + escHtml(dg.summaryExplanation || '') + '</div>' +
              '<div class="diag-grid">' +
                (dg.primaryResolution ? '<div><strong>Resolution:</strong> <span style="color:var(--success)">' + dg.primaryResolution + '</span></div>' : '') +
                (dg.primaryFailure ? '<div><strong>Failure:</strong> <span style="color:var(--danger)">' + dg.primaryFailure + '</span></div>' : '') +
                (dg.primaryReason ? '<div><strong>Reason:</strong> ' + dg.primaryReason + '</div>' : '') +
                (dg.finalResponseSource ? '<div><strong>Response:</strong> ' + dg.finalResponseSource + '</div>' : '') +
              '</div></div>';
          }
          h += '<div class="card card-sm" style="margin-top:8px"><strong>' + events.length + ' event' + (events.length !== 1 ? 's' : '') + '</strong></div>';
          h += '<div class="timeline" id="traceTimeline"></div>';
          el.innerHTML = h;
          renderTimeline(events, document.getElementById('traceTimeline'));
          return;
        }

        if (data.turns) {
          var turns = data.turns || [];
          if (turns.length === 0) {
            el.innerHTML = '<div class="empty-box" style="margin-top:12px"><div class="e-icon">🔍</div><div class="e-title">No results found</div></div>';
            return;
          }
          var h = '<div class="card card-sm" style="margin-top:8px"><strong>' + turns.length + ' turn' + (turns.length !== 1 ? 's' : '') + '</strong></div>';
          turns.forEach(function(t) { h += buildTurnTranscriptBox(t, 1); });
          el.innerHTML = h;
          wireDetailButtons(el);
          return;
        }

        el.innerHTML = '<div class="empty-box" style="margin-top:12px"><div class="e-icon">🔍</div><div class="e-title">No results</div></div>';
      }).catch(function(err) { handlePageErr('statusTrace', err); });
    }

    function outcomeBadge(o) {
      if (o === 'ANSWERED') return 'badge-success';
      if (o === 'FAILED') return 'badge-danger';
      return 'badge-neutral';
    }

    // ======================================================================
    // SHARED: Timeline
    // ======================================================================
    function renderTimeline(events, container) {
      if (!container) return;
      container.innerHTML = '';
      if (events.length === 0) {
        container.innerHTML = '<div class="card card-sm" style="color:var(--text-muted)">No telemetry events found.</div>';
        return;
      }
      events.forEach(function(evt, idx) {
        var dc = 'dot-ok';
        var bc = 'badge-success';
        if (evt.status === 'FAILURE') { dc = 'dot-fail'; bc = 'badge-danger'; }
        else if (evt.status === 'UNANSWERABLE' || evt.status === 'SKIPPED') { dc = 'dot-warn'; bc = 'badge-warning'; }

        var metaH = '';
        if (evt.metadata && Object.keys(evt.metadata).length > 0) {
          metaH = '<div class="tl-meta">' + escHtml(JSON.stringify(evt.metadata, null, 2)) + '</div>';
        }

        var item = document.createElement('div');
        item.className = 'tl-item';
        item.innerHTML =
          '<div class="tl-dot ' + dc + '"></div>' +
          '<div class="tl-hdr">' +
            '<div class="tl-title"><span>' + (idx+1) + '. ' + escHtml(evt.eventType) + '</span> <span class="badge badge-stage">' + escHtml(evt.stage) + '</span> <span class="badge ' + bc + '">' + evt.status + '</span></div>' +
            '<div class="tl-time">' + evt.timestamp + '</div>' +
          '</div>' +
          '<div class="tl-details">' +
            '<div><strong>Correlation:</strong> ' + evt.correlationId + '</div>' +
            '<div><strong>Tenant:</strong> ' + evt.tenantId + '</div>' +
            (evt.latencyMs !== undefined ? '<div><strong>Latency:</strong> ' + evt.latencyMs + 'ms</div>' : '') +
            (evt.provider ? '<div><strong>Provider:</strong> ' + evt.provider + ' (' + (evt.model||'default') + ')</div>' : '') +
            (evt.errorCode ? '<div style="color:var(--danger)"><strong>Error:</strong> ' + evt.errorCode + '</div>' : '') +
          '</div>' +
          metaH;
        container.appendChild(item);
      });
    }

    // ======================================================================
    // ERROR HANDLING
    // ======================================================================
    function handlePageErr(statusId, err) {
      if (err.message === 'UNAUTHORIZED') {
        showStatus(statusId, '401 Unauthorized — check your admin token.', true);
      } else if (err.message === 'SERVICE_UNAVAILABLE') {
        showStatus(statusId, '⚠ Monitoring data is currently unavailable. The monitoring service may not be running.', true);
      } else {
        showStatus(statusId, 'Failed to load: ' + err.message, true);
      }
    }
  </script>
</body>
</html>`;
}
