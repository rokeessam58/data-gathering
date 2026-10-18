/* 자료 수집 웹앱 프론트엔드 (빌드 불필요) */
const $app = document.getElementById('app');
const TYPE_LABELS = {
  text: '짧은 글', textarea: '긴 글', number: '숫자', date: '날짜', tel: '전화번호', email: '이메일', select: '드롭다운',
};
const PW_KEY = 'dg_admin_pw';
const SLOW_HINT = '불러오는 중… (한동안 쓰지 않았다면 첫 응답에 길게는 30초 이상 걸릴 수 있습니다)';

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

function storedBackend() {
  try { return parseBackend(localStorage.getItem(BACKEND_KEY)); } catch (e) { return null; }
}

function saveBackend(url) {
  try { localStorage.setItem(BACKEND_KEY, url); } catch (e) { toast('이 브라우저에서는 주소를 저장할 수 없습니다.'); }
}

const IS_ADMIN_PAGE = new URLSearchParams(location.search).has('admin');
// 관리자 화면은 링크로 전달된 주소를 절대 쓰지 않는다. (비밀번호가 엉뚱한 서버로 가는 것을 방지)
const backendUrl = IS_ADMIN_PAGE
  ? storedBackend()
  : (parseBackend(new URLSearchParams(location.search).get('g')) || storedBackend());

// 링크에 넣을 짧은 식별자: 일반 계정은 배포 ID만, 학교(Workspace) 계정 주소는 전체 주소
function backendRef(url) { const m = STD_RE.exec(url || ''); return m ? m[1] : url; }

async function api(action, payload) {
  const url = backendUrl;
  if (!url) throw new Error('연결된 서버 정보가 없습니다. 관리자에게 받은 링크로 다시 접속해 주세요.');
  // 관리자 비밀번호는 관리자가 직접 저장한 주소로만 보낸다.
  const password = url === storedBackend() ? sessionStorage.getItem(PW_KEY) || '' : '';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight 회피
      body: JSON.stringify({ action, password, ...payload }),
    });
  } catch (e) {
    throw new Error('서버에 연결하지 못했습니다. 네트워크와 배포 설정(액세스: 모든 사용자)을 확인하세요.');
  }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('서버 응답을 해석하지 못했습니다. 배포 URL을 확인하세요.'); }
  if (!json.ok) {
    if (json.error === 'AUTH') {
      sessionStorage.removeItem(PW_KEY);
      throw Object.assign(new Error('관리자 비밀번호가 올바르지 않습니다.'), { auth: true });
    }
    throw new Error(json.error);
  }
  return json.data;
}

const BASE = location.origin + location.pathname;
function homeLink() { return backendUrl ? BASE + '?g=' + encodeURIComponent(backendRef(backendUrl)) : BASE; }
function formLink(id) { return homeLink() + (backendUrl ? '&' : '?') + 'f=' + encodeURIComponent(id); }

// ---------- 첫 화면: 제출할 자료 선택 ----------

function renderNoBackend() {
  mount(h('h1', {}, '자료 수집'),
    h('div', { class: 'card' },
      h('p', {}, '선생님이라면 관리자에게 받은 링크로 접속해 주세요.'),
      h('p', { class: 'muted' }, '이 주소만으로는 어느 자료를 제출해야 하는지 알 수 없습니다.')),
    h('p', { class: 'muted' }, '관리자라면 ', h('a', { href: '?admin' }, '관리자 화면'), '으로 들어가세요.'));
}

async function renderHome() {
  if (!backendUrl) return renderNoBackend();
  mount(h('p', { class: 'muted' }, SLOW_HINT));
  let list;
  try { list = await api('listPublic'); } catch (e) { return mount(h('div', { class: 'card' }, h('p', {}, e.message))); }
  mount(
    h('h1', {}, '제출할 자료를 선택하세요'),
    list.length
      ? list.map((f) => h('a', { class: 'card pick', href: formLink(f.id) },
        h('strong', {}, f.title),
        f.description ? h('div', { class: 'muted pre' }, f.description) : ''))
      : h('p', { class: 'muted' }, '현재 접수 중인 자료가 없습니다.'),
    h('p', { class: 'muted' }, h('a', { href: '?admin' }, '관리자')));
}

// ---------- 응답자 화면 ----------

