import { useState, useRef } from 'react';

// POST to `url` with JSON body, read the SSE response, call callbacks per event type.
// onDone / onError receive the full parsed data object (may contain extra fields like sessionId).
async function streamSSE(url, body, { onProgress, onDone, onError } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === 'progress') onProgress?.(data);
          else if (currentEvent === 'done')  onDone?.(data);
          else if (currentEvent === 'error') onError?.(data);
        } catch { /* ignore malformed lines */ }
        currentEvent = null;
      }
    }
  }
}

const CAMPAIGN_TYPES = ['New Product Launch', 'Holiday Promotion', 'Loyalty / VIP', 'Win-Back', 'Custom'];
const TONES = ['aspirational', 'minimal', 'playful'];

// Klaviyo flag symbol — rectangle with a V-notch cut into the right edge
function KlaviyoMark() {
  return (
    <svg width="28" height="22" viewBox="0 0 28 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0 H28 L17 11 L28 22 H0 Z" fill="white" />
    </svg>
  );
}

const INDUSTRIES = [
  {
    label: 'Apparel & Fashion',
    scenario: 'standard',
    description: 'Balanced mix: champions, loyal, at-risk, lapsed, new',
  },
  {
    label: 'Beauty & Skincare',
    scenario: 'growth',
    description: 'Growth mode: 60% new customers, light lapsed tail',
  },
  {
    label: 'Home & Electronics',
    scenario: 'churn_risk',
    description: 'Churn risk: 35% at-risk, 40% lapsed customers',
  },
];

const PROFILE_COUNTS = [5, 50, 100, 250, 500];

