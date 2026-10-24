/* 자료 수합 도우미 프론트엔드 (빌드 불필요) */
const $app = document.getElementById('app');
const TYPE_LABELS = {
  text: '짧은 글', textarea: '긴 글', number: '숫자', date: '날짜', tel: '전화번호', email: '이메일', select: '드롭다운',
};
const PW_KEY = 'dg_admin_pw';
const ID_KEY = 'dg_admin_id';
// 아이디가 틀렸을 때와 비밀번호가 틀렸을 때 같은 문구를 써서, 어느 쪽이 틀렸는지 화면 문구로는 알 수 없게 한다.
const LOGIN_FAIL_MSG = '아이디 또는 비밀번호가 일치하지 않습니다. 다시 입력해주세요.';
const ADMIN_ID_RE = /^[a-z0-9]{4,20}$/; // Code.gs 의 checkAdminId_ 와 같은 규칙
const ADMIN_ID_RULE = '영어 소문자와 숫자만 사용해 4~20자로 정해 주세요';
function clearSession() { sessionStorage.removeItem(PW_KEY); sessionStorage.removeItem(ID_KEY); }
const LOADING_LABELS = {
  submit: '제출하는 중이에요', saveForm: '저장하는 중이에요', setOpen: '바꾸는 중이에요',
  deleteForm: '삭제하는 중이에요', deleteRow: '삭제하는 중이에요',
  setPassword: '비밀번호를 설정하는 중이에요', login: '로그인하는 중이에요', rotateHomeKey: '링크를 갱신하는 중이에요',
};
const SLOW_AFTER_MS = 6000;   // 이 시간이 지나도 응답이 없으면 "서버를 깨우는 중" 안내를 덧붙인다.
const SHOW_AFTER_MS = 800;    // 이 시간 안에 끝나는 요청에는 대기 창을 띄우지 않는다. (자주 뜨면 오히려 느리게 느껴진다)

// ---------- 공통 ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') continue;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(kid == null ? '' : kid));
  if (attrs && 'value' in attrs) el.value = attrs.value;
  return el;
}

// 브라우저 기본 경고 말풍선은 꾸밀 수 없어서, novalidate 폼에서 직접 검사하고 입력칸 아래에 오류 문구를 보여준다.
function validateForm(form) {
  if (!form.dataset.watching) {
    form.dataset.watching = '1';
    form.addEventListener('input', (e) => clearInvalid(e.target.closest('.field')));
    form.addEventListener('change', (e) => clearInvalid(e.target.closest('.field')));
  }
  let first = null;
  for (const el of form.querySelectorAll('input, select, textarea')) {
    const wrap = el.closest('.field');
    if (!wrap) continue;
    clearInvalid(wrap);
    if (el.checkValidity()) continue;
    const v = el.validity;
    const msg = v.customError ? el.validationMessage // setCustomValidity 로 지정한 문구 (비밀번호 확인 등)
      : v.valueMissing ? (el.tagName === 'SELECT' ? '항목을 선택해 주세요' : '꼭 입력해 주세요')
      : v.typeMismatch ? (el.type === 'email' ? '이메일 형식을 확인해 주세요' : '형식을 확인해 주세요')
        : v.badInput ? '숫자로 입력해 주세요' : '값을 확인해 주세요';
    wrap.classList.add('invalid');
    wrap.append(h('span', { class: 'err', role: 'alert' }, msg));
    first = first || el;
  }
  if (first) first.focus();
  return !first;
}

function clearInvalid(wrap) {
  if (!wrap) return;
  wrap.classList.remove('invalid');
  wrap.querySelectorAll('.err').forEach((n) => n.remove());
}

// ---------- 로딩 창 (화면을 흐리게 하고 가운데에 표시) ----------

let inertDepth = 0;
function lockApp() { inertDepth++; $app.inert = true; }
function unlockApp() { inertDepth = Math.max(0, inertDepth - 1); $app.inert = inertDepth > 0; }

const loadingTokens = new Set();
let loadingLocked = false;
let loadingEl, loadingMsg, loadingHint, showTimer, hintTimer;

function ensureLoadingEl() {
  if (loadingEl) return;
  loadingMsg = h('div', { class: 'loading-msg' });
  loadingHint = h('div', { class: 'loading-hint', hidden: true }, '서버를 깨우는 중일 수 있어요. 한동안 쓰지 않았다면 길게는 30초 이상 걸려요.');
  loadingEl = h('div', { class: 'loading', role: 'alertdialog', 'aria-modal': 'true', 'aria-live': 'polite', 'aria-label': '처리 중' },
    h('div', { class: 'loading-card' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), loadingMsg, loadingHint));
  document.body.append(loadingEl);
}

// 로딩 창을 띄우고, 끝나면 호출할 함수를 돌려준다. 요청이 겹쳐도 모두 끝나야 닫힌다.
function showLoading(msg) {
  ensureLoadingEl();
  const token = { msg };
  loadingTokens.add(token);
  loadingMsg.textContent = msg;
  if (loadingTokens.size === 1) {
    showTimer = setTimeout(() => { loadingEl.classList.add('show'); loadingLocked = true; lockApp(); }, SHOW_AFTER_MS);
    hintTimer = setTimeout(() => { loadingHint.hidden = false; }, SLOW_AFTER_MS);
  }
  return () => {
    loadingTokens.delete(token);
    if (loadingTokens.size) { loadingMsg.textContent = [...loadingTokens].pop().msg; return; }
    clearTimeout(showTimer); clearTimeout(hintTimer);
    loadingEl.classList.remove('show');
    loadingHint.hidden = true;
    if (loadingLocked) { loadingLocked = false; unlockApp(); }
  };
}

function mount(...nodes) { dashSync = null; stopHomePolling(); $app.replaceChildren(...nodes.flat()); window.scrollTo(0, 0); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- 서버(Apps Script) 주소 ----------
// 관리자: 직접 입력한 주소를 이 브라우저(localStorage)에 저장해 사용한다.
// 선생님: 링크의 ?g=배포ID 로 전달받은 주소를 사용한다. (링크에 주소가 없으면 저장된 주소로 대체)

const BACKEND_KEY = 'dg_backend_url';
const GAS_RE = /^https:\/\/script\.google\.com\/(?:macros|a\/macros\/[A-Za-z0-9.-]+)\/s\/[\w-]+\/exec$/;
const STD_RE = /^https:\/\/script\.google\.com\/macros\/s\/([\w-]+)\/exec$/;

function parseBackend(v) {
  v = String(v || '').trim();
  if (/^[\w-]{20,}$/.test(v)) return 'https://script.google.com/macros/s/' + v + '/exec';
  return GAS_RE.test(v) ? v : null;
}

// 이 브라우저에는 서버 주소와 요구자 이름·비공개 여부를 한 세트(프로필)로 저장한다.
// (이전 버전이 저장한 주소 문자열만 있는 경우도 읽을 수 있다.)
function loadProfile() {
  try {
    const raw = localStorage.getItem(BACKEND_KEY);
    if (!raw) return null;
    let p;
    try { p = JSON.parse(raw); } catch (e) { p = null; }
    if (!p || typeof p !== 'object') p = { url: raw };
    const url = parseBackend(p.url);
    // ownerSet: 서버에 요구자 정보(이름 또는 비공개 설정)가 이미 있는지. 이전 버전 저장분은 이름/비공개가 있으면 입력된 것으로 본다.
    const ownerSet = typeof p.ownerSet === 'boolean' ? p.ownerSet : !!p.name || !!p.hidden;
    // idSet: 서버에 관리자 아이디가 이미 있는지. 있으면 로그인에 아이디가 필요하다.
    return url ? { url, name: String(p.name || ''), hidden: !!p.hidden, ownerSet, idSet: p.idSet === true } : null;
  } catch (e) { return null; }
}

function storedBackend() { const p = loadProfile(); return p ? p.url : null; }

function writeProfile(p) {
  try { localStorage.setItem(BACKEND_KEY, JSON.stringify(p)); } catch (e) { toast('이 브라우저에서는 설정을 저장할 수 없습니다.'); }
}

// 주소가 바뀌면 이름·비공개 설정은 새 서버의 것이 아니므로 비운다. ownerSet 은 방금 서버에 물어본 값이 있으면 그것을 따른다.
function saveBackend(url, ownerSet, idSet) {
  const old = loadProfile();
  const base = old && old.url === url ? old : { url, name: '', hidden: false, ownerSet: false, idSet: false };
  writeProfile({
    ...base,
    ownerSet: typeof ownerSet === 'boolean' ? ownerSet : base.ownerSet,
    idSet: typeof idSet === 'boolean' ? idSet : base.idSet,
  });
}

// 서버가 알려 준 "아이디 설정 여부"를 반영한다.
function saveIdSet(idSet) {
  const p = loadProfile();
  if (p && typeof idSet === 'boolean' && p.idSet !== idSet) writeProfile({ ...p, idSet });
}

// 요구자 정보가 서버에 저장되었음을 이 브라우저에 기억한다. (이름이나 비공개 설정이 있을 때만)
function saveOwnerProfile(name, hidden) {
  const p = loadProfile();
  if (p) writeProfile({ ...p, name: name || '', hidden: !!hidden, ownerSet: !!name || !!hidden });
}

// 선생님 화면에 표시할 문구. 서버가 정보를 주지 않으면(null) 표시하지 않는다.
function ownerText(owner) {
  if (!owner) return '';
  return '요구자 : ' + (owner.hidden ? '비공개' : owner.name + ' 선생님');
}

const IS_ADMIN_PAGE = new URLSearchParams(location.search).has('admin');
// 관리자 화면은 링크로 전달된 주소를 절대 쓰지 않는다. (비밀번호가 엉뚱한 서버로 가는 것을 방지)
const backendUrl = IS_ADMIN_PAGE
  ? storedBackend()
  : (parseBackend(new URLSearchParams(location.search).get('g')) || storedBackend());

// 링크에 넣을 짧은 식별자: 일반 계정은 배포 ID만, 학교(Workspace) 계정 주소는 전체 주소
function backendRef(url) { const m = STD_RE.exec(url || ''); return m ? m[1] : url; }

// 서버 요청 전체를 로딩 창으로 감싼다. (opts.quiet: 로딩 창 없이 요청)
async function api(action, payload, opts) {
  const stop = opts && opts.quiet ? null : showLoading(LOADING_LABELS[action] || '불러오는 중이에요');
  try { return await rawApi(action, payload); } finally { if (stop) stop(); }
}

async function rawApi(action, payload) {
  const url = backendUrl;
  if (!url) throw new Error('연결된 서버 정보가 없습니다. 관리자에게 받은 링크로 다시 접속해 주세요.');
  // 관리자 비밀번호는 관리자가 직접 저장한 주소로만 보낸다.
  const mine = url === storedBackend();
  const password = mine ? sessionStorage.getItem(PW_KEY) || '' : '';
  const adminId = mine ? sessionStorage.getItem(ID_KEY) || '' : '';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight 회피
      body: JSON.stringify({ action, adminId, password, ...payload }),
    });
  } catch (e) {
    throw new Error('서버에 연결하지 못했습니다. 네트워크와 배포 설정(액세스: 모든 사용자)을 확인하세요.');
  }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('서버 응답을 해석하지 못했습니다. 배포 URL을 확인하세요.'); }
  if (!json.ok) {
    const err = String(json.error || '');
    // 서버가 아이디 또는 비밀번호 오류를 'AUTH'(어느 쪽이 틀렸는지 구분하지 않음), 로그인 잠금을 'LOCKED:남은초'로 알려 준다.
    // (이전 버전 서버가 보내는 'AUTH:남은횟수'도 같은 문구로 처리하고 횟수는 보여주지 않는다)
    if (/^AUTH(?::\d+)?$/.test(err)) {
      // 마이페이지처럼 비밀번호를 직접 넣어 보낸 요청이 틀린 경우에는 기존 로그인 상태를 지우지 않는다.
      if (!(payload && 'password' in payload)) clearSession();
      throw Object.assign(new Error(LOGIN_FAIL_MSG), { auth: true });
    }
    const locked = /^LOCKED:(\d+)$/.exec(err);
    if (locked) {
      clearSession();
      const sec = Number(locked[1]);
      const wait = sec < 60 ? `${sec}초` : sec % 60 === 0 ? `${sec / 60}분` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
      throw Object.assign(new Error(`비밀번호를 여러 번 틀려서 로그인이 잠겼어요. ${wait} 뒤에 다시 시도해 주세요.`), { auth: true, locked: true });
    }
    if (err === 'KEY') throw Object.assign(new Error('메인페이지 링크가 올바르지 않거나 새 링크로 바뀌었어요.'), { badKey: true });
    throw new Error(err);
  }
  return json.data;
}

