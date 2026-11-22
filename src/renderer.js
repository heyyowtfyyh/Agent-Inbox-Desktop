import { groupByProject, monitoringView, statusLabels, viewOf } from './model.js';
import { createAvatar } from './avatar/index.js';

let avatarTheme = await window.inbox.avatarTheme();
let avatarStyle = await loadAvatarStyle(avatarTheme.assetBase);
const avatarSelect = document.querySelector('#avatar-theme');
if (avatarTheme.personalAvailable) {
  avatarSelect.prepend(new Option('Personal (auto)', 'auto'));
}
avatarSelect.value = avatarTheme.personalAvailable ? avatarTheme.preference : 'open-source';
avatarSelect.disabled = !avatarTheme.personalAvailable;

async function loadAvatarStyle(base) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = `${base}theme.css`;
  // Load before changing the active theme, so failure leaves the old view intact.
  style.media = 'not all';
  await new Promise((resolve, reject) => {
    style.onload = resolve;
    style.onerror = () => { style.remove(); reject(new Error('Avatar stylesheet could not be loaded.')); };
    document.head.append(style);
  });
  return style;
}
avatarStyle.media = 'all';

const list = document.querySelector('#sessions');
const filter = document.querySelector('#status-filter');
const menu = document.querySelector('#session-menu');
const pinAction = document.querySelector('#toggle-pin');
const editorAction = document.querySelector('#open-vscode');
const message = document.querySelector('#navigation-message');
const sourceInfo = document.querySelector('#source-info');
const monitoringBadge = document.querySelector('#monitoring-status');
const monitoringLabel = document.querySelector('#monitoring-label');
const monitoringDetail = document.querySelector('#monitoring-detail');
const runningMetric = document.querySelector('#running-count').parentElement;
const tabs = [...document.querySelectorAll('[data-view]')];
const collapsed = new Set();
const projectOrder = new Map();
let snapshot = { sessions: [], source: 'loading', runtimeAvailable: false, unreadAvailable: false };
let signature;
let view = 'inbox';
let menuTarget;
let polling = false;
let runtimeRefreshPending = false;
let pinPending = false;

avatarSelect.addEventListener('change', async () => {
  closeMenu();
  const preference = avatarSelect.value;
  const base = `avatar/${preference === 'auto' ? 'personal' : 'open-source'}/`;
  const restoreFocus = document.activeElement === avatarSelect;
  avatarSelect.disabled = true;
  let nextStyle;
  try {
    nextStyle = await loadAvatarStyle(base);
    const next = await window.inbox.setAvatarTheme(preference);
    avatarStyle.remove();
    avatarStyle = nextStyle;
    avatarTheme = next;
    avatarStyle.media = 'all';
    render();
  } catch {
    nextStyle?.remove();
    avatarSelect.value = avatarTheme.preference;
    showMessage('Avatar theme could not be changed.', 'Your previous theme is still active. Please try again.');
  } finally {
    avatarSelect.disabled = !avatarTheme.personalAvailable;
    if (restoreFocus) avatarSelect.focus({ preventScroll: true });
  }
});

function element(tag, classes, content) {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  if (content !== undefined) node.textContent = content;
  return node;
}

function icon(name) {
  const image = element('img', 'icon');
  image.src = `assets/${name}.svg`;
  image.alt = '';
  return image;
}

function button(classes, label, action) {
  const node = element('button', classes);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  node.addEventListener('click', action);
  return node;
}

function closeMenu(restoreFocus = false) {
  if (!menuTarget) return;
  const { trigger } = menuTarget;
  menuTarget = null;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
  if (runtimeRefreshPending) void refresh();
}