export default function App() {
  // ── Seeding state ──────────────────────────────────────
  const [apiKey, setApiKey] = useState('');
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [profileCount, setProfileCount] = useState(50);
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [log, setLog] = useState([]);
  const [resetConfirm, setResetConfirm] = useState(false);
  const logRef = useRef(null);
  const seedDismissTimer = useRef(null);

  // ── Progress ───────────────────────────────────────────
  const [progress, setProgress] = useState(0);

  // ── Tab ────────────────────────────────────────────────
  const [tab, setTab] = useState('seed'); // 'seed' | 'generate'

  // ── Campaign state ─────────────────────────────────────
  const [brandName, setBrandName] = useState('');
  const [productName, setProductName] = useState('');
  const [campaignType, setCampaignType] = useState('New Product Launch');
  const [customType, setCustomType] = useState('');
  const [tone, setTone] = useState('aspirational');
  const [deliveryType, setDeliveryType] = useState('Email Campaign');
  const [includeSMS, setIncludeSMS] = useState(false);
  const [includeConditionalSplit, setIncludeConditionalSplit] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [campaignLog, setCampaignLog] = useState([]);
  const [campaignStatus, setCampaignStatus] = useState('idle');
  const [campaignProgress, setCampaignProgress] = useState(0);
  const campaignLogRef = useRef(null);
  const [sessionId, setSessionId] = useState(null); // kept for legacy session compat

  function appendLog(msg, type = 'info') {
    setLog(prev => [...prev, { msg, type, id: Date.now() + Math.random() }]);
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }

  function appendCampaignLog(msg, type = 'info') {
    setCampaignLog(prev => [...prev, { msg, type, id: Date.now() + Math.random() }]);
    requestAnimationFrame(() => {
      if (campaignLogRef.current) campaignLogRef.current.scrollTop = campaignLogRef.current.scrollHeight;
    });
  }

  function dismissSeedLog() {
    clearTimeout(seedDismissTimer.current);
    setStatus('idle');
    setLog([]);
    setProgress(0);
  }

  async function handleSeed() {
    if (!apiKey.trim()) return alert('Enter your Klaviyo private API key first.');
    setStatus('running');
    setLog([]);
    setSessionId(null);
    setProgress(0);
    appendLog(`Seeding ${profileCount} profiles — ${industry.label} (${industry.scenario} scenario)`);
    try {
      await streamSSE('/api/seed', { apiKey: apiKey.trim(), scenario: industry.scenario, profileCount }, {
        onProgress: data => {
          appendLog(data.message, 'progress');
          if (data.pct != null) setProgress(data.pct);
        },
        onDone: data => {
          appendLog(data.message, 'done');
          setProgress(100);
          setStatus('done');
          if (data.sessionId) setSessionId(data.sessionId);
          seedDismissTimer.current = setTimeout(dismissSeedLog, 3000);
        },
        onError: data => { appendLog(data.message, 'error'); setStatus('error'); },
      });
      setStatus(prev => prev === 'running' ? 'done' : prev);
    } catch (err) {
      appendLog(`Error: ${err.message}`, 'error');
      setStatus('error');
    }
  }

  async function handleReset() {
    if (!apiKey.trim()) return alert('Enter your Klaviyo private API key first.');
    setResetConfirm(false);
    setSessionId(null);
    setStatus('running');
    setLog([]);
    setProgress(0);
    appendLog('Resetting sandbox — deleting seeded profiles and lists...');
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      appendLog(data.message, 'done');
      setProgress(100);
      setStatus('done');
      seedDismissTimer.current = setTimeout(dismissSeedLog, 3000);
    } catch (err) {
      appendLog(`Error: ${err.message}`, 'error');
      setStatus('error');
    }
  }

  async function handleGenerate() {
    if (!apiKey.trim()) return alert('Enter your Klaviyo private API key first.');
    const resolvedType = campaignType === 'Custom' ? customType.trim() : campaignType;
    if (!resolvedType) return alert('Enter a custom campaign type.');
    if (!brandName.trim()) return alert('Enter a brand name.');
    if (!productName.trim()) return alert('Enter a product or offer.');

    setGenerating(true);
    setCampaignStatus('running');
    setCampaignLog([]);
    setCampaignProgress(0);
    try {
      await streamSSE('/api/generate-campaign', {
        apiKey: apiKey.trim(),
        sessionId, // also send in case a session exists
        brandName: brandName.trim(),
        productName: productName.trim(),
        campaignType: resolvedType,
        tone,
        deliveryType,
        includeSMSBranch: deliveryType === 'Multi-step Flow' && includeConditionalSplit && includeSMS,
        includeConditionalSplit: deliveryType === 'Multi-step Flow' && includeConditionalSplit,
      }, {
        onProgress: data => {
          appendCampaignLog(data.message, 'progress');
          if (data.pct != null) setCampaignProgress(data.pct);
        },
        onDone: data => {
          appendCampaignLog(data.message, 'done');
          setCampaignProgress(100);
          setCampaignStatus('done');
        },
        onError: data => {
          appendCampaignLog(data.message, 'error');
          setCampaignStatus('error');
        },
      });
    } catch (err) {
      appendCampaignLog(`Error: ${err.message}`, 'error');
      setCampaignStatus('error');
    } finally {
      setGenerating(false);
    }
  }

  const isRunning = status === 'running';

  return (
    <div style={s.page}>
      <header style={s.header} role="banner">
        <div style={s.headerInner}>
          <KlaviyoMark />
          <span style={s.headerWordmark}>klaviyo</span>
          <span style={s.headerProduct}>Sandbox Seeder</span>
        </div>
      </header>

      <div style={s.card}>

        {/* Shared API key */}
        <div style={{ ...s.field, marginBottom: 24 }}>
          <label style={s.label}>Private API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="pk_live_..."
            style={s.input}
            disabled={isRunning || generating}
            autoComplete="off"
          />
          <span style={s.hint}>
            Klaviyo &rsaquo; Account &rsaquo; API Keys &rsaquo; Create Private API Key (full access)
          </span>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          <button
            onClick={() => setTab('seed')}
            style={{ ...s.tab, ...(tab === 'seed' ? s.tabActive : {}) }}
          >
            Seed data
          </button>
          <button
            onClick={() => setTab('generate')}
            style={{ ...s.tab, ...(tab === 'generate' ? s.tabActive : {}) }}
          >
            Generate campaign
          </button>
        </div>

        {/* ── Seed tab ── */}
        {tab === 'seed' && (
          <div style={s.tabPanel}>
            <p style={s.subtitle}>
              Populate your Klaviyo account with realistic customer profiles, lists, and event history.
            </p>

            <div style={{ ...s.field, ...(resetConfirm ? s.fieldDimmed : {}) }}>
              <label style={s.label}>Industry</label>
              <div style={s.industryGrid}>
                {INDUSTRIES.map(ind => (
                  <button
                    key={ind.scenario}
                    onClick={() => !isRunning && setIndustry(ind)}
                    disabled={isRunning}
                    style={{
                      ...s.industryBtn,
                      ...(industry.scenario === ind.scenario ? s.industryBtnActive : {}),
                    }}
                  >
                    <span style={{ ...s.industryName, ...(industry.scenario === ind.scenario ? s.industryNameActive : {}) }}>
                      {ind.label}
                    </span>
                    <span style={{ ...s.industryDesc, ...(industry.scenario === ind.scenario ? s.industryDescActive : {}) }}>
                      {ind.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ ...s.field, ...(resetConfirm ? s.fieldDimmed : {}) }}>
              <label style={s.label}>Profile Count</label>
              <div style={s.countRow}>
                {PROFILE_COUNTS.map(n => (
                  <button
                    key={n}
                    onClick={() => !isRunning && setProfileCount(n)}
                    disabled={isRunning}
                    style={{ ...s.countBtn, ...(profileCount === n ? s.countBtnActive : {}) }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span style={s.hint}>
                5 profiles uses quick mode (2 segments, minimal events) — ~1 min. Larger counts include full event history: 50 ≈ 20 min, 250 ≈ 90 min on the free tier (~55 req/min).
              </span>
            </div>

            <div style={s.actions}>
              <button
                onClick={handleSeed}
                disabled={isRunning || !apiKey.trim()}
                style={{ ...s.seedBtn, ...(isRunning || !apiKey.trim() ? s.btnDisabled : {}) }}
              >
                {isRunning ? 'Seeding...' : 'Seed Sandbox'}
              </button>

              {!resetConfirm ? (
                <button
                  onClick={() => setResetConfirm(true)}
                  disabled={isRunning || !apiKey.trim()}
                  style={{ ...s.resetBtn, ...(isRunning || !apiKey.trim() ? s.btnDisabled : {}) }}
                >
                  Reset
                </button>
              ) : (
                <div style={s.confirmRow}>
                  <span style={s.confirmText}>Delete all seeded data?</span>
                  <button onClick={handleReset} style={s.confirmYes}>Yes, reset</button>
                  <button onClick={() => setResetConfirm(false)} style={s.confirmNo}>Cancel</button>
                </div>
              )}
            </div>

            {status !== 'idle' && (
              <div style={{ marginTop: 28 }}>
                <div style={s.logHeader}>
                  <span style={s.logHeaderLabel}>Log</span>
                  <button onClick={() => setLog([])} style={s.logClearBtn}>Clear log</button>
                </div>
                <div ref={logRef} style={s.log}>
                  {log.map(entry => (
                    <div key={entry.id} style={{
                      ...s.logLine,
                      ...(entry.type === 'done'    ? s.logDone    : {}),
                      ...(entry.type === 'error'   ? s.logError   : {}),
                      ...(entry.type === 'divider' ? s.logDivider : {}),
                    }}>
                      {entry.msg}
                    </div>
                  ))}
                </div>
                <div style={s.progressWrap}>
                  <div style={s.progressTrack}>
                    <div style={{
                      ...s.progressFill,
                      width: `${progress}%`,
                      background: status === 'done' ? '#16a34a' : status === 'error' ? CORAL : BLACK,
                    }} />
                  </div>
                  {status === 'done' ? (
                    <button onClick={dismissSeedLog} style={s.progressDismiss}>Done ×</button>
                  ) : (
                    <span style={{ ...s.progressLabel, ...(status === 'error' ? { color: CORAL } : {}) }}>
                      {status === 'error' ? 'Error' : `${progress}%`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Generate tab ── */}
        {tab === 'generate' && (
          <div style={s.tabPanel}>
            <p style={s.subtitle}>
              Use Claude to write copy and create an email campaign in your sandbox.
            </p>

            <div style={s.field}>
              <label style={s.label}>Brand Name</label>
              <input
                type="text"
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="Arc & Thread"
                style={s.input}
                disabled={generating}
              />
            </div>

            <div style={s.field}>
              <label style={s.label}>Product / Offer</label>
              <input
                type="text"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="Summer Linen Collection — 20% off"
                style={s.input}
                disabled={generating}
              />
            </div>

            <div style={s.field}>
              <label style={s.label}>Campaign Type</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {CAMPAIGN_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => !generating && setCampaignType(t)}
                    disabled={generating}
                    style={{
                      ...s.countBtn,
                      flex: 'none',
                      padding: '9px 16px',
                      ...(campaignType === t ? s.countBtnActive : {}),
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {campaignType === 'Custom' && (
                <input
                  type="text"
                  value={customType}
                  onChange={e => setCustomType(e.target.value)}
                  placeholder="Describe your campaign..."
                  style={{ ...s.input, marginTop: 10 }}
                  disabled={generating}
                />
              )}
            </div>

            <div style={s.field}>
              <label style={s.label}>Tone</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {TONES.map(t => (
                  <button
                    key={t}
                    onClick={() => !generating && setTone(t)}
                    disabled={generating}
                    style={{
                      ...s.countBtn,
                      flex: 'none',
                      padding: '9px 16px',
                      textTransform: 'capitalize',
                      ...(tone === t ? s.countBtnActive : {}),
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={s.field}>
              <label style={s.label}>Delivery</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Email Campaign', 'Multi-step Flow'].map(d => (
                  <button
                    key={d}
                    onClick={() => !generating && setDeliveryType(d)}
                    disabled={generating}
                    style={{
                      ...s.countBtn,
                      flex: 'none',
                      padding: '9px 16px',
                      ...(deliveryType === d ? s.countBtnActive : {}),
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {deliveryType === 'Multi-step Flow' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  <label style={s.smsToggle}>
                    <input
                      type="checkbox"
                      checked={includeConditionalSplit}
                      onChange={e => {
                        if (!generating) {
                          setIncludeConditionalSplit(e.target.checked);
                          if (!e.target.checked) setIncludeSMS(false);
                        }
                      }}
                      disabled={generating}
                      style={{ width: 15, height: 15, accentColor: BLACK }}
                    />
                    <span>Include conditional split (routes by profile property)</span>
                  </label>
                  {includeConditionalSplit && (
                    <label style={{ ...s.smsToggle, paddingLeft: 23 }}>
                      <input
                        type="checkbox"
                        checked={includeSMS}
                        onChange={e => !generating && setIncludeSMS(e.target.checked)}
                        disabled={generating}
                        style={{ width: 15, height: 15, accentColor: BLACK }}
                      />
                      <span>SMS branch for consented subscribers</span>
                    </label>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !apiKey.trim() || !brandName.trim() || !productName.trim()}
              style={{
                ...s.seedBtn,
                ...((generating || !apiKey.trim() || !brandName.trim() || !productName.trim()) ? s.btnDisabled : {}),
              }}
            >
              {generating ? 'Generating...' : 'Generate Campaign'}
            </button>

            {campaignStatus !== 'idle' && (
              <div style={{ marginTop: 20 }}>
                <div style={s.logHeader}>
                  <span style={s.logHeaderLabel}>Log</span>
                  <button
                    onClick={() => { setCampaignLog([]); setCampaignStatus('idle'); setCampaignProgress(0); }}
                    style={s.logClearBtn}
                  >
                    Clear log
                  </button>
                </div>
                <div ref={campaignLogRef} style={s.log}>
                  {campaignLog.map(entry => (
                    <div key={entry.id} style={{
                      ...s.logLine,
                      ...(entry.type === 'done'  ? s.logDone  : {}),
                      ...(entry.type === 'error' ? s.logError : {}),
                    }}>
                      {entry.msg}
                    </div>
                  ))}
                </div>
                <div style={s.progressWrap}>
                  <div style={s.progressTrack}>
                    <div style={{
                      ...s.progressFill,
                      width: `${campaignProgress}%`,
                      background: campaignStatus === 'done' ? '#16a34a' : campaignStatus === 'error' ? CORAL : BLACK,
                    }} />
                  </div>
                  {campaignStatus === 'done' ? (
                    <button
                      onClick={() => { setCampaignStatus('idle'); setCampaignLog([]); setCampaignProgress(0); }}
                      style={s.progressDismiss}
                    >
                      Done ×
                    </button>
                  ) : (
                    <span style={{ ...s.progressLabel, ...(campaignStatus === 'error' ? { color: CORAL } : {}) }}>
                      {campaignStatus === 'error' ? 'Error' : `${campaignProgress}%`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// Klaviyo brand tokens
const BLACK  = '#0D0D0D';
const CREAM  = '#F2EDE3';
const WHITE  = '#FFFFFF';
const CORAL  = '#E8452A'; // Klaviyo accent (logo underline / error states)
const BORDER = '#D8D2C8';

const s = {
  // ── Layout ───────────────────────────────────────────────
  page: {
    minHeight: '100vh',
    background: CREAM,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    boxSizing: 'border-box',
  },

  // ── Header ───────────────────────────────────────────────
  header: {
    width: '100%',
    background: BLACK,
    padding: '0 24px',
  },
  headerInner: {
    maxWidth: 640,
    margin: '0 auto',
    height: 52,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headerWordmark: {
    color: WHITE,
    fontSize: 19,
    fontWeight: 800,
    letterSpacing: '-0.04em',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  headerProduct: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: 400,
    paddingLeft: 10,
    borderLeft: '1px solid rgba(255,255,255,0.2)',
    marginLeft: 2,
  },

  // ── Card ─────────────────────────────────────────────────
  card: {
    background: WHITE,
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    padding: '36px 40px',
    width: '100%',
    maxWidth: 560,
    marginTop: 40,
    marginBottom: 80,
    boxSizing: 'border-box',
  },
  title: {
    fontSize: 24,
    fontWeight: 800,
    color: BLACK,
    margin: '0 0 8px',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 14,
    color: '#5A5550',
    margin: '0 0 32px',
    lineHeight: 1.55,
  },

  // ── Form fields ──────────────────────────────────────────
  field: {
    marginBottom: 28,
  },
  fieldDimmed: {
    opacity: 0.3,
    pointerEvents: 'none',
  },
  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    color: BLACK,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  hint: {
    display: 'block',
    fontSize: 11,
    color: '#8A847C',
    marginTop: 7,
    lineHeight: 1.45,
  },
  input: {
    width: '100%',
    padding: '10px 13px',
    fontSize: 14,
    fontFamily: '"SF Mono", "Fira Code", Menlo, monospace',
    border: `1.5px solid ${BORDER}`,
    borderRadius: 4,
    outline: 'none',
    boxSizing: 'border-box',
    color: BLACK,
    background: WHITE,
  },

  // ── Industry pills ───────────────────────────────────────
  industryGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  industryBtn: {
    textAlign: 'left',
    padding: '11px 16px',
    border: `1.5px solid ${BORDER}`,
    borderRadius: 100,
    background: WHITE,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  industryBtnActive: {
    border: `1.5px solid ${BLACK}`,
    background: BLACK,
  },
  industryName: {
    fontSize: 13,
    fontWeight: 600,
    color: BLACK,
  },
  industryNameActive: {
    color: WHITE,
  },
  industryDesc: {
    fontSize: 12,
    color: '#8A847C',
  },
  industryDescActive: {
    color: 'rgba(255,255,255,0.55)',
  },

  // ── Count pills ──────────────────────────────────────────
  countRow: {
    display: 'flex',
    gap: 8,
  },
  countBtn: {
    flex: 1,
    padding: '9px 0',
    border: `1.5px solid ${BORDER}`,
    borderRadius: 100,
    background: WHITE,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: BLACK,
  },
  countBtnActive: {
    border: `1.5px solid ${BLACK}`,
    background: BLACK,
    color: WHITE,
    fontWeight: 700,
  },

  // ── Actions ──────────────────────────────────────────────
  actions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  seedBtn: {
    flex: 1,
    padding: '12px 24px',
    background: BLACK,
    color: WHITE,
    border: `1.5px solid ${BLACK}`,
    borderRadius: 100,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    minWidth: 140,
    letterSpacing: '-0.01em',
  },
  resetBtn: {
    padding: '12px 20px',
    background: WHITE,
    color: BLACK,
    border: `1.5px solid ${BORDER}`,
    borderRadius: 100,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  confirmText: {
    fontSize: 13,
    color: CORAL,
    fontWeight: 500,
  },
  confirmYes: {
    background: CORAL,
    color: WHITE,
    border: 'none',
    borderRadius: 100,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  confirmNo: {
    background: WHITE,
    color: BLACK,
    border: `1px solid ${BORDER}`,
    borderRadius: 100,
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },

  // ── Log ──────────────────────────────────────────────────
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  logHeaderLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: BLACK,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  logClearBtn: {
    background: 'none',
    border: 'none',
    fontSize: 11,
    color: '#8A847C',
    cursor: 'pointer',
    padding: '2px 0',
    fontWeight: 500,
  },
  log: {
    background: WHITE,
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    height: 120,
    overflowY: 'auto',
    fontSize: 13,
    lineHeight: 1.55,
    paddingTop: 6,
    paddingBottom: 6,
  },
  logLine: {
    padding: '3px 16px',
    color: '#6B6158',
  },
  logDone: {
    padding: '10px 16px',
    color: '#166534',
    fontWeight: 700,
    background: '#F0FDF4',
    borderTop: '1px solid #D1FAE5',
    marginTop: 4,
  },
  logError: {
    padding: '10px 16px',
    color: CORAL,
    fontWeight: 700,
    background: '#FFF5F3',
    borderTop: `1px solid #FECACA`,
    marginTop: 4,
  },
  logDivider: {
    padding: '7px 16px',
    color: '#B0A89C',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    borderTop: `1px solid ${BORDER}`,
    borderBottom: `1px solid ${BORDER}`,
    marginTop: 6,
    marginBottom: 2,
    background: CREAM,
  },

  // ── Progress bar ─────────────────────────────────────────
  progressWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    background: BORDER,
    borderRadius: 100,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: BLACK,
    borderRadius: 100,
    transition: 'width 0.6s ease',
  },
  progressLabel: {
    fontSize: 12,
    color: '#8A847C',
    minWidth: 40,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  progressDismiss: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: 600,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    minWidth: 40,
    textAlign: 'right',
  },

  // ── Campaign section ──────────────────────────────────────
  // ── Tabs ─────────────────────────────────────────────────
  tabs: {
    display: 'flex',
    borderBottom: `1.5px solid ${BORDER}`,
    marginBottom: 28,
    gap: 0,
  },
  tab: {
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: '#8A847C',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    marginBottom: -1.5,
    letterSpacing: '-0.01em',
  },
  tabActive: {
    color: BLACK,
    borderBottom: `2px solid ${BLACK}`,
  },
  tabPanel: {
    // no extra padding needed — fields provide their own spacing
  },

  campaignSection: {
    marginTop: 36,
    paddingTop: 32,
    borderTop: `1px solid ${BORDER}`,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: BLACK,
    margin: '0 0 6px',
    letterSpacing: '-0.02em',
  },
  smsToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    cursor: 'pointer',
    fontSize: 13,
    color: BLACK,
    userSelect: 'none',
  },
};