const BASE = location.origin + location.pathname;
// 메인페이지 링크에는 비밀 코드(k)가 들어 있다. 개별 응답 링크에는 넣지 않으므로, 개별 링크에서 ?f=... 를 지워도 목록을 볼 수 없다.
const urlKey = new URLSearchParams(location.search).get('k') || ''; // 선생님이 받은 메인페이지 링크의 코드
let adminHomeKey = ''; // 관리자 화면이 서버에서 받은 코드
function baseLink() { return backendUrl ? BASE + '?g=' + encodeURIComponent(backendRef(backendUrl)) : BASE; }
function homeLink() {
  const key = IS_ADMIN_PAGE ? adminHomeKey : urlKey;
  return baseLink() + (key && backendUrl ? '&k=' + encodeURIComponent(key) : '');
}
function formLink(id) { return baseLink() + (backendUrl ? '&' : '?') + 'f=' + encodeURIComponent(id); }
// 메인페이지 목록 요청. 링크에 든 코드를 함께 보낸다.
const fetchPublicList = (opts) => api('listPublic', { key: urlKey }, opts);

// 누구나 자기 서버를 연결할 수 있는 구조라, 가짜 링크로 개인정보를 빼내려는 시도에 대비해 선생님 화면에 안내를 둔다.
function linkWarning() {
  return h('div', { class: 'warn', role: 'note' },
    '자료 요구자에게 직접 받은 링크인지 확인해 주세요. 모르는 사람이 보낸 링크라면 개인정보를 입력하지 마세요.');
}

// 메인페이지 링크가 없거나 틀렸을 때(개별 응답 링크에서 ?f=... 만 지운 경우 포함)와, 관리자가 링크를 갱신해 이전 링크가 막힌 경우
function renderBadHomeLink() {
  mount(h('h1', {}, '링크가 필요해요'),
    h('div', { class: 'card' },
      h('p', {}, '이 링크로는 자료 목록을 볼 수 없어요.'),
      h('p', { class: 'muted' }, '자료 요구자에게 받은 링크로 접속해 주세요. 링크가 새로 바뀌었다면 새 링크를 다시 받아야 해요.')));
}

// 메인페이지에서 자료를 눌러 들어왔다면, 제출 화면의 취소 버튼이 이 주소(목록)로 돌아간다. 이 탭에서만 유지된다.
const FROM_HOME_KEY = 'dg_from_home';
function rememberHome() { try { sessionStorage.setItem(FROM_HOME_KEY, location.href); } catch (e) { /* 저장할 수 없으면 목록으로 돌아가지 못하고 창을 닫는 쪽으로 동작한다 */ } }
function homeToReturn() { try { const u = sessionStorage.getItem(FROM_HOME_KEY); return u && u.startsWith(BASE) ? u : ''; } catch (e) { return ''; } }

// ---------- 첫 화면: 제출할 자료 선택 ----------

function renderNoBackend() {
  mount(h('h1', {}, '링크가 필요해요'),
    h('div', { class: 'card' },
      h('p', {}, '선생님이라면 관리자에게 받은 링크로 접속해 주세요.'),
      h('p', { class: 'muted' }, '이 주소만으로는 어느 자료를 제출해야 하는지 알 수 없습니다.')));
}

// ---------- 선생님 첫 화면: 일정 주기로 목록 새로고침 ----------
// 관리자가 공개 여부·접수 여부를 바꾸면, 이미 열려 있는 선생님 화면에도 1분 안에 반영한다. (바로 보려면 새로고침 버튼)
// 서버 부담을 줄이려고: 탭이 보일 때만, 조작이 있었을 때만 확인하고, 오류가 이어지면 간격을 늘리며,
// 여러 사람이 같은 순간에 몰리지 않도록 간격을 조금씩 흩뜨린다. (서버도 목록을 10초간 저장해 둔다)
const HOME_POLL_MS = 60000;                 // 확인 주기 (급한 경우에는 화면의 새로고침 버튼을 누른다)
const HOME_POLL_MAX_MS = 300000;            // 오류가 이어질 때 늘려 가는 최대 간격
const HOME_IDLE_LIMIT_MS = 10 * 60 * 1000;  // 이 시간 동안 조작이 없으면 확인을 멈춘다. (조작하거나 탭으로 돌아오면 바로 다시 시작)
let homePoll = null;

function stopHomePolling() { if (homePoll) { homePoll.stop(); homePoll = null; } }

function startHomePolling(onData) {
  stopHomePolling();
  let timer = null, inflight = false, fails = 0, stopped = false;
  let lastActive = Date.now(), lastOk = Date.now();
  const idle = () => Date.now() - lastActive > HOME_IDLE_LIMIT_MS;
  const delay = () => Math.min(HOME_POLL_MS * 2 ** fails, HOME_POLL_MAX_MS) + Math.random() * 6000;
  const schedule = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(tick, delay()); };
  async function tick() {
    if (stopped) return;
    if (document.visibilityState !== 'visible' || idle() || inflight) return schedule(); // 지금은 쉰다
    inflight = true;
    try {
      const data = await fetchPublicList({ quiet: true }); // 화면을 막는 대기 창 없이 조용히
      fails = 0; lastOk = Date.now();
      if (!stopped) onData(data);
    } catch (e) {
      if (e.badKey && !stopped) return renderBadHomeLink(); // 관리자가 링크를 갱신했다면 안내 화면으로 바꾼다
      fails++; // 실패해도 알리지 않는다. 다음 주기에 다시 시도한다.
    }
    finally { inflight = false; schedule(); }
  }
  const wake = () => { // 조작이 있었음. 쉬고 있었다면 기다리지 않고 바로 확인한다.
    const wasIdle = idle();
    lastActive = Date.now();
    if (wasIdle && !stopped && !inflight) { clearTimeout(timer); tick(); }
  };
  const onVisible = () => { // 탭으로 돌아왔는데 마지막 확인이 오래됐으면 바로 확인한다.
    if (document.visibilityState !== 'visible' || stopped) return;
    if (Date.now() - lastOk > HOME_POLL_MS && !inflight) { clearTimeout(timer); tick(); }
  };
  const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
  events.forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
  document.addEventListener('visibilitychange', onVisible);
  schedule();
  homePoll = {
    tick, // 시험용
    reset() { fails = 0; lastOk = Date.now(); schedule(); }, // 방금 확인했으니 다음 자동 확인은 처음부터 다시 센다
    stop() { stopped = true; clearTimeout(timer); events.forEach((ev) => window.removeEventListener(ev, wake)); document.removeEventListener('visibilitychange', onVisible); },
  };
}

// 서버 버전에 따라 배열(이전) 또는 {forms, owner}(요구자 표시 지원)로 온다.
function readHome(data) {
  const list = Array.isArray(data) ? data : data && data.forms;
  return Array.isArray(list) ? { list, owner: Array.isArray(data) ? null : data.owner } : null;
}

const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
const MANUAL_REFRESH_COOLDOWN_MS = 5000; // 새로고침 버튼을 연달아 눌러도 서버에는 이 간격으로만 요청한다.

