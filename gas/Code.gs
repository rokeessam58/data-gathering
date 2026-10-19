/**
 * 자료 수합 도우미 - Google Apps Script 백엔드
 *
 * 사용법: 데이터를 쌓을 구글 스프레드시트에서 [확장 프로그램 > Apps Script]로 열고 이 코드를 붙여넣으세요.
 * 관리자 비밀번호는 웹앱에 처음 접속할 때 화면에서 정할 수 있습니다.
 * (미리 정하려면 [프로젝트 설정 > 스크립트 속성]에 ADMIN_PASSWORD 를 직접 추가해도 됩니다.)
 * 배포: [배포 > 새 배포 > 웹 앱] 실행 계정 "나", 액세스 권한 "모든 사용자"
 */

const FORMS_SHEET = '_forms';
const FORMS_HEADER = ['id', 'title', 'description', 'fields', 'open', 'created', 'listed', 'sheetId'];
const TS_LABEL = '제출시각';
const TYPES = ['text', 'textarea', 'number', 'date', 'tel', 'email', 'select'];
const PUBLIC_ACTIONS = ['listPublic', 'getForm', 'submit', 'status', 'setPassword'];
const MIN_PASSWORD_LEN = 8;
const MAX_LEN = 2000;
// 로그인 잠금: 서버 전체에 하나의 잠금을 건다. (웹 앱은 요청한 기기/IP를 알 수 없다)
const LOCK_MAX_FAILS = 5;     // 비밀번호를 이 횟수만큼 틀리면
const LOCK_MINUTES = 5;       // 이 시간 동안 모든 관리자 요청을 막는다. (맞는 비밀번호도 거부)
const FAIL_WINDOW_MINUTES = 10; // 마지막 실패 후 이 시간이 지나면 실패 횟수를 다시 센다.

