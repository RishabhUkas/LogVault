/* =========================================================================
   LogVault frontend
   Talks to the Flask API and renders the dashboard, blockchain viewer,
   attacker simulation and verification views.
   ========================================================================= */

const state = {
  logs: [],
  blocks: [],
  selectedBlockIndex: null,
};

// -------------------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------------------

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function shortHash(h, n = 10) {
  if (!h) return '—';
  return h.slice(0, n) + '…';
}

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour12: false });
  } catch { return iso; }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status})` }));
    throw new Error(err.error || `Request failed (HTTP ${res.status})`);
  }
  return res.json();
}

function showAlert({ title, body, success = false, timeout = 7000 }) {
  const stack = $('#alert-stack');
  const card = document.createElement('div');
  card.className = 'alert-card' + (success ? ' success' : '');
  card.innerHTML = `
    <button class="alert-close">&times;</button>
    <div class="alert-title">${title}</div>
    <div class="alert-body">${body}</div>
  `;
  card.querySelector('.alert-close').addEventListener('click', () => card.remove());
  stack.appendChild(card);
  if (timeout) setTimeout(() => card.remove(), timeout);
}

// -------------------------------------------------------------------------
// Navigation
// -------------------------------------------------------------------------

function initNav() {
  $all('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.nav-item').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const view = btn.dataset.view;
      $all('.view').forEach(v => v.classList.remove('is-active'));
      $(`#view-${view}`).classList.add('is-active');
    });
  });
}

// -------------------------------------------------------------------------
// Overview: stats + events table + activity feed
// -------------------------------------------------------------------------

async function refreshStats() {
  const { stats } = await api('/api/stats');
  $('#stat-total').textContent = stats.total_events;
  $('#stat-critical').textContent = stats.critical_events;
  $('#stat-blocks').textContent = stats.blockchain_blocks;
  $('#stat-verified').textContent = stats.verified_logs;
  $('#stat-tampered').textContent = stats.tampered_logs;
  $('#stat-missing').textContent = stats.missing_logs;

  const chainStatus = $('#status-chain');
  const integrityStatus = $('#status-integrity');
  const chainOk = stats.chain_valid;
  const integrityOk = stats.tampered_logs === 0 && stats.missing_logs === 0;

  chainStatus.classList.toggle('is-bad', !chainOk);
  chainStatus.querySelector('em').textContent = chainOk ? 'VALID' : 'INVALID';
  integrityStatus.classList.toggle('is-bad', !integrityOk);
  integrityStatus.querySelector('em').textContent = integrityOk ? 'VERIFIED' : 'COMPROMISED';
}

async function refreshLogs() {
  const { logs } = await api('/api/logs');
  state.logs = logs;
  const body = $('#events-table-body');
  $('#events-count').textContent = `${logs.length} event${logs.length === 1 ? '' : 's'}`;

  if (logs.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">No events yet — generate one to begin.</td></tr>`;
    return;
  }

  body.innerHTML = logs.slice().reverse().map(l => `
    <tr>
      <td>${fmtTime(l.timestamp)}</td>
      <td>${l.event_id}</td>
      <td>${l.source_ip}</td>
      <td>${l.event_type}</td>
      <td><span class="pill pill-${l.severity}">${l.severity}</span></td>
      <td class="status-ok">✓</td>
    </tr>
  `).join('');
}

function activityIcon(level) {
  return { alert: '⚠', attack: '🚨', success: '✓', info: '›' }[level] || '›';
}

function activityClass(level) {
  return { alert: 'activity-alert', attack: 'activity-attack', success: 'activity-success' }[level] || '';
}