async function renderHome() {
  if (!backendUrl) return renderNoBackend();
  let first;
  try { first = readHome(await fetchPublicList()); } catch (e) { return e.badKey ? renderBadHomeLink() : mount(h('div', { class: 'card' }, h('p', {}, e.message))); }
  if (!first) return mount(h('div', { class: 'card' }, h('p', {}, '서버 응답을 해석하지 못했습니다. 배포 URL을 확인하세요.')));

  const ownerEl = h('span', { class: 'owner' });
  const listBox = h('div', { class: 'pick-list' });
  const paint = ({ list, owner }) => {
    ownerEl.textContent = owner ? ownerText(owner) : '';
    ownerEl.hidden = !owner;
    listBox.replaceChildren(...(list.length
      ? list.map((f) => h('a', { class: 'card pick', href: formLink(f.id), onclick: () => rememberHome() },
        h('strong', {}, f.title),
        f.description ? h('div', { class: 'muted pre' }, f.description) : ''))
      : [h('p', { class: 'muted' }, '현재 접수 중인 자료가 없습니다.')]));
  };
  let shown = JSON.stringify(first);
  paint(first);

  // 서버가 준 목록이 화면과 다를 때만 다시 그린다. 'changed' | 'same' | null(해석 불가)
  const apply = (data) => {
    const next = readHome(data);
    if (!next) return null;
    const sig = JSON.stringify(next);
    if (sig === shown) return 'same';
    shown = sig;
    paint(next);
    return 'changed';
  };

  // 수동 새로고침: 급할 때 바로 확인한다. (자동 확인은 1분마다라서 반영이 늦을 수 있다)
  let refreshing = false, cooldownUntil = 0;
  const refreshBtn = h('button', {
    class: 'sm icon', type: 'button', title: '목록 새로고침', 'aria-label': '목록 새로고침',
    onclick: async () => {
      if (refreshing) return;
      if (Date.now() < cooldownUntil) return toast('방금 새로고침했어요. 잠시 후 다시 눌러 주세요');
      refreshing = true; refreshBtn.classList.add('busy'); refreshBtn.setAttribute('aria-busy', 'true');
      try {
        const r = apply(await fetchPublicList({ quiet: true }));
        if (r === null) throw new Error('서버 응답을 해석하지 못했습니다.');
        if (homePoll) homePoll.reset(); // 방금 확인했으니 다음 자동 확인은 1분 뒤부터
        toast(r === 'changed' ? '목록을 새로 불러왔어요' : '이미 최신 상태예요');
      } catch (e) {
        if (e.badKey) return renderBadHomeLink();
        toast('새로고침하지 못했어요: ' + e.message);
      } finally {
        refreshing = false; cooldownUntil = Date.now() + MANUAL_REFRESH_COOLDOWN_MS;
        refreshBtn.classList.remove('busy'); refreshBtn.removeAttribute('aria-busy');
      }
    },
  });
  refreshBtn.innerHTML = REFRESH_ICON;

  mount(
    h('div', { class: 'title-row' },
      h('h1', {}, '제출할 자료를 선택하세요.'),
      h('div', { class: 'title-tools' }, ownerEl, refreshBtn)),
    listBox,
    linkWarning());

  // 1분마다 조용히 확인해서, 목록이나 요구자 표시가 바뀐 경우에만 화면을 다시 그린다.
  startHomePolling(apply);
}
// ---------- 응답자 화면 ----------

async function renderRespondent(id) {
  let form;
  try { form = await api('getForm', { id }); } catch (e) { return mount(h('div', { class: 'card' }, h('h2', {}, '열 수 없는 양식입니다'), h('p', {}, e.message))); }

  if (!form.open) return mount(h('div', { class: 'card' }, h('h1', {}, form.title), h('p', {}, '접수가 마감되었습니다.')));

  const inputs = form.fields.map(buildInput);
  const btn = h('button', { class: 'primary', type: 'submit' }, '제출');
  const formEl = h('form', {
    novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      if (!validateForm(ev.target)) return;
      btn.disabled = true; btn.textContent = '제출 중…';
      try {
        await api('submit', { id, values: inputs.map((i) => i.value) });
        mount(h('div', { class: 'card' }, h('h2', {}, '제출되었습니다'), h('p', {}, '입력해 주셔서 감사합니다.'),
          h('button', { onclick: () => renderRespondent(id) }, '같은 자료 다시 입력')));
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '제출'; }
    },
  },
  form.fields.some((f) => f.required) ? h('p', { class: 'req-note' }, h('span', { class: 'req' }, '*'), ' 표시가 있는 항목은 필수로 입력해야 해요.') : '',
  form.fields.map((f, i) => h('label', { class: 'field' },
    f.label, f.required ? h('span', { class: 'req' }, ' *') : '',
    f.description ? h('span', { class: 'hint' }, f.description) : '', inputs[i])),
  btn);

  // 하나라도 입력했다면 나가기 전에 한 번 더 묻는다.
  async function leave() {
    if (inputs.some((i) => i.value)) {
      const leaveAnyway = await confirmModal({
        title: '입력한 내용이 사라져요',
        desc: '지금 나가면 입력한 내용이 사라져요. 그래도 나갈까요?',
        confirmText: '나가기',
        cancelText: '계속 입력하기',
        danger: true,
      });
      if (!leaveAnyway) return;
    }
    const back = homeToReturn();
    if (back) { location.href = back; return; } // 메인페이지에서 들어왔으면 목록으로
    // 개별 링크로 들어왔으면 창을 닫는다. 브라우저가 닫지 못하게 하는 경우(링크를 새 창으로 연 게 아닐 때 등)에는 직접 닫도록 안내한다.
    window.close();
    setTimeout(() => mount(h('div', { class: 'card' },
      h('h2', {}, '이 창을 닫아 주세요'),
      h('p', { class: 'muted' }, '브라우저가 창을 자동으로 닫지 못했어요. 탭이나 창을 직접 닫아 주세요.'))), 300);
  }

  mount(h('div', { class: 'row between' }, h('h1', {}, form.title), h('button', { onclick: leave }, '← 취소')), form.description ? h('p', { class: 'muted', style: 'white-space:pre-wrap' }, form.description) : '',
    h('div', { class: 'card' }, formEl),
    linkWarning());
}

function buildInput(f) {
  const common = { required: f.required };
  if (f.type === 'select') {
    return h('select', common, h('option', { value: '' }, '선택하세요'), f.options.map((o) => h('option', { value: o }, o)));
  }
  if (f.type === 'textarea') return h('textarea', common);
  const map = { number: 'number', date: 'date', tel: 'tel', email: 'email' };
  const attrs = { ...common, type: map[f.type] || 'text' };
  if (f.type === 'number') attrs.step = 'any';
  if (f.type === 'tel') attrs.inputmode = 'tel';
  return h('input', attrs);
}

// ---------- 관리자: 로그인 ----------

// 이 앱이 GitHub Pages에 있으면 Code.gs 원문 위치를 안내할 수 있다.
// Code.gs 가 이미 들어 있는 구글 시트 원본의 "사본 만들기" 주소. 서버 연결 화면 1번 안내에서 링크로 쓴다.
const SHEET_COPY_URL = 'https://docs.google.com/spreadsheets/d/1CG9Pk7vlT08Xs5di4hvHDmmV-hJmRYZBl4j1YiSn0S8/copy';

// 입력한 주소가 실제로 이 앱의 서버(Code.gs)인지, 관리자 비밀번호가 이미 정해져 있는지 확인한다.
// 돌려주는 값: { problem: 안내 문구 | null, passwordSet, idSet, ownerSet }  (모두 true | false)
// (idSet: 관리자 아이디가 서버에 이미 있는지 / ownerSet: 자료 요구자 이름 또는 비공개 설정이 서버에 이미 있는지)
async function verifyBackend(url) {
  const notApp = '이 주소는 자료 수합 서버로 응답하지 않아요. 배포한 웹 앱 주소(…/exec)가 맞는지 확인해 주세요.';
  const fail = (problem) => ({ problem, passwordSet: true, idSet: false, ownerSet: true });

  async function call(action) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action }), // 둘 다 공개 조회라 비밀번호 없이 확인 가능
        signal: ctrl.signal,
      });
    } catch (e) {
      return { problem: e.name === 'AbortError'
        ? '서버가 60초 안에 응답하지 않았어요. 잠시 후 다시 시도해 주세요.'
        : '서버에 접속할 수 없어요. 주소가 정확한지, 배포할 때 액세스 권한을 "모든 사용자"로 했는지 확인해 주세요.' };
    } finally { clearTimeout(timer); }
    let json;
    try { json = await res.json(); } catch (e) { return { problem: notApp }; }
    if (!json || typeof json.ok !== 'boolean') return { problem: notApp };
    return { json };
  }

  const st = await call('status');
  if (st.problem) return fail(st.problem);
  if (st.json.ok) {
    const d = st.json.data;
    return d && typeof d.passwordSet === 'boolean'
      ? { problem: null, passwordSet: d.passwordSet, idSet: d.idSet === true, ownerSet: d.ownerSet === true } // 이전 서버는 idSet·ownerSet 을 모르므로 false 로 둔다
      : fail(notApp);
  }
  if (!/알 수 없는 요청/.test(st.json.error || '')) return fail('서버가 오류를 돌려줬어요: ' + st.json.error);

  // 비밀번호 상태 조회를 모르는 이전 버전 서버: 예전 방식(목록 조회)으로 확인하고 비밀번호는 설정된 것으로 본다.
  const old = await call('listPublic');
  if (old.problem) return fail(old.problem);
  if (!old.json.ok) {
    return fail(/알 수 없는 요청/.test(old.json.error || '')
      ? 'Code.gs가 오래된 버전이에요. 최신 코드를 붙여넣고 "배포 관리 → 새 버전"으로 다시 배포해 주세요.'
      : '서버가 오류를 돌려줬어요: ' + old.json.error);
  }
  const forms = Array.isArray(old.json.data) ? old.json.data : old.json.data && old.json.data.forms;
  return Array.isArray(forms) ? { problem: null, passwordSet: true, idSet: false, ownerSet: false } : fail(notApp);
}

// 이 탭에서 "비밀번호를 처음 정해야 하는 서버"임을 기억한다. (주소 저장 후 화면이 다시 열려도 유지)
const NEEDS_PW_KEY = 'dg_needs_password';
const MIN_PW_LEN = 8; // Code.gs 의 MIN_PASSWORD_LEN 과 같은 값

