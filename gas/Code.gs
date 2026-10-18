/**
 * 자료 수집 웹앱 - Google Apps Script 백엔드
 *
 * 사용법: 데이터를 쌓을 구글 스프레드시트에서 [확장 프로그램 > Apps Script]로 열고 이 코드를 붙여넣은 뒤,
 * [프로젝트 설정 > 스크립트 속성]에 ADMIN_PASSWORD 를 추가하세요.
 * 배포: [배포 > 새 배포 > 웹 앱] 실행 계정 "나", 액세스 권한 "모든 사용자"
 */

const FORMS_SHEET = '_forms';
const FORMS_HEADER = ['id', 'title', 'description', 'fields', 'open', 'created', 'listed', 'sheetId'];
const TS_LABEL = '제출시각';
const TYPES = ['text', 'textarea', 'number', 'date', 'tel', 'email', 'select'];
const PUBLIC_ACTIONS = ['listPublic', 'getForm', 'submit'];
const MAX_LEN = 2000;

function doGet() {
  return out_({ ok: true, data: 'running' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (PUBLIC_ACTIONS.indexOf(req.action) < 0) checkAdmin_(req.password);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
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

function checkAdmin_(password) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('스크립트 속성에 ADMIN_PASSWORD 가 설정되어 있지 않습니다.');
  if (String(password || '') !== real) {
    Utilities.sleep(800);
    throw new Error('AUTH');
  }
}

function route_(req) {
  switch (req.action) {
    case 'listPublic': return listPublic_();
    case 'getForm': return getForm_(req.id);
    case 'submit': return submit_(req.id, req.values);
    case 'login': return true;
    case 'listForms': return listForms_();
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

function listPublic_() {
  return readForms_().filter(function (f) { return f.open && f.listed; }).map(function (f) {
    return { id: f.id, title: f.title, description: f.description };
  });
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
