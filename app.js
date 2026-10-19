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
  setPassword: '비밀번호를 설정하는 중이에요', login: '로그인하는 중이에요',
};
const SLOW_AFTER_MS = 6000;   // 이 시간이 지나도 응답이 없으면 "서버를 깨우는 중" 안내를 덧붙인다.
const SHOW_AFTER_MS = 200;    // 아주 빠른 응답에는 로딩 창이 깜빡이지 않도록 잠깐 기다린다.

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

function mount(...nodes) { $app.replaceChildren(...nodes.flat()); window.scrollTo(0, 0); }

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
    throw new Error(err);
  }
  return json.data;
}

const BASE = location.origin + location.pathname;
function homeLink() { return backendUrl ? BASE + '?g=' + encodeURIComponent(backendRef(backendUrl)) : BASE; }
function formLink(id) { return homeLink() + (backendUrl ? '&' : '?') + 'f=' + encodeURIComponent(id); }

// 누구나 자기 서버를 연결할 수 있는 구조라, 가짜 링크로 개인정보를 빼내려는 시도에 대비해 선생님 화면에 안내를 둔다.
function linkWarning() {
  return h('div', { class: 'warn', role: 'note' },
    '자료 요구자에게 직접 받은 링크인지 확인해 주세요. 모르는 사람이 보낸 링크라면 개인정보를 입력하지 마세요.');
}

// ---------- 첫 화면: 제출할 자료 선택 ----------

function renderNoBackend() {
  mount(h('h1', {}, '링크가 필요해요'),
    h('div', { class: 'card' },
      h('p', {}, '선생님이라면 관리자에게 받은 링크로 접속해 주세요.'),
      h('p', { class: 'muted' }, '이 주소만으로는 어느 자료를 제출해야 하는지 알 수 없습니다.')),
    h('p', { class: 'muted' }, '관리자라면 ', h('a', { href: '?admin' }, '관리자 화면'), '으로 들어가세요.'));
}

async function renderHome() {
  if (!backendUrl) return renderNoBackend();
  let data;
  try { data = await api('listPublic'); } catch (e) { return mount(h('div', { class: 'card' }, h('p', {}, e.message))); }
  // 서버 버전에 따라 배열(이전) 또는 {forms, owner}(요구자 표시 지원)로 온다.
  const list = Array.isArray(data) ? data : data.forms;
  const owner = Array.isArray(data) ? null : data.owner;
  mount(
    h('div', { class: 'title-row' },
      h('h1', {}, '제출할 자료를 선택하세요.'),
      owner ? h('span', { class: 'owner' }, ownerText(owner)) : ''),
    list.length
      ? list.map((f) => h('a', { class: 'card pick', href: formLink(f.id) },
        h('strong', {}, f.title),
        f.description ? h('div', { class: 'muted pre' }, f.description) : ''))
      : h('p', { class: 'muted' }, '현재 접수 중인 자료가 없습니다.'),
    linkWarning(),
    h('p', { class: 'muted' }, h('a', { href: '?admin' }, '관리자')));
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
  form.fields.map((f, i) => h('label', { class: 'field' },
    f.label, f.required ? h('span', { class: 'req' }, ' *') : '', inputs[i])),
  btn);

  mount(h('h1', {}, form.title), form.description ? h('p', { class: 'muted', style: 'white-space:pre-wrap' }, form.description) : '',
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
function codeGsUrl() {
  const m = /^([\w-]+)\.github\.io$/.exec(location.hostname);
  const repo = location.pathname.split('/')[1];
  return m && repo ? `https://github.com/${m[1]}/${repo}/blob/main/gas/Code.gs` : '';
}

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
  const link = codeGsUrl();
  const btn = h('button', { class: 'primary', type: 'submit' }, '확인하고 저장');
  mount(h('h1', {}, '서버 연결'),
    h('p', { class: 'muted' }, '자료는 관리자의 구글 시트에 쌓입니다. 아래 순서로 Apps Script 웹 앱을 만들고 주소를 입력하세요. 한 번 입력하면 이 브라우저에 저장됩니다.'),
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
        h('li', {}, '새 구글 스프레드시트를 만들고 ', h('b', {}, '확장 프로그램 → Apps Script'), '를 엽니다.'),
        h('li', {}, link ? h('span', {}, h('a', { href: link, target: '_blank', rel: 'noopener' }, 'Code.gs'), ' 내용을 복사해 붙여넣고 저장합니다.') : 'gas/Code.gs 내용을 복사해 붙여넣고 저장합니다.'),
        h('li', {}, h('b', {}, '배포 → 새 배포 → 웹 앱'), ': 실행 계정 "나", 액세스 권한 "모든 사용자"로 배포하고 권한을 승인합니다.'),
        h('li', {}, '표시되는 웹 앱 URL(…/exec)을 위 칸에 붙여넣습니다.'),
        h('li', {}, '관리자 비밀번호는 다음 화면에서 처음 한 번 정하면 됩니다.'))));
}