function renderSetup(msg, entered) {
  const url = h('input', { placeholder: 'https://script.google.com/macros/s/…/exec', value: entered != null ? entered : storedBackend() || '', required: true, autocomplete: 'off' });
  const btn = h('button', { class: 'primary', type: 'submit' }, '확인하고 저장');
  mount(h('h1', {}, '서버 연결'),
    h('p', { class: 'muted' }, '자료는 관리자(자료 요구자)의 구글 시트에 쌓입니다. 아래 순서로 Apps Script 웹 앱을 만들고 주소를 입력하세요. 한 번 입력하면 이 브라우저에 저장됩니다.'),
    h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (!validateForm(e.target)) return;
        const parsed = parseBackend(url.value);
        if (!parsed) return renderSetup('올바른 Apps Script 웹 앱 주소(…/exec)가 아니에요. 배포 후 표시되는 "웹 앱 URL"을 그대로 붙여넣어 주세요.', url.value);
        btn.disabled = true;
        const stop = showLoading('서버를 확인하는 중이에요');
        const result = await verifyBackend(parsed).finally(stop);
        if (result.problem) return renderSetup(result.problem, url.value);
        saveBackend(parsed, result.ownerSet, result.idSet);
        clearSession();
        // 서버에 관리자 비밀번호가 아직 없으면, 다음 화면에서 최초 1회 설정을 받는다.
        if (result.passwordSet) sessionStorage.removeItem(NEEDS_PW_KEY); else sessionStorage.setItem(NEEDS_PW_KEY, '1');
        location.href = BASE + '?admin';
      },
    },
    h('label', { class: 'field' }, 'Apps Script 웹 앱 주소', url),
    msg ? h('div', { class: 'err block', role: 'alert' }, msg) : '',
    btn),
    h('div', { class: 'card' },
      h('h2', {}, '처음 한 번만 하는 설정'),
      h('ol', {},
        h('li', {}, '서버로 사용할 구글 계정으로 로그인한 후, ',
          h('a', { href: SHEET_COPY_URL, target: '_blank', rel: 'noopener', class: 'hl', style: 'text-decoration:underline; font-weight:700' }, '여기'),
          '를 눌러 ', h('b', {}, '"사본 만들기"'), '를 클릭하세요.'),
        h('li', {}, h('b', {}, '확장 프로그램 → Apps Script'), '를 엽니다.'),
        h('li', {}, h('b', {}, '배포 → 새 배포'), '로 들어가서, ',
          h('b', {},
            h('span', { class: 'ul' }, '1) 유형 선택: ', h('span', { class: 'hl' }, '"웹 앱"')), ', ',
            h('span', { class: 'ul' }, '2) 다음 사용자 인증 정보로 실행: ', h('span', { class: 'hl' }, '"나"')), ', ',
            h('span', { class: 'ul' }, '3) 액세스 권한: ', h('span', { class: 'hl' }, '"모든 사용자"'))),
          '로 설정한 후 배포하고, 액세스를 승인합니다.'),
        h('li', {}, '배포가 완료된 후 화면에 표시되는 ', h('b', {}, '웹 앱 URL(…/exec)'), '을 복사하여, 위 칸에 붙여넣습니다.'),
        h('li', {}, '다음 화면에서 관리자 아이디와 비밀번호를 설정해 주세요.'))));
}

let prefetched = null; // 로그인 응답에 실려 온 {forms, owner} (대시보드가 한 번 더 요청하지 않도록)
let ownerDraft = null; // 로그인에 실패해 화면이 다시 그려져도 입력하던 이름·비공개 값을 유지하기 위한 임시 값

// 서버 응답을 {forms, owner} 로 통일한다. (이전 서버는 양식 배열만 돌려준다)
function normalizeDash(res) {
  if (Array.isArray(res)) { const p = loadProfile(); return { forms: res, owner: p ? { name: p.name, hidden: p.hidden } : null }; }
  if (res && Array.isArray(res.forms)) return { forms: res.forms, owner: res.owner || null, idSet: res.idSet, homeKey: res.homeKey };
  return null;
}

// 서버가 알려 준 요구자 정보를 이 브라우저에 반영한다. (이름 또는 비공개 설정이 있을 때만)
function rememberOwner(owner) {
  if (owner && (owner.name || owner.hidden)) saveOwnerProfile(owner.name || '', !!owner.hidden);
}

// "자료 요구자 이름 + 비공개 + 안내" 입력 묶음. 로그인 화면과 마이페이지에서 같이 쓴다.
function ownerFields(id, initial) {
  const nameIn = h('input', { id, placeholder: '예: 홍길동', value: initial.name, maxlength: '30', autocomplete: 'off', required: !initial.hidden });
  const note = h('span', { class: 'owner-note', hidden: !initial.hidden }, '자료 요구자가 보이지 않게 됩니다.');
  const hiddenChk = h('input', {
    type: 'checkbox', checked: initial.hidden,
    onchange: () => {
      nameIn.required = !hiddenChk.checked; // 비공개면 이름은 비워 둬도 된다
      note.hidden = !hiddenChk.checked;
      clearInvalid(nameIn.closest('.field'));
    },
  });
  const node = h('div', { class: 'field' },
    h('div', { class: 'label-line' },
      h('label', { for: id }, '자료 요구자 이름'),
      h('label', { class: 'check' }, hiddenChk, '비공개'),
      note),
    nameIn);
  return { node, nameIn, hiddenChk, value: () => ({ name: nameIn.value.trim().replace(/\s*선생님$/, ''), hidden: hiddenChk.checked }) };
}

let idDraft = ''; // 로그인에 실패해도 입력하던 아이디는 유지한다. (비밀번호는 유지하지 않는다)

function idField(id, label, hint, value, placeholder, autocomplete) {
  const input = h('input', {
    id, value, placeholder, autocomplete, autocapitalize: 'none', spellcheck: 'false', maxlength: '20', required: true,
  });
  return { input, node: h('label', { class: 'field' }, label, hint ? h('span', { class: 'hint' }, hint) : '', input) };
}

function renderGate(msg) {
  if (!backendUrl) return renderSetup();
  const firstTime = sessionStorage.getItem(NEEDS_PW_KEY) === '1'; // 비밀번호를 처음 정하는 화면인가
  const prof = loadProfile() || { name: '', hidden: false, ownerSet: false, idSet: false };
  // 서버에 요구자 정보가 아직 없을 때만 이름을 입력받는다. (이름 없이 비공개만 설정된 경우도 이미 입력된 것)
  const askOwner = !prof.ownerSet;
  const owner = askOwner ? ownerFields('owner-name', ownerDraft || { name: prof.name, hidden: prof.hidden }) : null;
  // 아이디 칸: 처음 정할 때, 또는 서버에 아이디가 이미 있을 때. (아이디가 없는 서버는 로그인 뒤에 정하게 한다)
  const askId = firstTime || prof.idSet;
  const idf = askId
    ? idField('admin-id', firstTime ? '사용할 아이디 입력' : '아이디',
      firstTime ? '영어 소문자와 숫자 4~20자 · 한 번 정하면 바꿀 수 없어요' : '',
      idDraft, firstTime ? '영어 소문자·숫자 4~20자' : '아이디', firstTime ? 'off' : 'username')
    : null;
  const pw = h('input', {
    type: 'password', autocomplete: firstTime ? 'new-password' : 'current-password', required: true,
    placeholder: firstTime ? `새 비밀번호 (${MIN_PW_LEN}자 이상)` : '관리자 비밀번호',
  });
  const pw2 = firstTime ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호를 한 번 더 입력', required: true }) : null;

  // 입력한 아이디·비밀번호로 로그인(확인 + 요구자 저장(처음만) + 양식 목록·요구자 조회, 요청 1회)
  async function login(ownerValue) {
    try {
      const res = await api('login', { ...(ownerValue || {}), withOwner: true });
      const dash = normalizeDash(res);
      if (dash && !Array.isArray(res)) prefetched = dash; // 이전 서버가 배열만 주면 대시보드가 직접 다시 조회한다
      if (dash) { rememberOwner(dash.owner); saveIdSet(dash.idSet); }
      if (ownerValue) {
        saveOwnerProfile(ownerValue.name, ownerValue.hidden);
        if (!dash || Array.isArray(res)) toast('서버 코드(Code.gs)를 새 버전으로 배포하면 요구자 이름이 선생님께 표시됩니다.');
      }
    } catch (err) {
      // 서버에 비밀번호가 아직 없다고 하면 최초 설정 화면으로 안내한다.
      if (/아직 설정되지 않았|ADMIN_PASSWORD/.test(err.message)) {
        sessionStorage.setItem(NEEDS_PW_KEY, '1');
        return renderGate('이 서버에는 관리자 비밀번호가 아직 없어요. 처음 한 번 정해 주세요.');
      }
      return renderGate(err.message);
    }
    ownerDraft = null;
    idDraft = '';
    sessionStorage.removeItem(NEEDS_PW_KEY);
    renderDashboard();
  }

  mount(h('h1', {}, '자료 수합 관리'),
    firstTime ? h('div', { class: 'card notice' },
      h('strong', {}, '처음 한 번만 설정해 주세요'),
      h('p', { class: 'muted' }, '이 서버에는 아직 관리자 아이디와 비밀번호가 없어요. 아래에서 정하면 다음부터 이 아이디와 비밀번호로 로그인합니다. 아이디는 한 번 정하면 바꿀 수 없고, 잊어버리지 않게 기억해 두세요.')) : '',
    h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (firstTime) {
          // 규칙과 일치 여부는 직접 검사해 입력칸 아래에 안내한다.
          idf.input.setCustomValidity(ADMIN_ID_RE.test(idf.input.value) ? '' : ADMIN_ID_RULE);
          pw.setCustomValidity(pw.value.length < MIN_PW_LEN || !/\S/.test(pw.value) ? `비밀번호는 ${MIN_PW_LEN}자 이상으로 정해 주세요` : '');
          pw2.setCustomValidity(pw2.value && pw2.value !== pw.value ? '비밀번호가 서로 달라요. 다시 확인해 주세요' : '');
        }
        if (!validateForm(e.target)) return;
        const ownerValue = owner ? owner.value() : null;
        ownerDraft = ownerValue; // 실패해도 입력값 유지
        idDraft = idf ? idf.input.value : '';
        if (firstTime) {
          try {
            await api('setCredentials', { adminId: idf.input.value, password: pw.value });
          } catch (err) {
            if (/이미 관리자 비밀번호/.test(err.message)) { // 그 사이 다른 곳에서 이미 정해진 경우
              sessionStorage.removeItem(NEEDS_PW_KEY);
              return renderGate('이미 관리자 비밀번호가 정해져 있어요. 정해 둔 아이디와 비밀번호로 로그인해 주세요.');
            }
            return renderGate(err.message);
          }
          saveIdSet(true);
          toast('관리자 아이디와 비밀번호를 설정했어요');
        }
        if (idf) sessionStorage.setItem(ID_KEY, idf.input.value); else sessionStorage.removeItem(ID_KEY);
        sessionStorage.setItem(PW_KEY, pw.value);
        await login(ownerValue);
      },
    },
    owner ? owner.node : '',
    idf ? idf.node : '',
    h('label', { class: 'field' }, firstTime ? '사용할 비밀번호 입력' : '관리자 비밀번호', pw),
    pw2 ? h('label', { class: 'field' }, '비밀번호 확인', pw2) : '',
    msg ? h('div', { class: 'err block', role: 'alert' }, msg) : '',
    h('button', { class: 'primary', type: 'submit' }, firstTime ? '등록하기' : '로그인')),
    h('p', { class: 'muted' }, '연결된 서버: …' + backendRef(backendUrl).slice(-8) + ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderSetup(); } }, '변경')));
}