function openMenu(session, trigger) {
  if (menuTarget?.trigger === trigger) return closeMenu(true);
  closeMenu();
  menuTarget = { session, trigger };
  pinAction.querySelector('span').textContent = session.pinned ? 'Unpin' : 'Pin';
  pinAction.querySelector('img').src = session.pinned ? 'assets/push-pin-slash.svg' : 'assets/push-pin.svg';
  pinAction.disabled = pinPending || session.pinned === null;
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  const bounds = trigger.getBoundingClientRect();
  const left = Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8));
  const below = bounds.bottom + 5;
  const top = below + menu.offsetHeight <= innerHeight - 8 ? below : bounds.top - menu.offsetHeight - 5;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  (pinAction.disabled ? editorAction : pinAction).focus();
}

function showMessage(title, detail, reference = '') {
  if (message.open) return;
  document.querySelector('#navigation-title').textContent = title;
  document.querySelector('#navigation-detail').textContent = detail;
  const referenceNode = document.querySelector('#navigation-reference');
  referenceNode.textContent = reference;
  referenceNode.hidden = !reference;
  message.showModal();
}

async function navigate(destination, session) {
  let result;
  try {
    result = await window.inbox.open(destination, session.id);
  } catch {
    result = { ok: false, message: 'Navigation is temporarily unavailable.' };
  }
  if (result.ok) return;
  const codex = destination === 'codex';
  const detail = snapshot.sample ? session.title
    : codex ? `Find “${session.title}” in Codex Desktop by title or session ID.` : session.title;
  showMessage(result.message, detail, (codex ? session.id : session.cwd) ?? '');
}

function avatar(session) {
  return createAvatar(session, avatarTheme);
}

function runtimeBadge(runtime, compact) {
  const label = compact && runtime === 'input'
    ? 'User input' : statusLabels[runtime] ?? 'Unknown';
  const node = element('span', `badge runtime-${runtime}`, label);
  node.title = label;
  if (runtime === 'running') {
    const spinner = icon(compact ? 'card-running-spinner' : 'row-running-spinner');
    spinner.classList.add('running-spinner');
    node.prepend(spinner);
  }
  return node;
}

function timeLabel(value, compact) {
  if (value === null) return '—';
  const minutes = Math.floor(Math.max(0, Date.now() - value) / 60_000);
  if (minutes === 0) return compact ? 'Now' : 'Just now';
  const [amount, unit] = minutes < 60 ? [minutes, 'm']
    : minutes < 1440 ? [Math.floor(minutes / 60), 'h'] : [Math.floor(minutes / 1440), 'd'];
  return `${amount}${unit}${compact ? '' : ' ago'}`;
}

function sessionNode(session, compact) {
  const card = element('article', compact ? 'session-card' : 'session-row');
  const title = element('h3', 'session-title', session.title);
  title.title = session.title;
  const more = button('more', `More actions for ${session.title}`, () => openMenu(session, more));
  more.dataset.session = session.id;
  more.dataset.action = 'more';
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', menu.id);
  more.append(icon(compact ? 'card-menu' : 'row-menu'));
  const codex = button(compact ? 'avatar-button' : 'codex-link', `Open in Codex: ${session.title}`, () => navigate('codex', session));
  codex.dataset.session = session.id;
  codex.dataset.action = 'codex';
  const meta = element('div', 'metadata');
  const showUnread = session.unread === true && (!compact || session.runtime === 'idle' || session.runtime === 'unknown');
  if (!showUnread || (!compact && session.runtime !== 'idle')) {
    meta.append(runtimeBadge(session.runtime, compact));
  }
  const time = element('time', 'activity', timeLabel(session.lastActivity, compact));
  if (session.lastActivity !== null) {
    time.dataset.activity = String(session.lastActivity);
    time.dataset.compact = String(compact);
    const date = new Date(session.lastActivity);
    time.dateTime = date.toISOString();
    time.title = date.toLocaleString();
  } else time.title = 'Last activity unavailable';
  if (showUnread) {
    meta.append(element('span', 'badge unread', 'Unread'));
  }
  meta.append(time);

  if (compact) {
    const hint = element('span', 'avatar-hint');
    hint.append(icon('avatar-link'));
    codex.append(avatar(session), hint);
    card.append(codex, more, title, meta);
  } else {
    const content = element('div', 'row-content');
    const headline = element('div', 'row-headline');
    const details = element('div', 'row-details');
    codex.append('Open in Codex', icon('codex-link'));
    headline.append(title, more);
    details.append(meta, codex);
    content.append(headline, details);
    card.append(avatar(session), content);
  }
  return card;
}