let prefetched = null; // 로그인 응답에 실려 온 {forms, owner} (대시보드가 한 번 더 요청하지 않도록)
let ownerDraft = null; // 로그인에 실패해 화면이 다시 그려져도 입력하던 이름·비공개 값을 유지하기 위한 임시 값

// 서버 응답을 {forms, owner} 로 통일한다. (이전 서버는 양식 배열만 돌려준다)
function normalizeDash(res) {
  if (Array.isArray(res)) { const p = loadProfile(); return { forms: res, owner: p ? { name: p.name, hidden: p.hidden } : null }; }
  if (res && Array.isArray(res.forms)) return { forms: res.forms, owner: res.owner || null, idSet: res.idSet };
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
  const { forms, owner } = dash;
  saveIdSet(dash.idSet);
  if (dash.idSet === false) return renderSetAdminId(); // 서버에 아이디가 없으면 먼저 정하게 한다 (이전 서버는 idSet 을 주지 않아 해당 없음)
  rememberOwner(owner);
  const greeting = owner && owner.name ? `${owner.name} 선생님, 안녕하세요!` : '안녕하세요!';

  const fileInput = h('input', {
    type: 'file', accept: '.xlsx', style: 'display:none',
    onchange: async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try { openEditor({ ...(await XlsxIO.parseTemplate(file)), description: '', open: true }); } catch (e) { toast(e.message); }
      fileInput.value = '';
    },
  });

  mount(
    h('div', { class: 'row between head-row' }, h('h1', {}, '자료 수합 관리'),
      h('div', { class: 'head-right' }, h('span', { class: 'greet' }, greeting), adminMenu())),
    h('div', { class: 'card' },
      h('strong', {}, '선생님용 첫 화면 링크'),
      h('div', { class: 'muted' }, '목록에 표시된 접수 중 자료가 나열됩니다.'),
      linkBox(homeLink())),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => openEditor({ title: '', description: '', open: true, fields: [{ label: '', type: 'text', required: true, options: [] }] }) }, '+ 새 양식 만들기'),
      h('button', { onclick: () => fileInput.click() }, '엑셀 양식 불러오기'), fileInput,
      h('label', { class: 'muted' }, h('input', { type: 'checkbox', onchange: (e) => { includeTs = e.target.checked; } }), ' 다운로드 시 제출시각 열 포함')),
    forms.length ? forms.map(formCard) : h('p', { class: 'muted' }, '아직 만든 양식이 없습니다.'),
  );
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
    preview.textContent = '선생님 화면 표시: ' + (v.hidden ? '요구자 : 비공개' : v.name ? `요구자 : ${v.name} 선생님` : '(이름을 입력해 주세요)');
  };
  owner.node.addEventListener('input', refreshPreview);
  owner.node.addEventListener('change', refreshPreview);
  refreshPreview();

  const newPw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: `새 비밀번호 (${MIN_PW_LEN}자 이상)`, required: true });
  const newPw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호를 한 번 더 입력', required: true });

  mount(
    h('div', { class: 'row between' }, h('h1', {}, '마이페이지'), h('button', { onclick: () => renderDashboard() }, '← 돌아가기')),
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
    h('div', { style: 'margin-top:14px' }, h('button', { class: 'primary', type: 'submit' }, '저장'))),
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