// 아이디가 없는 서버(이전 버전에서 만든 서버)에 로그인한 관리자가 아이디를 최초 1회 정하는 화면. 정하기 전에는 관리 화면을 쓸 수 없다.
function renderSetAdminId() {
  const a = idField('new-admin-id', '사용할 아이디 입력', '영어 소문자와 숫자 4~20자 · 한 번 정하면 바꿀 수 없어요', '', '영어 소문자·숫자 4~20자', 'off');
  const b = idField('new-admin-id2', '아이디 확인', '', '', '아이디를 한 번 더 입력', 'off');
  mount(h('h1', {}, '아이디를 정해 주세요'),
    h('div', { class: 'card notice' },
      h('strong', {}, '처음 한 번만 설정해 주세요'),
      h('p', { class: 'muted' }, '이 서버에는 아직 관리자 아이디가 없어요. 이제부터 로그인할 때 아이디와 비밀번호가 모두 필요해요. 아이디는 한 번 정하면 바꿀 수 없으니 신중하게 정해 주세요.')),
    h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        a.input.setCustomValidity(ADMIN_ID_RE.test(a.input.value) ? '' : ADMIN_ID_RULE);
        b.input.setCustomValidity(b.input.value && b.input.value !== a.input.value ? '아이디가 서로 달라요. 다시 확인해 주세요' : '');
        if (!validateForm(e.target)) return;
        guard(async () => {
          await api('setAdminId', { newAdminId: a.input.value });
          sessionStorage.setItem(ID_KEY, a.input.value); // 이후 요청부터 아이디를 함께 보낸다
          saveIdSet(true);
          toast('아이디를 정했어요');
          await renderDashboard();
        });
      },
    }, a.node, b.node, h('button', { class: 'primary', type: 'submit' }, '아이디 정하기')),
    h('p', { class: 'muted' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); clearSession(); renderGate(); } }, '로그아웃')));
}
// ---------- 관리자: 대시보드 ----------

let includeTs = false;

async function guard(fn) {
  try { return await fn(); } catch (e) {
    if (e.auth) { renderGate(e.message); return; }
    toast(e.message);
  }
}

let lastDash = null; // 마지막으로 받은 {forms, owner, idSet}. 저장·뒤로 가기에서 서버를 다시 부르지 않고 바로 그리는 데 쓴다.
let dashSync = null; // 지금 관리 화면이 떠 있으면, 서버가 준 최신 목록으로 화면을 조용히 맞추는 함수

// 서버 오류를 알린다. (로그인 문제면 로그인 화면으로)
function failAction(e, what) {
  if (e.auth) return renderGate(e.message);
  toast(`${what}: ${e.message}`);
}

// 관리 화면으로 돌아간다. 이미 받아 둔 목록이 있으면 바로 그리고, 최신 목록은 뒤에서 조용히 받아 맞춘다.
function backToDashboard() {
  if (!lastDash) return renderDashboard();
  prefetched = lastDash;
  renderDashboard();
  api('listForms', { withOwner: true }, { quiet: true }).then((res) => {
    const dash = normalizeDash(res);
    if (dash && dashSync) dashSync(dash.forms);
  }).catch(() => {}); // 조용한 갱신이라 실패해도 알리지 않는다
}