async function renderRespondent(id) {
  mount(h('p', { class: 'muted' }, '불러오는 중…'));
  let form;
  try { form = await api('getForm', { id }); } catch (e) { return mount(h('div', { class: 'card' }, h('h2', {}, '열 수 없는 양식입니다'), h('p', {}, e.message))); }

  if (!form.open) return mount(h('div', { class: 'card' }, h('h1', {}, form.title), h('p', {}, '접수가 마감되었습니다.')));

  const inputs = form.fields.map(buildInput);
  const btn = h('button', { class: 'primary', type: 'submit' }, '제출');
  const formEl = h('form', {
    novalidate: false,
    onsubmit: async (ev) => {
      ev.preventDefault();
      btn.disabled = true; btn.textContent = '제출 중…';
      try {
        await api('submit', { id, values: inputs.map((i) => i.value) });
        mount(h('div', { class: 'card' }, h('h2', {}, '제출되었습니다'), h('p', {}, '입력해 주셔서 감사합니다.'),
          h('div', { class: 'row' },
            h('button', { onclick: () => renderRespondent(id) }, '같은 자료 다시 입력'),
            h('a', { href: homeLink() }, h('button', { class: 'primary' }, '자료 목록으로')))));
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '제출'; }
    },
  },
  form.fields.map((f, i) => h('label', { class: 'field' },
    f.label, f.required ? h('span', { class: 'req' }, ' *') : '', inputs[i])),
  btn);

  mount(h('p', { class: 'muted' }, h('a', { href: homeLink() }, '← 자료 목록')),
    h('h1', {}, form.title), form.description ? h('p', { class: 'muted', style: 'white-space:pre-wrap' }, form.description) : '',
    h('div', { class: 'card' }, formEl));
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

function renderSetup(msg) {
  const url = h('input', { placeholder: 'https://script.google.com/macros/s/…/exec', value: storedBackend() || '', required: true, autocomplete: 'off' });
  const link = codeGsUrl();
  mount(h('h1', {}, '서버 연결'),
    h('p', { class: 'muted' }, '자료는 관리자의 구글 시트에 쌓입니다. 아래 순서로 Apps Script 웹 앱을 만들고 주소를 입력하세요. 한 번 입력하면 이 브라우저에 저장됩니다.'),
    h('form', {
      class: 'card',
      onsubmit: (e) => {
        e.preventDefault();
        const parsed = parseBackend(url.value);
        if (!parsed) return renderSetup('올바른 Apps Script 웹 앱 주소(…/exec)가 아닙니다.');
        saveBackend(parsed);
        sessionStorage.removeItem(PW_KEY);
        location.href = BASE + '?admin';
      },
    },
    h('label', { class: 'field' }, 'Apps Script 웹 앱 주소', url),
    msg ? h('p', { style: 'color:var(--danger)' }, msg) : '',
    h('button', { class: 'primary', type: 'submit' }, '저장하고 계속')),
    h('div', { class: 'card' },
      h('h2', {}, '처음 한 번만 하는 설정'),
      h('ol', {},
        h('li', {}, '새 구글 스프레드시트를 만들고 ', h('b', {}, '확장 프로그램 → Apps Script'), '를 엽니다.'),
        h('li', {}, link ? h('span', {}, h('a', { href: link, target: '_blank', rel: 'noopener' }, 'Code.gs'), ' 내용을 복사해 붙여넣고 저장합니다.') : 'gas/Code.gs 내용을 복사해 붙여넣고 저장합니다.'),
        h('li', {}, h('b', {}, '프로젝트 설정 → 스크립트 속성'), '에 ', h('code', {}, 'ADMIN_PASSWORD'), ' 를 추가하고 값에 관리자 비밀번호를 적습니다.'),
        h('li', {}, h('b', {}, '배포 → 새 배포 → 웹 앱'), ': 실행 계정 "나", 액세스 권한 "모든 사용자"로 배포하고 권한을 승인합니다.'),
        h('li', {}, '표시되는 웹 앱 URL(…/exec)을 위 칸에 붙여넣습니다.'))));
}

function renderGate(msg) {
  if (!backendUrl) return renderSetup();
  const pw = h('input', { type: 'password', placeholder: '관리자 비밀번호', autocomplete: 'current-password', required: true });
  mount(h('h1', {}, '자료 수집 관리'),
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        sessionStorage.setItem(PW_KEY, pw.value);
        renderDashboard(); // 비밀번호 검증은 목록 요청과 함께 처리 (요청 1회로 단축)
      },
    }, h('label', { class: 'field' }, '관리자 로그인', pw), msg ? h('p', { class: 'req', style: 'color:var(--danger)' }, msg) : '',
    h('button', { class: 'primary', type: 'submit' }, '로그인')),
    h('p', { class: 'muted' }, '연결된 서버: …' + backendRef(backendUrl).slice(-8) + ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderSetup(); } }, '변경')));
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
  mount(h('p', { class: 'muted' }, SLOW_HINT));
  let forms;
  try { forms = await api('listForms'); } catch (e) {
    if (e.auth) return renderGate(e.message);
    return mount(h('div', { class: 'card' }, h('p', {}, e.message), h('button', { onclick: renderDashboard }, '다시 시도')));
  }

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
    h('div', { class: 'row between' }, h('h1', {}, '자료 수집 관리'),
      h('div', { class: 'row' },
        h('button', { class: 'sm', onclick: renderSetup }, '서버 변경'),
        h('button', { class: 'sm', onclick: () => { sessionStorage.removeItem(PW_KEY); renderGate(); } }, '로그아웃'))),
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