function linkBox(url) {
  const link = h('input', { readonly: true, value: url, onfocus: (e) => e.target.select() });
  return h('div', { class: 'linkbox' }, link,
    h('button', { class: 'sm', onclick: async () => { try { await navigator.clipboard.writeText(link.value); toast('링크를 복사했습니다'); } catch (e) { link.select(); toast('Ctrl+C로 복사하세요'); } } }, '링크 복사'));
}

function formCard(f) {
  return h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('strong', {}, f.title),
      h('span', { class: 'row' },
        f.listed ? '' : h('span', { class: 'badge' }, '목록 숨김'),
        h('span', { class: 'badge ' + (f.open ? 'open' : '') }, f.open ? '접수 중' : '마감'))),
    h('div', { class: 'muted' }, `항목 ${f.fieldCount}개 · 응답 ${f.count}건`),
    linkBox(formLink(f.id)),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'sm primary', onclick: () => guard(async () => { await XlsxIO.downloadResponses(await api('getData', { id: f.id }), includeTs); }) }, '엑셀 다운로드'),
      h('button', { class: 'sm', onclick: () => renderResponses(f.id) }, '응답 보기'),
      h('button', { class: 'sm', onclick: async () => { const form = await guard(() => api('getForm', { id: f.id })); if (form) openEditor(form); } }, '편집'),
      h('button', { class: 'sm', onclick: () => guard(async () => { await api('setOpen', { id: f.id, open: !f.open }); renderDashboard(); }) }, f.open ? '마감하기' : '다시 열기'),
      h('button', { class: 'sm danger', onclick: () => { if (confirm(`"${f.title}" 양식과 응답 ${f.count}건을 모두 삭제할까요? 되돌릴 수 없습니다.`)) guard(async () => { await api('deleteForm', { id: f.id }); renderDashboard(); }); } }, '삭제')));
}

// ---------- 관리자: 응답 보기 ----------

async function renderResponses(id) {
  const data = await guard(() => api('getData', { id }));
  if (!data) return;
  const body = data.rows.map((r, i) => h('tr', {}, r.map((v) => h('td', {}, v)),
    h('td', {}, h('button', { class: 'sm danger', onclick: () => { if (confirm('이 응답을 삭제할까요?')) guard(async () => { await api('deleteRow', { id, index: i }); renderResponses(id); }); } }, '삭제'))));
  mount(
    h('div', { class: 'row between' }, h('h1', {}, data.form.title), h('button', { onclick: renderDashboard }, '← 목록')),
    h('p', { class: 'muted' }, `응답 ${data.rows.length}건`),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, data.headers.map((x) => h('th', {}, x)), h('th', {}, ''))), h('tbody', {}, body))));
}

// ---------- 관리자: 양식 편집기 ----------