function projectNode(key, project, compact, index) {
  const section = element('section', 'project');
  const content = element('div', compact ? 'project-grid' : 'project-rows');
  content.id = `project-sessions-${index}`;
  content.hidden = collapsed.has(key);
  const toggle = button('project-heading', `${project.name}, ${project.sessions.length} sessions`, () => {
    content.hidden = !content.hidden;
    toggle.setAttribute('aria-expanded', String(!content.hidden));
    if (content.hidden) collapsed.add(key);
    else collapsed.delete(key);
  });
  toggle.setAttribute('aria-expanded', String(!content.hidden));
  toggle.setAttribute('aria-controls', content.id);
  toggle.append(icon('chevron'), icon('folder'), element('span', 'project-name', project.name),
    element('span', 'project-count', String(project.sessions.length)));
  const heading = element('h2');
  heading.append(toggle);
  content.append(...project.sessions.map(session => sessionNode(session, compact)));
  section.append(heading, content);
  return section;
}

function notice(title, detail) {
  const node = element('div', 'notice');
  node.append(element('h2', null, title), element('p', null, detail));
  return node;
}

function render() {
  const focused = document.activeElement?.dataset;
  const previousScroll = list.scrollTop;
  const model = viewOf(snapshot, view, filter.value);
  const monitoring = monitoringView(snapshot.monitoring);
  monitoringBadge.dataset.status = monitoring.status;
  if (monitoringLabel.textContent !== monitoring.label) monitoringLabel.textContent = monitoring.label;
  monitoringDetail.dataset.status = monitoring.status;
  if (monitoringDetail.textContent !== monitoring.detail) monitoringDetail.textContent = monitoring.detail;
  monitoringDetail.hidden = !monitoring.detail;
  if (monitoring.detail) monitoringBadge.setAttribute('aria-describedby', 'monitoring-detail');
  else monitoringBadge.removeAttribute('aria-describedby');
  for (const metric of ['running', 'attention', 'unread']) {
    document.querySelector(`#${metric}-count`).textContent = model[metric] === null ? '—' : String(model[metric]).padStart(2, '0');
  }
  runningMetric.classList.toggle('is-running', model.running > 0);
  filter.disabled = model.recent || snapshot.sessions.length === 0;
  for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
  const children = [];
  if (model.recent) {
    children.push(notice('Recent sessions', 'Live status and unread data are unavailable.'));
  } else if (!snapshot.runtimeAvailable || !snapshot.unreadAvailable) {
    sourceInfo.title = 'Live status or unread data is unavailable.';
  }
  if (snapshot.source === 'stale') children.push(notice('Showing last available results', 'The session source is temporarily unavailable.'));
  if (model.visible.length === 0) {
    const [title, detail] = snapshot.source === 'loading' ? ['Reading sessions', 'Looking for local Codex sessions.']
      : snapshot.source === 'unavailable' ? ['Session source unavailable', 'Agent Inbox will try again automatically.']
      : model.recent ? ['No recent activity', 'Open All sessions to see discovered sessions.']
      : filter.value !== 'all' ? ['No matching sessions', 'Choose another status filter.']
      : view === 'inbox' ? ['No sessions in Inbox', snapshot.unreadAvailable
        ? 'Open All sessions to see the full list.' : 'Unread data is unavailable. Open All sessions to see the full list.']
      : ['No sessions found', 'Local Codex sessions will appear here when available.'];
    children.push(notice(title, detail));
  }
  for (const [index, [key, group]] of [...groupByProject(model.visible, projectOrder)].entries()) {
    children.push(projectNode(key, group, view === 'inbox', index));
  }
  list.replaceChildren(...children);
  list.scrollTop = previousScroll;
  if (focused?.session) {
    const nextFocus = [...list.querySelectorAll('[data-session]')]
      .find(n => n.dataset.session === focused.session && n.dataset.action === focused.action)
      ?? tabs.find(tab => tab.dataset.view === view);
    nextFocus?.focus({ preventScroll: true });
  }
  sourceInfo.textContent = snapshot.sample ? 'Sample data' : {
    ready: 'Read-only source', stale: 'Source unavailable', unavailable: 'Source unavailable', loading: 'Reading sessions…',
  }[snapshot.source];
  if (snapshot.runtimeAvailable && snapshot.unreadAvailable) sourceInfo.removeAttribute('title');
}