function doGet() {
  return out_({ ok: true, data: 'running' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (PUBLIC_ACTIONS.indexOf(req.action) < 0) checkAdmin_(req.password);
      return out_({ ok: true, data: route_(req) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 관리자 비밀번호 상태 (웹앱이 서버 주소를 저장할 때 첫 설정이 필요한지 확인하는 데 쓴다)
function status_() {
  return { passwordSet: !!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD'), ownerSet: ownerSet_() };
}

// 최초 1회 설정: 비밀번호가 아직 없을 때만 허용한다. 한 번 설정되면 웹에서는 바꿀 수 없다.
// (바꾸려면 Apps Script의 프로젝트 설정 → 스크립트 속성에서 ADMIN_PASSWORD 를 직접 수정)
function setPassword_(password) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMIN_PASSWORD')) throw new Error('이미 관리자 비밀번호가 설정되어 있습니다.');
  props.setProperty('ADMIN_PASSWORD', checkNewPassword_(password));
  return true;
}

function checkNewPassword_(password) {
  const pw = String(password == null ? '' : password);
  if (pw.length < MIN_PASSWORD_LEN || !/\S/.test(pw)) throw new Error('비밀번호는 ' + MIN_PASSWORD_LEN + '자 이상으로 정해 주세요.');
  if (pw.length > 100) throw new Error('비밀번호는 100자 이하로 정해 주세요.');
  return pw;
}

// 관리자 비밀번호 변경 (로그인한 관리자만. 요청의 현재 비밀번호는 doPost에서 이미 확인됨)
function changePassword_(newPassword) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD', checkNewPassword_(newPassword));
  props.deleteProperty('FAIL_COUNT');
  props.deleteProperty('LOCK_UNTIL');
  return true;
}

// 관리자 비밀번호 확인 + 로그인 잠금. 오류 문구 규칙(웹앱이 해석함):
//   'AUTH:남은횟수'  비밀번호가 틀림
//   'LOCKED:남은초'  잠금 중 (이 동안에는 맞는 비밀번호도 거부한다. 그렇지 않으면 잠금 중에도 추측이 가능하다)
// doPost의 스크립트 잠금 안에서 호출되므로 횟수 갱신이 겹치지 않는다.
function checkAdmin_(password) {
  const props = PropertiesService.getScriptProperties();
  const real = props.getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('관리자 비밀번호가 아직 설정되지 않았습니다.');

  const now = Date.now();
  const lockedUntil = Number(props.getProperty('LOCK_UNTIL') || 0);
  if (lockedUntil > now) throw new Error('LOCKED:' + Math.ceil((lockedUntil - now) / 1000)); // 잠금 중 시도는 잠금 시간을 늘리지 않는다

  if (String(password || '') === real) {
    if (props.getProperty('FAIL_COUNT')) props.deleteProperty('FAIL_COUNT');
    return;
  }

  // 틀림: 마지막 실패가 오래전이면 새로 세고, 아니면 이어서 센다.
  const lastFail = Number(props.getProperty('FAIL_AT') || 0);
  const prev = now - lastFail > FAIL_WINDOW_MINUTES * 60000 ? 0 : Number(props.getProperty('FAIL_COUNT') || 0);
  const fails = prev + 1;
  if (fails >= LOCK_MAX_FAILS) {
    props.setProperties({ LOCK_UNTIL: String(now + LOCK_MINUTES * 60000), FAIL_COUNT: '0', FAIL_AT: String(now) });
    throw new Error('LOCKED:' + LOCK_MINUTES * 60);
  }
  props.setProperties({ FAIL_COUNT: String(fails), FAIL_AT: String(now) });
  Utilities.sleep(800);
  throw new Error('AUTH:' + (LOCK_MAX_FAILS - fails));
}

function route_(req) {
  switch (req.action) {
    case 'status': return status_();
    case 'setPassword': return setPassword_(req.password);
    case 'listPublic': return listPublic_();
    case 'getForm': return getForm_(req.id);
    case 'submit': return submit_(req.id, req.values);
    case 'login': return login_(req.name, req.hidden, req.withOwner);
    case 'listForms': return dashboard_(req.withOwner);
    case 'me': return { owner: getOwner_() };
    case 'setOwner': return setOwner_(req.name, req.hidden);
    case 'changePassword': return changePassword_(req.newPassword);
    case 'saveForm': return saveForm_(req.form);
    case 'setOpen': return setOpen_(req.id, req.open);
    case 'deleteForm': return deleteForm_(req.id);
    case 'getData': return getData_(req.id);
    case 'deleteRow': return deleteRow_(req.id, req.index);
    default: throw new Error('알 수 없는 요청입니다.');
  }
}

// ---------- 양식 저장소 ----------

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function formsSheet_() {
  let sh = ss_().getSheetByName(FORMS_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(FORMS_SHEET);
    sh.getRange(1, 1, 1, FORMS_HEADER.length).setValues([FORMS_HEADER]);
    sh.getRange(1, 1, sh.getMaxRows(), FORMS_HEADER.length).setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function readForms_() {
  const sh = formsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, FORMS_HEADER.length).getValues().map(function (r, i) {
    return {
      row: i + 2,
      id: String(r[0]),
      title: String(r[1]),
      description: String(r[2]),
      fields: JSON.parse(r[3] || '[]'),
      open: String(r[4]) === 'true',
      listed: String(r[6]) !== 'false',
      sheetId: Number(r[7]),
    };
  });
}

function findForm_(id) {
  const f = readForms_().filter(function (x) { return x.id === String(id); })[0];
  if (!f) throw new Error('존재하지 않는 양식입니다.');
  return f;
}

// 시트 이름 = 자료 제목. 시트는 숫자 ID로 추적하므로 시트에서 이름을 직접 바꿔도 연결이 유지된다.
function dataSheet_(f) {
  const sh = ss_().getSheets().filter(function (s) { return s.getSheetId() === f.sheetId; })[0];
  return sh || null;
}

function mustDataSheet_(f) {
  const sh = dataSheet_(f);
  if (!sh) throw new Error('"' + f.title + '" 시트를 찾을 수 없습니다. 구글 시트에서 삭제되었는지 확인하세요.');
  return sh;
}

function checkTitle_(title, selfId) {
  if (/[:\\\/?*\[\]]/.test(title)) throw new Error('제목에는 : \\ / ? * [ ] 문자를 쓸 수 없습니다. (구글 시트 이름 규칙)');
  if (title.length > 100) throw new Error('제목은 100자 이내여야 합니다.');
  if (title.charAt(0) === "'" || title.charAt(title.length - 1) === "'") throw new Error('제목은 작은따옴표(\')로 시작하거나 끝날 수 없습니다.');
  const lower = title.toLowerCase();
  if (lower === FORMS_SHEET) throw new Error('사용할 수 없는 제목입니다.');
  const mine = selfId ? findForm_(selfId) : null;
  const taken = ss_().getSheets().some(function (s) {
    return s.getName().toLowerCase() === lower && !(mine && s.getSheetId() === mine.sheetId);
  });
  if (taken) throw new Error('같은 이름의 시트가 이미 있습니다. 제목을 다르게 지정하세요.');
}

function writeHeader_(sh, fields) {
  const labels = fields.map(function (f) { return f.label; }).concat([TS_LABEL]);
  const cols = labels.length;
  const range = sh.getRange(1, 1, 1, cols);
  range.setNumberFormat('@').setValues([labels]).setFontWeight('bold').setBackground('#e8eefc');
  sh.setFrozenRows(1);
}

// ---------- 공개 API ----------

// 선생님 첫 화면용: 접수 중인 자료 목록과 자료 요구자(관리자) 표시 정보.
// 비공개로 설정하면 이름은 서버에서 아예 내려보내지 않는다.
function listPublic_() {
  const forms = readForms_().filter(function (f) { return f.open && f.listed; }).map(function (f) {
    return { id: f.id, title: f.title, description: f.description };
  });
  const o = getOwner_();
  const owner = o.hidden ? { hidden: true } : o.name ? { name: o.name } : null;
  return { forms: forms, owner: owner };
}

// ---------- 자료 요구자(관리자) 정보 ----------

function getOwner_() {
  const p = PropertiesService.getScriptProperties();
  return { name: p.getProperty('OWNER_NAME') || '', hidden: p.getProperty('OWNER_HIDDEN') === 'true' };
}

// 요구자 정보를 이미 입력받았는지: 이름이 있거나, 이름 없이 비공개만 설정된 경우도 입력된 것으로 본다.
function ownerSet_() {
  const o = getOwner_();
  return !!o.name || o.hidden;
}

function saveOwner_(name, hidden) {
  const clean = String(name || '').trim().replace(/\s*선생님$/, '').slice(0, 30);
  PropertiesService.getScriptProperties().setProperties({ OWNER_NAME: clean, OWNER_HIDDEN: String(!!hidden) });
  return clean;
}

// 마이페이지에서 이름/비공개 변경 (비공개여도 이름은 보관해 두어 다시 공개할 때 쓴다)
function setOwner_(name, hidden) {
  const clean = String(name || '').trim().replace(/\s*선생님$/, '').slice(0, 30);
  if (!hidden && !clean) throw new Error('이름을 입력하거나 비공개로 설정해 주세요.');
  saveOwner_(clean, hidden === true);
  return getOwner_();
}

// 관리자 화면 첫 데이터: 양식 목록 (withOwner 이면 요구자 정보도 함께. 이전 화면은 배열만 받는다)
function dashboard_(withOwner) {
  const forms = listForms_();
  return withOwner ? { forms: forms, owner: getOwner_() } : forms;
}

// 관리자 로그인: 비밀번호 확인(doPost에서 처리) 후, 요구자 정보가 오면 저장하고 양식 목록을 돌려준다.
function login_(name, hidden, withOwner) {
  if (typeof hidden === 'boolean') saveOwner_(name, hidden);
  return dashboard_(withOwner);
}

function getForm_(id) {
  const f = findForm_(id);
  return { id: f.id, title: f.title, description: f.description, fields: f.fields, open: f.open };
}

function submit_(id, values) {
  const f = findForm_(id);
  if (!f.open) throw new Error('접수가 마감된 양식입니다.');
  if (!Array.isArray(values) || values.length !== f.fields.length) throw new Error('입력 항목이 올바르지 않습니다.');

  const row = f.fields.map(function (field, i) {
    const v = String(values[i] == null ? '' : values[i]).trim();
    if (v.length > MAX_LEN) throw new Error('"' + field.label + '" 항목이 너무 깁니다.');
    if (!v) {
      if (field.required) throw new Error('"' + field.label + '" 항목은 필수입니다.');
      return '';
    }
    if (field.type === 'select' && field.options.indexOf(v) < 0) throw new Error('"' + field.label + '" 항목의 선택값이 올바르지 않습니다.');
    if (field.type === 'number' && isNaN(Number(v))) throw new Error('"' + field.label + '" 항목은 숫자여야 합니다.');
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('"' + field.label + '" 항목의 이메일 형식이 올바르지 않습니다.');
    if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('"' + field.label + '" 항목의 날짜 형식이 올바르지 않습니다.');
    return v;
  });
  row.push(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'));

  const sh = mustDataSheet_(f);
  const r = sh.getLastRow() + 1;
  // 텍스트 서식을 먼저 지정해 "=..." 수식 실행과 "010" 앞자리 0 손실을 막는다.
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return true;
}

// ---------- 관리자 API ----------

function listForms_() {
  return readForms_().map(function (f) {
    const sh = dataSheet_(f);
    return {
      id: f.id,
      title: f.title,
      open: f.open,
      listed: f.listed,
      fieldCount: f.fields.length,
      count: sh ? Math.max(sh.getLastRow() - 1, 0) : 0,
    };
  });
}

function cleanFields_(fields) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 60) throw new Error('항목은 1~60개여야 합니다.');
  const seen = {};
  return fields.map(function (f) {
    const label = String(f.label || '').trim().slice(0, 100);
    if (!label) throw new Error('이름이 비어 있는 항목이 있습니다.');
    if (label === TS_LABEL) throw new Error('"' + TS_LABEL + '"은(는) 예약된 항목 이름입니다.');
    if (seen[label]) throw new Error('항목 이름이 중복되었습니다: ' + label);
    seen[label] = true;
    const type = TYPES.indexOf(f.type) >= 0 ? f.type : 'text';
    let options = [];
    if (type === 'select') {
      options = (f.options || []).map(function (o) { return String(o).trim(); }).filter(function (o) { return o; });
      if (!options.length) throw new Error('"' + label + '" 드롭다운에 선택지가 없습니다.');
    }
    return { label: label, type: type, required: !!f.required, options: options };
  });
}

function saveForm_(form) {
  const title = String((form && form.title) || '').trim();
  if (!title) throw new Error('자료 제목을 입력하세요.');
  const description = String(form.description || '').slice(0, 2000);
  const fields = cleanFields_(form.fields);
  const listed = String(form.listed !== false);
  const sh = formsSheet_();

  if (!form.id) {
    checkTitle_(title, null);
    const id = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    const created = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const data = ss_().insertSheet(title);
    writeHeader_(data, fields);
    const next = sh.getLastRow() + 1;
    sh.getRange(next, 1, 1, FORMS_HEADER.length).setNumberFormat('@')
      .setValues([[id, title, description, JSON.stringify(fields), String(!!form.open), created, listed, String(data.getSheetId())]]);
    return id;
  }

  const old = findForm_(form.id);
  const data = mustDataSheet_(old);
  const hasRows = data.getLastRow() > 1;
  const sameLabels = old.fields.length === fields.length &&
    old.fields.every(function (f, i) { return f.label === fields[i].label; });
  if (hasRows && !sameLabels) {
    throw new Error('이미 응답이 있어 항목 이름·개수·순서는 바꿀 수 없습니다. (선택지, 필수 여부, 제목은 수정 가능) 구조를 바꾸려면 새 자료를 만드세요.');
  }
  if (title !== old.title) {
    checkTitle_(title, old.id);
    data.setName(title);
  }
  sh.getRange(old.row, 1, 1, 5).setNumberFormat('@')
    .setValues([[old.id, title, description, JSON.stringify(fields), String(!!form.open)]]);
  sh.getRange(old.row, 7).setNumberFormat('@').setValue(listed);
  if (!hasRows) {
    data.clear();
    writeHeader_(data, fields);
  }
  return old.id;
}

function setOpen_(id, open) {
  const f = findForm_(id);
  formsSheet_().getRange(f.row, 5).setValue(String(!!open));
  return true;
}

function deleteForm_(id) {
  const f = findForm_(id);
  const sh = dataSheet_(f);
  if (sh) ss_().deleteSheet(sh);
  formsSheet_().deleteRow(f.row);
  return true;
}

function getData_(id) {
  const f = findForm_(id);
  const sh = mustDataSheet_(f);
  const last = sh.getLastRow();
  const cols = f.fields.length + 1;
  const values = last < 1 ? [] : sh.getRange(1, 1, last, cols).getDisplayValues();
  return {
    form: { id: f.id, title: f.title, fields: f.fields },
    headers: f.fields.map(function (x) { return x.label; }).concat([TS_LABEL]),
    rows: values.slice(1),
  };
}

function deleteRow_(id, index) {
  const f = findForm_(id);
  const sh = mustDataSheet_(f);
  const rowNo = Number(index) + 2;
  if (!(rowNo >= 2 && rowNo <= sh.getLastRow())) throw new Error('삭제할 행을 찾을 수 없습니다.');
  sh.deleteRow(rowNo);
  return true;
}