function openEditor(src) {
  const draft = {
    id: src.id, title: src.title || '', description: src.description || '', open: src.open !== false, listed: src.listed !== false,
    fields: src.fields.map((f) => ({ label: f.label, type: f.type, required: !!f.required, options: [...(f.options || [])] })),
  };
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
          h('input', { placeholder: '항목 이름 (예: 이름, 연락처)', value: f.label, oninput: (e) => { f.label = e.target.value; } }),
          h('select', { value: f.type, onchange: (e) => { f.type = e.target.value; renderFields(); } },
            Object.entries(TYPE_LABELS).map(([k, v]) => h('option', { value: k }, v)))),
        f.type === 'select' ? h('div', { style: 'margin-top:8px' }, optBox) : '',
        h('div', { class: 'row between', style: 'margin-top:8px' },
          h('label', {}, h('input', { type: 'checkbox', checked: f.required, onchange: (e) => { f.required = e.target.checked; syncAllReq(); } }), ' 필수'),
          h('div', { class: 'row' },
            h('button', { class: 'sm', disabled: i === 0, onclick: () => { move(i, -1); } }, '↑'),
            h('button', { class: 'sm', disabled: i === draft.fields.length - 1, onclick: () => { move(i, 1); } }, '↓'),
            h('button', { class: 'sm danger', onclick: () => { draft.fields.splice(i, 1); renderFields(); } }, '삭제'))));
    }));
  }
  function move(i, d) { const [x] = draft.fields.splice(i, 1); draft.fields.splice(i + d, 0, x); renderFields(); }
  renderFields();

  const saveBtn = h('button', {
    class: 'primary',
    onclick: () => guard(async () => {
      if (!draft.title.trim()) return toast('양식 제목을 입력하세요');
      saveBtn.disabled = true;
      try {
        const id = await api('saveForm', { form: draft });
        await renderDashboard();
        toast('저장했습니다');
        return id;
      } catch (e) { saveBtn.disabled = false; throw e; }
    }),
  }, '저장');

  mount(
    h('div', { class: 'row between' }, h('h1', {}, draft.id ? '양식 편집' : '새 양식'), h('button', { onclick: renderDashboard }, '← 취소')),
    src.info ? h('div', { class: 'card' }, h('div', {}, src.info), h('div', { class: 'muted' }, '인식 결과가 맞는지 확인하고, 필수 여부와 항목 유형을 조정하세요.')) : '',
    (src.warnings || []).map((w) => h('div', { class: 'warn' }, w)),
    h('div', { class: 'card' },
      h('label', { class: 'field' }, '자료 제목',
        h('span', { class: 'hint' }, '구글 시트의 시트 이름으로 사용됩니다. 다른 자료와 겹치거나 : \\ / ? * [ ] 문자가 있으면 안 됩니다.'),
        h('input', { value: draft.title, oninput: (e) => { draft.title = e.target.value; } })),
      h('label', { class: 'field' }, '안내 문구 (선택)', h('textarea', { value: draft.description, oninput: (e) => { draft.description = e.target.value; } })),
      h('div', {},
        h('label', {}, h('input', { type: 'checkbox', checked: draft.open, onchange: (e) => { draft.open = e.target.checked; } }), ' 접수 중')),
      h('div', { style: 'margin-top:8px' },
        h('label', {}, h('input', { type: 'checkbox', checked: draft.listed, onchange: (e) => { draft.listed = e.target.checked; } }), ' 첫 화면 목록에 표시 (끄면 링크를 아는 사람만 접근)'))),
    h('div', { class: 'row between' },
      h('h2', {}, '입력 항목'),
      h('label', {}, allReq, ' 모든 항목 필수')),
    fieldsBox,
    h('div', { class: 'row' },
      h('button', { onclick: () => { draft.fields.push({ label: '', type: 'text', required: false, options: [] }); renderFields(); } }, '+ 항목 추가'),
      saveBtn),
    draft.id ? h('p', { class: 'muted' }, '이미 응답이 있는 양식은 항목 이름·개수·순서를 바꿀 수 없습니다.') : '');
}

// ---------- 시작 ----------

(function start() {
  const params = new URLSearchParams(location.search);
  const id = params.get('f');
  if (IS_ADMIN_PAGE) {
    if (!backendUrl) return renderSetup();
    return sessionStorage.getItem(PW_KEY) ? renderDashboard() : renderGate();
  }
  if (!backendUrl) return renderNoBackend();
  if (id) return renderRespondent(id);
  renderHome();
})();