async function renderDashboard() {
  let dash = prefetched;
  prefetched = null;
  if (!dash) {
    try {
      dash = normalizeDash(await api('listForms', { withOwner: true }));
      if (!dash) throw new Error('서버 응답을 해석하지 못했습니다. 배포 URL을 확인하세요.');
    } catch (e) {
      if (e.auth) return renderGate(e.message);
      return mount(h('div', { class: 'card' }, h('p', {}, e.message), h('button', { onclick: () => renderDashboard() }, '다시 시도')));
    }
  }
  const { owner } = dash;
  saveIdSet(dash.idSet);
  if (dash.idSet === false) return renderSetAdminId(); // 서버에 아이디가 없으면 먼저 정하게 한다 (이전 서버는 idSet 을 주지 않아 해당 없음)
  rememberOwner(owner);
  lastDash = dash;
  if (dash.homeKey) adminHomeKey = dash.homeKey;
  const greeting = owner && owner.name ? `${owner.name} 선생님, 안녕하세요!` : '안녕하세요!';

  // ── 양식 카드: 누르면 화면을 먼저 바꾸고 서버에는 뒤에서 요청한다. (실패하면 되돌리고 알린다)
  const state = dash.forms.map((f) => ({ ...f }));
  const busy = new Map(); // 양식 id → 처리 중인 동작 ('open' | 'listed' | 'delete')
  const listBox = h('div', { class: 'form-list' });
  const emptyNote = h('p', { class: 'muted' }, '아직 만든 양식이 없습니다.');
  const paint = () => {
    listBox.replaceChildren(...state.map((f) => formCard(f, busy.get(f.id), actions)));
    emptyNote.hidden = state.length > 0;
  };
  // 서버가 준 최신 목록으로 화면을 맞춘다. 다른 처리가 남아 있으면 그 처리가 끝날 때 맞춘다.
  const syncList = (list) => {
    if (!Array.isArray(list) || busy.size > 0) return;
    state.splice(0, state.length, ...list.map((f) => ({ ...f })));
    if (lastDash) lastDash = { ...lastDash, forms: list };
    paint();
  };
  const settle = (id, res) => { // 요청이 성공했을 때
    busy.delete(id);
    if (res && Array.isArray(res.forms)) syncList(res.forms);
    else { if (lastDash) lastDash = { ...lastDash, forms: state.map((f) => ({ ...f })) }; paint(); } // 이전 서버는 목록을 주지 않으므로 화면 값을 그대로 둔다
  };
  const actions = {
    async toggleOpen(f) {
      if (busy.has(f.id)) return;
      // 접수 중/마감 표시는 버튼이 돌아가는 동안 그대로 두었다가, 서버가 끝낸 뒤에 버튼과 함께 바꾼다.
      const next = !f.open;
      if (!next) { // 마감은 한 번 더 묻는다. (다시 열기는 바로 처리)
        const ok = await confirmModal({
          title: `"${f.title}" 접수를 마감할까요?`,
          desc: '마감하면 더 이상 응답을 받을 수 없고, 필요하면 "다시 열기"로 언제든 다시 열 수 있어요.',
          confirmText: '마감하기',
          cancelText: '취소',
          danger: true,
        });
        if (!ok || busy.has(f.id)) return;
      }
      busy.set(f.id, 'open'); paint();
      try {
        const res = await api('setOpen', { id: f.id, open: next, withList: true }, { quiet: true });
        f.open = next;
        settle(f.id, res);
      } catch (e) { busy.delete(f.id); paint(); failAction(e, '접수 상태를 바꾸지 못했어요'); }
    },
    async toggleListed(f) {
      if (busy.has(f.id)) return;
      const prev = f.listed;
      f.listed = !prev; busy.set(f.id, 'listed'); paint();
      try {
        settle(f.id, await setListed(f, f.listed));
        toast(f.listed ? '메인페이지에 표시했어요' : '메인페이지에서 숨겼어요');
      } catch (e) { busy.delete(f.id); f.listed = prev; paint(); failAction(e, '공개 여부를 바꾸지 못했어요'); }
    },
    async remove(f) {
      if (busy.has(f.id)) return;
      if (!confirm(`"${f.title}" 양식과 응답 ${f.count}건을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
      busy.set(f.id, 'delete'); paint(); // 삭제는 서버가 끝낼 때까지 흐리게 두고, 끝나면 카드를 없앤다
      try {
        const res = await api('deleteForm', { id: f.id, withList: true }, { quiet: true });
        const i = state.findIndex((x) => x.id === f.id);
        if (i >= 0) state.splice(i, 1);
        settle(f.id, res);
        toast('삭제했어요');
      } catch (e) { busy.delete(f.id); paint(); failAction(e, '삭제하지 못했어요'); }
    },
  };
  paint();

  const fileInput = h('input', {
    type: 'file', accept: '.xlsx', style: 'display:none',
    onchange: async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try { openEditor({ ...(await XlsxIO.parseTemplate(file)), description: '', open: true }); } catch (e) { toast(e.message); }
      fileInput.value = '';
    },
  });

  const homeBox = linkBox(homeLink());
  homeBox.append(homeLinkRefreshButton(homeBox));
  mount(
    h('div', { class: 'row between head-row' }, h('h1', {}, '자료 수합 관리'),
      h('div', { class: 'head-right' }, h('span', { class: 'greet' }, greeting), adminMenu())),
    h('div', { class: 'card' },
      h('strong', {}, '메인페이지(수합 중인 자료 목록) 링크'),
      h('div', { class: 'muted' }, '응답을 받고 있는 모든 자료가 표시되는 페이지입니다.(숨긴 자료 제외)'),
      h('div', { class: 'muted' }, '하나의 링크로 여러 자료를 한 번에 수합하고 싶으신 경우, 이 링크를 공유하세요.'),
      homeBox),
    h('hr', { class: 'divider' }),
    h('h2', { class: 'list-title' }, '자료 목록'),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => openEditor({ title: '', description: '', open: true, fields: [{ label: '', type: 'text', required: true, options: [] }] }) }, '+ 새 양식 만들기'),
      h('button', { onclick: () => fileInput.click() }, '엑셀 양식 불러오기'), fileInput,
      h('label', { class: 'muted' }, h('input', { type: 'checkbox', checked: includeTs, onchange: (e) => { includeTs = e.target.checked; } }), ' 다운로드 시 제출시각 열 포함')),
    listBox,
    emptyNote,
  );
  dashSync = syncList; // mount() 가 지운 뒤 다시 연결
}
// ---------- 관리자: 메뉴, 마이페이지 ----------

// 마우스를 올리면 열리고 치우면 닫히는 메뉴. (터치 기기는 누르면 열리고 바깥을 누르면 닫힘, 키보드는 Enter로 열고 Esc로 닫음)
let activeMenu = null;
document.addEventListener('pointerdown', (e) => { if (activeMenu && !activeMenu.contains(e.target)) activeMenu.classList.remove('open'); });

function adminMenu() {
  const wrap = h('div', { class: 'menu' });
  const btn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '메뉴', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  const open = () => { wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); };
  const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  const entries = [
    ['마이페이지', () => openMyPage()],
    ['서버 변경', () => renderSetup()],
    ['로그아웃', () => { clearSession(); renderGate(); }],
  ];
  const items = entries.map(([label, run]) => h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => { close(); run(); } }, label));
  wrap.append(btn, h('div', { class: 'menu-panel', role: 'menu' }, h('div', { class: 'menu-card' }, items)));

  let lastInput = 'mouse';
  btn.addEventListener('pointerdown', (e) => { lastInput = e.pointerType || 'mouse'; });
  btn.addEventListener('keydown', () => { lastInput = 'key'; });
  btn.addEventListener('click', () => { if (lastInput === 'mouse') open(); else wrap.classList.contains('open') ? close() : open(); });
  wrap.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') open(); });
  wrap.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') close(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
  wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) close(); });
  activeMenu = wrap;
  return wrap;
}

// 비밀번호를 한 번 더 입력받는 창. verify(입력한 비밀번호)가 통과하면 그 결과를, 취소하면 null 을 돌려준다.
function askPasswordModal({ title, desc, verify }) {
  return new Promise((resolve) => {
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: '관리자 비밀번호' });
    const errBox = h('div');
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const close = (value) => { document.removeEventListener('keydown', onKey); el.remove(); unlockApp(); resolve(value); };
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (!validateForm(form)) return;
        errBox.replaceChildren();
        try { close(await verify(pw.value)); } catch (err) {
          if (err.locked) { close(null); return renderGate(err.message); } // 잠겼으면 로그인 화면으로
          errBox.replaceChildren(h('div', { class: 'err block', role: 'alert' }, err.message));
          pw.select();
        }
      },
    },
    h('label', { class: 'field' }, '관리자 비밀번호', pw),
    errBox,
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, '확인'), h('button', { type: 'button', onclick: () => close(null) }, '취소')));
    const el = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onmousedown: (e) => { if (e.target === el) close(null); } },
      h('div', { class: 'modal-card' }, h('h2', {}, title), h('p', { class: 'muted' }, desc), form));
    document.addEventListener('keydown', onKey);
    document.body.append(el);
    lockApp();
    pw.focus();
  });
}

// 예/아니오를 묻는 확인 창. 확인을 고르면 true, 취소·Esc·바깥 클릭이면 false.
// (브라우저 기본 confirm 대신 앱 모양의 창을 쓴다. 기본 선택은 안전한 쪽(취소)에 둔다.)
function confirmModal({ title, desc, confirmText, cancelText, danger }) {
  return new Promise((resolve) => {
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const close = (value) => { document.removeEventListener('keydown', onKey); el.remove(); unlockApp(); resolve(value); };
    const stay = h('button', { class: 'primary plain-font', type: 'button', onclick: () => close(false) }, cancelText);
    const el = h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title, onmousedown: (e) => { if (e.target === el) close(false); } },
      h('div', { class: 'modal-card' },
        h('h2', {}, title),
        h('p', { class: 'muted' }, desc),
        h('div', { class: 'row', style: 'margin-top:16px' },
          h('button', { class: danger ? 'danger' : '', type: 'button', onclick: () => close(true) }, confirmText),
          stay)));
    document.addEventListener('keydown', onKey);
    document.body.append(el);
    lockApp();
    stay.focus();
  });
}

// 마이페이지는 비밀번호를 한 번 더 확인한 뒤에만 연다. (서버가 확인하며, 틀려도 기존 로그인 상태는 유지된다)
async function openMyPage() {
  const res = await askPasswordModal({
    title: '마이페이지',
    desc: '개인 설정을 보려면 비밀번호를 한 번 더 입력해 주세요.',
    verify: async (password) => {
      try { return await api('me', { password }); } catch (err) {
        if (/알 수 없는 요청/.test(err.message)) throw new Error('서버 코드(Code.gs)가 오래된 버전이라 마이페이지를 쓸 수 없어요. 새 버전으로 배포해 주세요.');
        // 이 창은 비밀번호만 다시 묻는 곳이라, 아이디까지 언급하는 로그인 문구 대신 비밀번호 기준으로 안내한다.
        if (err.auth && !err.locked) throw new Error('비밀번호가 올바르지 않아요.');
        throw err;
      }
    },
  });
  if (res) renderMyPage(res.owner, res.adminId);
}

function renderMyPage(serverOwner, adminId) {
  const owner = ownerFields('my-owner-name', { name: (serverOwner && serverOwner.name) || '', hidden: !!(serverOwner && serverOwner.hidden) });
  const preview = h('div', { class: 'muted' });
  const refreshPreview = () => {
    const v = owner.value();
    if (!v.hidden && !v.name) return preview.replaceChildren('(이름을 입력해 주세요)');
    // 조사: "…선생님"은 받침이 있어 "과", "…비공개"는 받침이 없어 "와"
    preview.replaceChildren('화면 우측 상단에 ', h('b', {}, v.hidden ? '"요구자 : 비공개"' : `"요구자 : ${v.name} 선생님"`), (v.hidden ? '와' : '과') + ' 같이 표시됩니다.');
  };
  owner.node.addEventListener('input', refreshPreview);
  owner.node.addEventListener('change', refreshPreview);
  refreshPreview();

  const newPw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: `새 비밀번호 (${MIN_PW_LEN}자 이상)`, required: true });
  const newPw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호를 한 번 더 입력', required: true });

  mount(
    h('div', { class: 'row between' }, h('h1', {}, '마이페이지'), h('button', { onclick: () => backToDashboard() }, '← 돌아가기')),
    adminId ? h('div', { class: 'card' },
      h('h2', {}, '로그인 정보'),
      h('div', {}, '아이디 ', h('b', {}, adminId)),
      h('div', { class: 'muted' }, '아이디는 한 번 정하면 바꿀 수 없어요.')) : '',
    h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        if (!validateForm(e.target)) return;
        const v = owner.value();
        guard(async () => {
          const saved = await api('setOwner', v);
          rememberOwner(saved);
          saveOwnerProfile(saved.name, saved.hidden);
          toast('저장했어요');
        });
      },
    },
    h('h2', {}, '자료 요구자'),
    owner.node, preview,
    h('div', { class: 'row end', style: 'margin-top:14px' }, h('button', { class: 'primary', type: 'submit' }, '저장'))),
    h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const current = sessionStorage.getItem(PW_KEY) || '';
        newPw.setCustomValidity(newPw.value.length < MIN_PW_LEN || !/\S/.test(newPw.value) ? `비밀번호는 ${MIN_PW_LEN}자 이상으로 정해 주세요`
          : newPw.value === current ? '지금 쓰는 비밀번호와 같아요. 다른 비밀번호를 입력해 주세요' : '');
        newPw2.setCustomValidity(newPw2.value && newPw2.value !== newPw.value ? '비밀번호가 서로 달라요. 다시 확인해 주세요' : '');
        if (!validateForm(e.target)) return;
        guard(async () => {
          await api('changePassword', { newPassword: newPw.value });
          sessionStorage.setItem(PW_KEY, newPw.value); // 이후 요청은 새 비밀번호로 보낸다
          newPw.value = ''; newPw2.value = '';
          toast('비밀번호를 변경했어요');
        });
      },
    },
    h('h2', {}, '비밀번호 변경'),
    h('label', { class: 'field' }, '새 비밀번호', newPw),
    h('label', { class: 'field' }, '새 비밀번호 확인', newPw2),
    h('button', { class: 'primary', type: 'submit' }, '비밀번호 변경')));
}

function linkBox(url, ...extra) {
  const link = h('input', { readonly: true, value: url, onfocus: (e) => e.target.select() });
  return h('div', { class: 'linkbox' }, link,
    h('button', { class: 'sm', onclick: async () => { try { await navigator.clipboard.writeText(link.value); toast('링크를 복사했습니다'); } catch (e) { link.select(); toast('Ctrl+C로 복사하세요'); } } }, '링크 복사'),
    ...extra);
}

// 메인페이지 링크의 비밀 코드를 새로 만든다. 이전에 나눠 준 메인페이지 링크는 열리지 않게 되므로 먼저 되묻는다.
function homeLinkRefreshButton(box) {
  return h('button', {
    class: 'sm danger', type: 'button',
    onclick: () => guard(async () => {
      const ok = await confirmModal({
        title: '메인페이지 링크를 갱신할까요?',
        desc: '새 링크가 만들어지고, 지금까지 공유한 메인페이지 링크는 더 이상 열리지 않아요. 선생님들께 새 링크를 다시 보내 주셔야 해요. 개별 응답 링크는 그대로 쓸 수 있어요.',
        confirmText: '링크 갱신',
        cancelText: '취소',
        danger: true,
      });
      if (!ok) return;
      const res = await api('rotateHomeKey');
      adminHomeKey = res.homeKey;
      if (lastDash) lastDash = { ...lastDash, homeKey: res.homeKey };
      box.querySelector('input').value = homeLink();
      toast('링크를 갱신했어요. 새 링크를 선생님들께 다시 보내 주세요');
    }),
  }, '링크 갱신');
}

// 눈 모양 아이콘 (공개 = 눈 뜸, 비공개 = 눈에 사선)
const EYE_OPEN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

// 메인페이지 목록에 보일지(공개) 숨길지(비공개)를 편집 화면 없이 바로 바꾼다.
// 새 서버는 처리 결과와 최신 목록을 함께 돌려준다. 이전 서버(setListed 를 모름)는 양식을 받아 같은 내용으로 다시 저장해서 바꾼다.
async function setListed(f, listed) {
  try {
    return await api('setListed', { id: f.id, listed, withList: true }, { quiet: true });
  } catch (e) {
    if (!/알 수 없는 요청/.test(e.message)) throw e;
    const form = await api('getForm', { id: f.id }, { quiet: true });
    return api('saveForm', { form: { ...form, listed }, withList: true }, { quiet: true });
  }
}

// 처리 중인 버튼에는 작은 회전 표시를 붙인다. (화면 전체를 막는 대기 창 대신)
const busyClass = (busyKind, kind) => (busyKind === kind ? ' busy' : '');

function visibilityButton(f, busyKind, actions) {
  const hidden = !f.listed;
  const btn = h('button', {
    class: (hidden ? 'sm icon vis off' : 'sm icon vis') + busyClass(busyKind, 'listed'), type: 'button',
    title: hidden ? '비공개 중 (누르면 메인페이지에 표시합니다)' : '공개 중 (누르면 메인페이지에서 숨깁니다)',
    'aria-label': hidden ? '비공개 중. 누르면 메인페이지에 표시합니다' : '공개 중. 누르면 메인페이지에서 숨깁니다',
    'aria-busy': busyKind === 'listed' ? 'true' : null,
    onclick: () => actions.toggleListed(f),
  });
  btn.innerHTML = hidden ? EYE_OFF : EYE_OPEN;
  return btn;
}

function formCard(f, busyKind, actions) {
  return h('div', { class: 'card' + (busyKind === 'delete' ? ' deleting' : '') },
    h('div', { class: 'row between' },
      h('strong', {}, f.title),
      h('span', { class: 'row' },
        f.listed ? '' : h('span', { class: 'badge' }, '비공개'),
        h('span', { class: 'badge ' + (f.open ? 'open' : '') }, f.open ? '접수 중' : '마감'))),
    h('div', { class: 'muted' }, `항목 ${f.fieldCount}개 · 응답 ${f.count}건`),
    linkBox(formLink(f.id)),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'sm primary', onclick: () => guard(async () => { await XlsxIO.downloadResponses(await api('getData', { id: f.id }), includeTs); }) }, '엑셀 다운로드'),
      h('button', { class: 'sm', onclick: () => renderResponses(f.id) }, '응답 보기'),
      h('button', { class: 'sm', onclick: async () => { const form = await guard(() => api('getForm', { id: f.id })); if (form) openEditor({ ...form, listed: f.listed, locked: f.count > 0 }); } }, '편집'), // 공개 여부는 목록 값을 이어받는다
      visibilityButton(f, busyKind, actions),
      h('button', { class: (f.open ? 'sm' : 'sm reopen') + busyClass(busyKind, 'open'), onclick: () => actions.toggleOpen(f) }, f.open ? '마감하기' : '다시 열기'),
      h('button', { class: 'sm danger' + busyClass(busyKind, 'delete'), onclick: () => actions.remove(f) }, '삭제')));
}
// ---------- 관리자: 응답 보기 ----------

async function renderResponses(id) {
  const data = await guard(() => api('getData', { id }));
  if (!data) return;
  const body = data.rows.map((r, i) => h('tr', {}, r.map((v) => h('td', {}, v)),
    h('td', {}, h('button', { class: 'sm danger', onclick: () => { if (confirm('이 응답을 삭제할까요?')) guard(async () => { await api('deleteRow', { id, index: i }); renderResponses(id); }); } }, '삭제'))));
  mount(
    h('div', { class: 'row between' }, h('h1', {}, data.form.title), h('button', { onclick: () => backToDashboard() }, '← 목록')),
    h('p', { class: 'muted' }, `응답 ${data.rows.length}건`),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, data.headers.map((x) => h('th', {}, x)), h('th', {}, ''))), h('tbody', {}, body))));
}

// ---------- 관리자: 양식 편집기 ----------

// 자료 제목은 구글 시트의 시트 이름이 되므로 : \ / ? * [ ] 문자는 쓸 수 없다. 저장할 때 서버도 확인하지만, 입력 단계에서 아예 막는다.
const BAD_TITLE_G = /[:\\\/?*\[\]]/g;
const BAD_TITLE = /[:\\\/?*\[\]]/;
const sanitizeTitle = (s) => String(s || '').replace(BAD_TITLE_G, '');

// 막힌 문자를 시도하면 안내 문구가 잠깐 빨갛게 강조된다.
function guardedTitleInput(draft, hintEl) {
  let timer;
  const flash = () => {
    // 연속으로 시도해도 흔들림이 매번 다시 시작되도록 클래스를 뺐다가 다시 붙인다.
    hintEl.classList.remove('flash');
    void hintEl.offsetWidth;
    hintEl.classList.add('flash');
    clearTimeout(timer);
    timer = setTimeout(() => hintEl.classList.remove('flash'), 1800);
  };
  const input = h('input', { value: draft.title, maxlength: '100', autocomplete: 'off' });
  // 키보드로 입력하는 순간에 막는다.
  input.addEventListener('beforeinput', (e) => {
    if (typeof e.data === 'string' && BAD_TITLE.test(e.data)) { e.preventDefault(); flash(); }
  });
  // 붙여넣기·끌어다 놓기처럼 위에서 걸러지지 않는 입력은 들어온 뒤 바로 지우고, 커서 위치는 그대로 둔다.
  input.addEventListener('input', () => {
    const v = input.value;
    if (BAD_TITLE.test(v)) {
      const caret = sanitizeTitle(v.slice(0, input.selectionStart)).length;
      input.value = sanitizeTitle(v);
      input.setSelectionRange(caret, caret);
      flash();
    }
    draft.title = input.value;
  });
  return input;
}

function openEditor(src) {
  const draft = {
    locked: !!src.locked, // 이미 응답이 있으면 항목 이름·개수·순서를 바꿀 수 없다
    id: src.id, title: sanitizeTitle(src.title), description: src.description || '', open: src.open !== false, listed: src.listed !== false,
    fields: src.fields.map((f) => ({ label: f.label, type: f.type, required: !!f.required, description: f.description || '', options: [...(f.options || [])] })),
  };

  // 변경 여부 비교용. 기존 양식은 열었을 때의 내용과, 새 양식·엑셀에서 불러온 양식은 빈 새 양식과 비교한다.
  // (불러온 양식은 아직 저장된 적이 없으므로 그대로 나가도 내용이 사라진다)
  const snap = (d) => JSON.stringify([d.title, d.description, d.open, d.listed, d.fields.map((f) => [f.label, f.type, f.required, f.description, f.options])]);
  const blank = { title: '', description: '', open: true, listed: true, fields: [{ label: '', type: 'text', required: true, options: [] }] };
  const baseline = draft.id ? snap(draft) : snap(blank);
  async function leave() {
    if (snap(draft) === baseline) return backToDashboard();
    const leaveAnyway = await confirmModal({
      title: '저장하지 않은 변경사항이 있어요',
      desc: '지금 나가면 입력하거나 수정한 내용이 사라져요. 그래도 나갈까요?',
      confirmText: '저장 안 하고 나가기',
      cancelText: '계속 편집하기',
      danger: true,
    });
    if (leaveAnyway) backToDashboard();
  }
  const fieldsBox = h('div');
  const allReq = h('input', {
    type: 'checkbox',
    onchange: (e) => { draft.fields.forEach((f) => { f.required = e.target.checked; }); renderFields(); },
  });

  // 전체 필수 체크박스: 모두 필수면 체크, 일부만이면 중간 상태
  function syncAllReq() {
    const n = draft.fields.filter((f) => f.required).length;
    allReq.checked = n > 0 && n === draft.fields.length;
    allReq.indeterminate = n > 0 && n < draft.fields.length;
  }

  function renderFields() {
    syncAllReq();
    fieldsBox.replaceChildren(...draft.fields.map((f, i) => {
      const optBox = h('textarea', {
        placeholder: '선택지를 한 줄에 하나씩 입력', value: f.options.join('\n'),
        oninput: (e) => { f.options = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); },
      });
      return h('div', { class: 'fcard' },
        h('div', { class: 'grid' },
          h('input', { placeholder: '항목 이름 (예: 이름, 연락처)', value: f.label, disabled: draft.locked, oninput: (e) => { f.label = e.target.value; } }),
          h('select', { value: f.type, onchange: (e) => { f.type = e.target.value; renderFields(); } },
            Object.entries(TYPE_LABELS).map(([k, v]) => h('option', { value: k }, v)))),
        h('input', {
          class: 'f-desc', placeholder: '항목 설명 (선택)', value: f.description, maxlength: '300',
          oninput: (e) => { f.description = e.target.value; },
        }),
        f.type === 'select' ? h('div', { style: 'margin-top:8px' }, optBox) : '',
        h('div', { class: 'row between', style: 'margin-top:8px' },
          h('label', {}, h('input', { type: 'checkbox', checked: f.required, onchange: (e) => { f.required = e.target.checked; syncAllReq(); } }), ' 필수'),
          h('div', { class: 'row' },
            h('button', { class: 'sm', disabled: draft.locked || i === 0, onclick: () => { move(i, -1); } }, '↑'),
            h('button', { class: 'sm', disabled: draft.locked || i === draft.fields.length - 1, onclick: () => { move(i, 1); } }, '↓'),
            h('button', { class: 'sm danger', disabled: draft.locked, onclick: () => { draft.fields.splice(i, 1); renderFields(); } }, '삭제'))));
    }));
  }
  function move(i, d) { const [x] = draft.fields.splice(i, 1); draft.fields.splice(i + d, 0, x); renderFields(); }
  renderFields();

  const titleHint = h('span', { class: 'hint' }, '구글 시트의 시트 이름으로 사용됩니다. 다른 자료와 겹치면 안 되고, : \\ / ? * [ ] 문자는 입력할 수 없습니다.');
  const titleInput = guardedTitleInput(draft, titleHint);

  const saveBtn = h('button', {
    class: 'primary',
    onclick: () => guard(async () => {
      if (!draft.title.trim()) return toast('양식 제목을 입력하세요');
      saveBtn.disabled = true;
      try {
        const res = await api('saveForm', { form: draft, withList: true });
        const id = res && Array.isArray(res.forms) ? res.result : res; // 새 서버: {result, forms} / 이전 서버: 아이디만
        if (res && Array.isArray(res.forms) && lastDash) prefetched = { ...lastDash, forms: res.forms }; // 목록을 이미 받았으니 다시 요청하지 않는다
        await renderDashboard();
        toast('저장했습니다');
        return id;
      } catch (e) { saveBtn.disabled = false; throw e; }
    }),
  }, '저장');

  mount(
    h('div', { class: 'row between' }, h('h1', {}, draft.id ? '양식 편집하기' : '새 양식 만들기'), h('button', { onclick: leave }, '← 취소')),
    src.info ? h('div', { class: 'card' }, h('div', {}, src.info), h('div', { class: 'muted' }, '인식 결과가 맞는지 확인하고, 필수 여부와 항목 유형을 조정하세요.')) : '',
    (src.warnings || []).map((w) => h('div', { class: 'warn' }, w)),
    h('div', { class: 'card' },
      h('label', { class: 'field' }, '자료 제목', titleHint, titleInput),
      h('label', { class: 'field' }, '안내 문구 (선택)', h('textarea', { value: draft.description, oninput: (e) => { draft.description = e.target.value; } })),
      h('div', {},
        h('label', {}, h('input', { type: 'checkbox', checked: draft.open, onchange: (e) => { draft.open = e.target.checked; } }), ' 자료 제출 허용하기')),
      h('div', { style: 'margin-top:8px' },
        h('label', {}, h('input', { type: 'checkbox', checked: !draft.listed, onchange: (e) => { draft.listed = !e.target.checked; } }), ' 비공개(체크 시 메인페이지에서 숨겨지며, 개별 응답 링크로만 응답을 받을 수 있습니다.)'))),
    h('div', { class: 'row between section-head' },
      h('div', { class: 'row' }, h('h2', {}, '입력 항목 편집'), draft.locked ? h('span', { class: 'lock-note' }, '이미 제출된 응답이 있어, 항목 이름·개수·순서는 바꿀 수 없습니다.') : ''),
      h('label', {}, allReq, ' 모든 항목 필수')),
    fieldsBox,
    h('div', { class: 'row end' },
      h('button', { disabled: draft.locked, onclick: () => { draft.fields.push({ label: '', type: 'text', required: false, description: '', options: [] }); renderFields(); } }, '+ 항목 추가'),
      saveBtn));
}

// ---------- 앱 소개 페이지 (주소 뒤에 아무것도 붙지 않았을 때) ----------
// 자료를 요구하는 분(관리 페이지 링크 포함)과 자료를 제출하러 온 분에게 각각 안내한다. 서버에 요청은 보내지 않는다.

function renderAbout() {
  const list = (items) => h('ul', { class: 'about-list' }, items.map((x) => h('li', {}, x)));
  const step = (no, title, text) => h('div', { class: 'card about-step' },
    h('span', { class: 'about-no', 'aria-hidden': 'true' }, no),
    h('strong', {}, title),
    h('p', { class: 'muted' }, text));
  // 기능 설명: 소제목(키워드) → 결론 한 줄 → 보충 설명 (두괄식)
  const feature = (keyword, headline, detail) => h('div', { class: 'about-feature' },
    h('span', { class: 'f-key' }, keyword),
    h('p', { class: 'f-head' }, headline),
    h('p', { class: 'muted f-detail' }, detail));  const block = (chip, title, lead, ...children) => h('section', { class: 'about-block' },
    h('span', { class: 'chip' }, chip),
    h('h2', { class: 'about-title' }, title),
    h('p', { class: 'muted about-lead' }, lead),
    ...children);

  mount(
    h('section', { class: 'about-hero' },
      h('h1', {}, '자료 수합, 링크 하나로 끝내요'),
      h('p', { class: 'lead' }, '메신저로 엑셀 양식을 돌리고, 돌아온 파일을 하나씩 열어 복사해 붙이던 번거로움을 줄여 주는 웹앱이에요.')),

    // ── 1) 자료를 요구하는 분
    block('자료를 요구하시는 분', '자료를 모으고 싶어요',
      '양식을 만들어 링크 하나로 선생님들께 전달하고, 들어온 응답은 엑셀로 내려받으세요.',
      h('h3', { class: 'about-sub' }, '이런 기능이 있어요'),
      h('div', { class: 'card about-features' }, [
        feature('양식 만들기', '필요한 항목으로 양식을 직접 만들 수 있어요.',
          '짧은 글, 긴 글, 숫자, 날짜, 전화번호, 이메일, 그리고 엑셀의 목록 선택처럼 쓰는 드롭다운을 지원해요. 항목마다 필수 여부도 정할 수 있어요.'),
        feature('엑셀 불러오기', '받아 둔 엑셀 양식을 올리면 양식 초안이 만들어져요.',
          '기관이나 단체에서 받은 엑셀 파일(.xlsx)의 제목 줄과 드롭다운 목록을 읽어 줘요. 여러 줄로 나뉜 제목도 인식해요.'),
        feature('여러 자료 한 곳에서', '링크 하나로 여러 자료를 한 곳에서 받을 수 있어요.',
          '자료마다 제출을 받을지 말지 정하고, 메인페이지 목록에 보일지(공개) 개별 링크로만 받을지(비공개)도 고를 수 있어요.'),
        feature('구글 시트·엑셀', '응답은 구글 시트에 쌓이고, 엑셀 파일로 내려받을 수 있어요.',
          '자료마다 시트가 따로 만들어져요. 엑셀 파일은 첫 줄에 항목 이름, 둘째 줄부터 응답이 들어가고 드롭다운도 그대로 살아 있어요.'),
        feature('요구자 표시', '자료 요구자 이름을 보여 줄지 숨길지 정할 수 있어요.',
          '이름을 보여 주면 선생님들 화면 오른쪽 위에 "요구자 : 홍길동 선생님"처럼 표시돼요. 비공개로 하면 이름은 서버에서 아예 내려가지 않아요.'),
      ]),      h('h3', { class: 'about-sub' }, '시작하는 방법'),
      h('div', { class: 'about-steps' },
        step('1', '내 서버 만들기', '내 구글 시트의 Apps Script에 코드를 붙여넣고 웹 앱으로 배포해요. 처음 한 번만 하면 돼요.'),
        step('2', '관리 페이지에서 연결', '배포한 주소를 입력하고, 관리용 아이디와 비밀번호를 정해요.'),
        step('3', '양식 만들고 링크 보내기', '양식을 만든 뒤 "링크 복사"로 받은 링크를 선생님들께 전달해요.')),
      h('div', { class: 'card' }, h('strong', {}, '이렇게 보관돼요'), list([
        '제출된 응답은 이 웹사이트가 아니라 내 구글 시트에 저장돼요. 이 웹사이트에는 응답이 남지 않아요.',
        '응답을 보고 내려받는 관리 기능은 아이디와 비밀번호로 보호돼요. 비밀번호를 여러 번 틀리면 잠시 잠겨요.',
      ])),
      h('div', { class: 'row end about-cta' },
        h('a', { class: 'linkbtn', href: '?admin' }, '관리 페이지로 가기'))),

    // ── 2) 자료를 제출하러 온 분
    block('자료를 제출하러 오신 분', '자료를 제출하러 왔어요',
      '이 페이지에서는 자료를 제출할 수 없어요. 자료 요구자가 보낸 링크로 접속해 주세요.',
      h('div', { class: 'card notice' },
        h('strong', {}, '링크를 받으셨나요?'),
        h('p', { class: 'muted' }, '받은 링크를 눌러 열면 제출할 자료를 고르거나, 바로 입력 화면이 나와요.')),
      h('h3', { class: 'about-sub' }, '제출은 이렇게 해요'),
      h('div', { class: 'about-steps' },
        step('1', '링크 열기', '자료 요구자에게 받은 링크를 열어요.'),
        step('2', '자료 고르기', '목록에서 제출할 자료를 눌러요. 링크에 따라 입력 화면이 바로 열리기도 해요.'),
        step('3', '입력하고 제출', '항목을 채워 제출하면 끝! 엑셀 파일을 다시 보내지 않아도 돼요.')),
      h('div', { class: 'card' }, h('strong', {}, '안심하고 제출하세요'), list([
        '제출한 내용은 자료 요구자의 구글 시트에만 저장돼요. 이 웹사이트에는 남지 않아요.',
        '링크를 아는 사람은 누구나 제출할 수 있어요. 자료 요구자에게 직접 받은 링크인지 확인하고, 모르는 사람이 보낸 링크에는 개인정보를 입력하지 마세요.',
        '링크가 열리지 않거나 받지 못했다면 자료를 요구한 분께 문의해 주세요.',
      ]))),

    h('p', { class: 'muted about-foot' }, '직접 운영해 보고 싶다면 GitHub의 rokeessam58/data-gathering 저장소에 있는 설명서(README)를 참고하세요.'),
  );
}
// ---------- 시작 ----------

(function start() {
  const params = new URLSearchParams(location.search);
  const id = params.get('f');
  // 주소 뒤에 아무것도 붙지 않았으면(관리자·자료·서버 정보가 없으면) 앱 소개 페이지를 보여준다.
  if (!params.has('admin') && !params.has('f') && !params.has('g')) return renderAbout();
  if (IS_ADMIN_PAGE) {
    if (!backendUrl) return renderSetup();
    return sessionStorage.getItem(PW_KEY) ? renderDashboard() : renderGate();
  }
  if (!backendUrl) return renderNoBackend();
  if (id) return renderRespondent(id);
  renderHome();
})();