async function refreshActivity() {
  const { activity } = await api('/api/activity');
  const list = $('#activity-list');
  const attackList = $('#attack-log-list');

  if (activity.length === 0) {
    list.innerHTML = `<li class="activity-empty">No activity yet.</li>`;
    attackList.innerHTML = `<li class="activity-empty">No attacks simulated yet.</li>`;
    return;
  }

  list.innerHTML = activity.map(a => `
    <li class="${activityClass(a.level)}">
      <span class="activity-time">${fmtTime(a.timestamp)}</span>
      <span>${activityIcon(a.level)} ${a.message}</span>
    </li>
  `).join('');

  const attacks = activity.filter(a => a.level === 'attack');
  attackList.innerHTML = attacks.length
    ? attacks.map(a => `
        <li class="activity-attack">
          <span class="activity-time">${fmtTime(a.timestamp)}</span>
          <span>${a.message}</span>
        </li>
      `).join('')
    : `<li class="activity-empty">No attacks simulated yet.</li>`;
}

async function refreshOverview() {
  await Promise.all([refreshStats(), refreshLogs(), refreshActivity()]);
}

// -------------------------------------------------------------------------
// Blockchain view
// -------------------------------------------------------------------------

async function refreshBlockchain(validation) {
  const { blocks } = await api('/api/blockchain');
  state.blocks = blocks;
  $('#chain-count').textContent = `${blocks.length} block${blocks.length === 1 ? '' : 's'}`;

  const brokenIndexes = new Set((validation?.broken_links || []).map(b => b.block_index));

  const list = $('#chain-list');
  list.innerHTML = blocks.map((b, i) => {
    const isGenesis = b.log_id === 'GENESIS';
    const isBroken = brokenIndexes.has(b.block_index);
    const linkBroken = i > 0 && brokenIndexes.has(b.block_index);
    return `
      ${i > 0 ? `<div class="chain-link ${linkBroken ? 'is-broken' : ''}">│<br>${linkBroken ? '✕ broken link' : '▼'}</div>` : ''}
      <div class="block-card ${isGenesis ? 'is-genesis' : ''} ${isBroken ? 'is-broken' : ''}" data-index="${b.block_index}">
        <div class="block-card-top">
          <span class="block-card-index">${isGenesis ? 'GENESIS' : `BLOCK #${b.block_index}`}</span>
          <span class="block-card-logid">${b.log_id}</span>
        </div>
        <div class="block-card-hash">hash: ${shortHash(b.block_hash)}</div>
        <div class="block-card-hash">prev: ${shortHash(b.previous_hash)}</div>
      </div>
    `;
  }).join('');

  $all('.block-card', list).forEach(card => {
    card.addEventListener('click', () => selectBlock(parseInt(card.dataset.index, 10)));
  });

  if (state.selectedBlockIndex !== null) {
    selectBlock(state.selectedBlockIndex, false);
  }
}

function selectBlock(index, scroll = true) {
  state.selectedBlockIndex = index;
  $all('.block-card').forEach(c => c.classList.toggle('is-selected', parseInt(c.dataset.index, 10) === index));

  const block = state.blocks.find(b => b.block_index === index);
  const detail = $('#block-detail');
  if (!block) {
    detail.className = 'block-detail-empty';
    detail.innerHTML = 'Select a block to inspect its fields.';
    return;
  }
  detail.className = '';
  detail.innerHTML = `
    <div class="detail-row"><span class="detail-label">Index</span><span class="detail-value">${block.block_index}</span></div>
    <div class="detail-row"><span class="detail-label">Log ID</span><span class="detail-value">${block.log_id}</span></div>
    <div class="detail-row"><span class="detail-label">Timestamp</span><span class="detail-value">${block.timestamp}</span></div>
    <div class="detail-row"><span class="detail-label">Log hash</span><span class="detail-value">${block.log_hash}</span></div>
    <div class="detail-row"><span class="detail-label">Previous hash</span><span class="detail-value">${block.previous_hash}</span></div>
    <div class="detail-row"><span class="detail-label">Block hash</span><span class="detail-value">${block.block_hash}</span></div>
  `;
}

// -------------------------------------------------------------------------
// Verification view
// -------------------------------------------------------------------------

function renderVerifySummary(report) {
  const s = report.summary;
  const el = $('#verify-summary');
  el.className = 'verify-summary';
  el.innerHTML = `
    <div class="verify-summary-card ok">
      <span class="num">${s.authentic}</span><span class="label">Authentic</span>
    </div>
    <div class="verify-summary-card ${s.modified ? 'bad' : ''}">
      <span class="num">${s.modified}</span><span class="label">Modified</span>
    </div>
    <div class="verify-summary-card ${s.deleted ? 'bad' : ''}">
      <span class="num">${s.deleted}</span><span class="label">Deleted</span>
    </div>
    <div class="verify-summary-card ${s.chain_valid ? 'ok' : 'bad'}">
      <span class="num">${s.chain_valid ? 'VALID' : 'BROKEN'}</span><span class="label">Chain status</span>
    </div>
  `;
}

function renderVerifyTable(report) {
  const body = $('#verify-table-body');
  if (report.results.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">No logs to verify yet.</td></tr>`;
    return;
  }
  body.innerHTML = report.results.map(r => `
    <tr>
      <td>${r.event_id}</td>
      <td class="hash-cell">${shortHash(r.local_hash)}</td>
      <td class="hash-cell">${shortHash(r.blockchain_hash)}</td>
      <td><span class="pill pill-${r.result}">${r.result.replace(/_/g, ' ')}</span></td>
    </tr>
  `).join('');
}

async function runVerification({ silent = false } = {}) {
  const report = await api('/api/verify', { method: 'POST' });
  renderVerifySummary(report);
  renderVerifyTable(report);
  await refreshBlockchain(report.chain_status);
  await refreshStats();

  if (!silent) {
    const s = report.summary;
    if (s.modified === 0 && s.deleted === 0 && s.chain_valid) {
      showAlert({ title: '✓ ALL LOGS VERIFIED', body: `${s.authentic} log(s) checked. Every hash matches its blockchain record.`, success: true });
    } else {
      const parts = [];
      if (s.modified) parts.push(`<b>${s.modified}</b> log(s) with hash mismatches (tampering)`);
      if (s.deleted) parts.push(`<b>${s.deleted}</b> log(s) missing from local storage (deletion)`);
      if (!s.chain_valid) parts.push(`blockchain link integrity <b>failed</b>`);
      showAlert({ title: '🚨 INTEGRITY ISSUES FOUND', body: parts.join('<br>') });
    }
  }
  return report;
}

// -------------------------------------------------------------------------
// Actions: event generation
// -------------------------------------------------------------------------

async function generateEvent() {
  const { event } = await api('/api/generate_event', { method: 'POST' });
  await refreshOverview();
  await refreshBlockchain();
}

async function generateIntrusion() {
  const { event } = await api('/api/generate_intrusion', { method: 'POST' });
  await refreshOverview();
  await refreshBlockchain();
  showAlert({ title: `⚠ ${event.event_type} DETECTED`, body: `${event.event_id} from ${event.source_ip} — severity ${event.severity}. Fingerprint committed to block chain.` });
}

// -------------------------------------------------------------------------
// Actions: attacker simulation
// -------------------------------------------------------------------------

const ATTACK_ENDPOINTS = {
  modify: '/api/attack/modify',
  timestamp: '/api/attack/change_timestamp',
  delete: '/api/attack/delete',
  tamper_blockchain: '/api/attack/tamper_blockchain',
};

const MODIFIABLE_FIELDS = [
  { value: 'severity', label: 'severity' },
  { value: 'timestamp', label: 'timestamp' },
  { value: 'username', label: 'username' },
  { value: 'description', label: 'description' },
  { value: 'source_ip', label: 'source_ip' },
];

function logOptionsHtml() {
  if (state.logs.length === 0) return '';
  return state.logs.slice().reverse().map(l =>
    `<option value="${l.event_id}">${l.event_id} — ${l.event_type} (${l.severity})</option>`
  ).join('');
}

function blockOptionsHtml() {
  const real = state.blocks.filter(b => b.log_id !== 'GENESIS');
  if (real.length === 0) return '';
  return real.map(b =>
    `<option value="${b.block_index}">Block #${b.block_index} — ${b.log_id}</option>`
  ).join('');
}

/**
 * Open the attacker-input modal for a given attack kind, populated with the
 * current logs/blocks so the person can choose exactly what to target and
 * what value to write, rather than the app picking one at random.
 */
function openAttackModal(kind) {
  const backdrop = $('#modal-backdrop');
  const title = $('#modal-title');
  const body = $('#modal-body');

  if (kind !== 'tamper_blockchain' && state.logs.length === 0) {
    title.textContent = 'No logs to attack';
    body.innerHTML = `<p class="modal-empty-warning">There are no logs yet. Go to Overview and click "Generate event" or "Simulate intrusion" first.</p>`;
    $('#modal-confirm').style.display = 'none';
    backdrop.classList.add('is-open');
    return;
  }
  if (kind === 'tamper_blockchain' && state.blocks.filter(b => b.log_id !== 'GENESIS').length === 0) {
    title.textContent = 'No blocks to attack';
    body.innerHTML = `<p class="modal-empty-warning">There are no non-genesis blocks yet. Generate at least one event first.</p>`;
    $('#modal-confirm').style.display = 'none';
    backdrop.classList.add('is-open');
    return;
  }

  $('#modal-confirm').style.display = '';

  if (kind === 'modify') {
    title.textContent = 'Modify log';
    body.innerHTML = `
      <div class="field-group">
        <label>Target event</label>
        <select id="f-event-id">${logOptionsHtml()}</select>
      </div>
      <div class="field-group">
        <label>Field to change</label>
        <select id="f-field">${MODIFIABLE_FIELDS.map(f => `<option value="${f.value}">${f.label}</option>`).join('')}</select>
      </div>
      <div class="field-group">
        <label>New value</label>
        <input type="text" id="f-value" placeholder="Leave blank for a random value">
        <span class="field-hint">This will be written directly to the local log without updating its blockchain record — that mismatch is what verification detects.</span>
      </div>
    `;
  } else if (kind === 'timestamp') {
    title.textContent = 'Change timestamp';
    body.innerHTML = `
      <div class="field-group">
        <label>Target event</label>
        <select id="f-event-id">${logOptionsHtml()}</select>
      </div>
      <div class="field-group">
        <label>New timestamp (ISO 8601)</label>
        <input type="text" id="f-value" placeholder="Leave blank to use the current time">
        <span class="field-hint">e.g. 2026-01-01T00:00:00+00:00</span>
      </div>
    `;
  } else if (kind === 'delete') {
    title.textContent = 'Delete log';
    body.innerHTML = `
      <div class="field-group">
        <label>Target event</label>
        <select id="f-event-id">${logOptionsHtml()}</select>
      </div>
      <span class="field-hint">This removes the log from local storage only. Its blockchain fingerprint remains, which is what makes the deletion detectable.</span>
    `;
  } else if (kind === 'tamper_blockchain') {
    title.textContent = 'Tamper blockchain';
    body.innerHTML = `
      <div class="field-group">
        <label>Target block</label>
        <select id="f-block-index">${blockOptionsHtml()}</select>
      </div>
      <div class="field-group">
        <label>New previous_hash</label>
        <input type="text" id="f-value" placeholder="Leave blank for a forged random hash">
        <span class="field-hint">Rewriting this field breaks the link to the prior block — chain validation will flag it.</span>
      </div>
    `;
  }

  backdrop.dataset.kind = kind;
  backdrop.classList.add('is-open');
}

function closeAttackModal() {
  $('#modal-backdrop').classList.remove('is-open');
}

async function confirmAttack() {
  const kind = $('#modal-backdrop').dataset.kind;
  const payload = {};

  const eventIdField = $('#f-event-id');
  const blockIndexField = $('#f-block-index');
  const valueField = $('#f-value');
  const fieldField = $('#f-field');

  if (eventIdField) payload.event_id = eventIdField.value;
  if (blockIndexField) payload.block_index = parseInt(blockIndexField.value, 10);
  if (fieldField) payload.field = fieldField.value;
  if (valueField) payload.value = valueField.value;

  try {
    const result = await api(ATTACK_ENDPOINTS[kind], { method: 'POST', body: payload });
    closeAttackModal();
    await refreshOverview();
    await refreshBlockchain();

    if (kind === 'modify') {
      showAlert({ title: '🚨 LOG TAMPERING SIMULATED', body: `Event <b>${result.event_id}</b>: field <b>${result.field}</b> changed<br>from "${result.old_value}" to "${result.new_value}".<br>Blockchain record left untouched. Run verification to detect it.` });
    } else if (kind === 'timestamp') {
      showAlert({ title: '🚨 TIMESTAMP ALTERED', body: `Event <b>${result.event_id}</b> timestamp changed<br>from "${result.old_value}" to "${result.new_value}".<br>Run verification to detect the mismatch.` });
    } else if (kind === 'delete') {
      showAlert({ title: '🚨 LOG DELETION SIMULATED', body: `Event <b>${result.event_id}</b> removed from local storage.<br>Its blockchain record still exists. Run verification to detect it.` });
    } else if (kind === 'tamper_blockchain') {
      showAlert({ title: '🚨 BLOCKCHAIN TAMPERED', body: `Block <b>#${result.block_index}</b> previous_hash was rewritten directly.<br>This breaks the chain link — run verification to see it flagged.` });
    }
  } catch (e) {
    showAlert({ title: 'Attack could not run', body: e.message });
  }
}

// -------------------------------------------------------------------------
// Demo mode
// -------------------------------------------------------------------------

async function runFullDemo() {
  const btn = $('#run-demo-btn');
  btn.disabled = true;
  btn.textContent = 'Running demo…';
  try {
    const result = await api('/api/demo', { method: 'POST' });
    await refreshOverview();
    await refreshBlockchain(result.post_attack_report.chain_status);

    renderVerifySummary(result.post_attack_report);
    renderVerifyTable(result.post_attack_report);

    const stepList = result.steps.map(s => `<b>${s.step}</b> — ${s.detail}`).join('<br><br>');
    showAlert({
      title: '🎬 FULL ATTACK DEMO COMPLETE',
      body: stepList,
      timeout: 15000,
    });

    // Switch to verification view so the person sees the outcome
    $(`.nav-item[data-view="verify"]`).click();
  } catch (e) {
    showAlert({ title: 'Demo failed', body: e.message });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run full attack demo';
  }
}

// -------------------------------------------------------------------------
// Reset
// -------------------------------------------------------------------------

async function resetSystem() {
  if (!confirm('Reset LogVault? This clears all logs and blockchain blocks and starts fresh from a new genesis block.')) return;
  await api('/api/reset', { method: 'POST' });
  state.selectedBlockIndex = null;
  await refreshOverview();
  await refreshBlockchain();
  $('#verify-summary').className = 'verify-summary-empty';
  $('#verify-summary').innerHTML = 'Run a verification sweep to see results here.';
  $('#verify-table-body').innerHTML = `<tr class="empty-row"><td colspan="4">No verification run yet.</td></tr>`;
  showAlert({ title: 'System reset', body: 'Fresh genesis block created. All logs cleared.', success: true });
}

// -------------------------------------------------------------------------
// Wire up + boot
// -------------------------------------------------------------------------

function initActions() {
  $('#gen-event-btn').addEventListener('click', generateEvent);
  $('#gen-intrusion-btn').addEventListener('click', generateIntrusion);
  $('#verify-btn').addEventListener('click', () => runVerification());
  $('#run-demo-btn').addEventListener('click', runFullDemo);
  $('#reset-btn').addEventListener('click', resetSystem);

  $all('.attack-card').forEach(card => {
    card.addEventListener('click', () => openAttackModal(card.dataset.attack));
  });

  $('#modal-close').addEventListener('click', closeAttackModal);
  $('#modal-cancel').addEventListener('click', closeAttackModal);
  $('#modal-confirm').addEventListener('click', confirmAttack);
  $('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeAttackModal();
  });
}

async function boot() {
  initNav();
  initActions();
  await refreshOverview();
  await refreshBlockchain();
}

document.addEventListener('DOMContentLoaded', boot);