async function refresh() {
  if (polling || menuTarget || message.open) return;
  polling = true;
  runtimeRefreshPending = false;
  try {
    let next;
    try {
      next = await window.inbox.snapshot();
    } catch {
      const sessions = snapshot.sessions.map(session => ({ ...session, runtime: 'unknown', unread: null }));
      next = { ...snapshot, sessions, source: sessions.length ? 'stale' : 'unavailable',
        monitoring: { status: 'unavailable', code: 'SOURCE_UNAVAILABLE' },
        runtimeAvailable: false, attentionAvailable: false, unreadAvailable: false };
    }
    if (menuTarget || message.open) return;
    const json = JSON.stringify(next);
    if (json !== signature) {
      signature = json;
      snapshot = next;
      // Remember every discovered project before view/status filters hide any.
      groupByProject(snapshot.sessions, projectOrder);
      render();
    } else {
      for (const time of list.querySelectorAll('[data-activity]')) {
        time.textContent = timeLabel(Number(time.dataset.activity), time.dataset.compact === 'true');
      }
    }
  } finally {
    polling = false;
    if (runtimeRefreshPending) void refresh();
  }
}

for (const tab of tabs) tab.addEventListener('click', () => {
  closeMenu();
  view = tab.dataset.view;
  filter.value = 'all';
  list.scrollTop = 0;
  render();
});
filter.addEventListener('change', () => { list.scrollTop = 0; render(); });
pinAction.addEventListener('click', async () => {
  if (!menuTarget || pinPending) return;
  const { session } = menuTarget;
  pinPending = true;
  closeMenu(true);
  try {
    const result = await window.inbox.setPin(session.id, !session.pinned);
    if (!result.ok) showMessage(result.message, session.title);
  } catch {
    showMessage('The pin preference could not be saved.', session.title);
  } finally {
    pinPending = false;
    runtimeRefreshPending = true;
    void refresh();
  }
});
editorAction.addEventListener('click', () => {
  const target = menuTarget;
  closeMenu(true);
  if (target) void navigate('vscode', target.session);
});
document.addEventListener('pointerdown', event => {
  if (menuTarget && !menu.contains(event.target) && !menuTarget.trigger.contains(event.target)) closeMenu();
});
document.addEventListener('focusin', event => {
  if (menuTarget && !menu.contains(event.target) && !menuTarget.trigger.contains(event.target)) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuTarget) { event.preventDefault(); closeMenu(true); }
});
list.addEventListener('scroll', () => closeMenu());
window.addEventListener('resize', () => closeMenu());
for (const control of document.querySelectorAll('[data-window]')) {
  control.addEventListener('click', () => window.inbox.window(control.dataset.window));
}
message.addEventListener('close', () => {
  if (runtimeRefreshPending) void refresh();
});
window.inbox.onRuntimeChange(() => {
  runtimeRefreshPending = true;
  void refresh();
});
render();
void refresh();
setInterval(refresh, 5_000);
