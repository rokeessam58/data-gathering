/* 엑셀 양식 인식(가져오기)과 응답 내보내기. ExcelJS 필요. */
(function (root) {
  const TYPE_HINTS = [
    [/이메일|e-?mail|메일/i, 'email'],
    [/연락처|전화|휴대|핸드폰|폰번호|tel|phone/i, 'tel'],
    [/생년월일|생일|날짜|일자/, 'date'],
  ];

  function guessType(label) {
    for (const [re, t] of TYPE_HINTS) if (re.test(label)) return t;
    return 'text';
  }

  function cellText(cell) {
    try { return String(cell.text == null ? '' : cell.text).trim(); } catch (e) { return ''; }
  }

  // ---- 제목 영역(여러 행) 인식 ----
  const isLabel = (t) => !!t && !/^[\d.,\s-]+$/.test(t);
  const masterOf = (cell) => (cell.isMerged && cell.master ? cell.master : cell);
  const txt = (cell) => cellText(masterOf(cell)).replace(/\s+/g, ' ');
  // 가로 병합의 오른쪽 칸(값은 왼쪽 칸이 대표)
  const isHSlave = (cell) => cell.isMerged && cell.master && cell.master.address !== cell.address && cell.master.row === cell.row;
  const isVSlave = (cell, r) => cell.isMerged && cell.master && cell.master.row < r;

  function hSpan(ws, cell) {
    if (!cell.isMerged) return 1;
    const m = cell.master;
    let n = 0;
    for (let c = m.col; ; c++) {
      const x = ws.getCell(m.row, c);
      if (x.isMerged && x.master.address === m.address) n++; else break;
    }
    return Math.max(n, 1);
  }

  function rowLabels(ws, r) {
    const out = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      if (isHSlave(cell)) return;
      const t = txt(cell);
      if (isLabel(t)) out.push({ c, t });
    });
    return out;
  }

  function rowHasValidation(ws, r) {
    let found = false;
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => { if (cell.dataValidation && cell.dataValidation.type) found = true; });
    return found;
  }

  // 아래 행이 "제목의 연속"인지: 위 제목이 가로로 묶여 있고 그 밑에 세부 제목이 있거나, 세로 병합이 이어지는 경우
  function continuesHeader(ws, bottom, r) {
    if (rowHasValidation(ws, r)) return false;
    let sub = 0, own = 0;
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      if (isHSlave(cell)) return;
      const t = txt(cell);
      if (!isLabel(t)) return;
      if (isVSlave(cell, r)) { sub++; return; }
      own++;
      const above = ws.getCell(bottom, c);
      if (above.isMerged && hSpan(ws, above) > 1) sub++;
    });
    return sub > 0 && own > 0;
  }

  // 위 행이 "상위 그룹 제목"인지: 전체 폭이 아닌 가로 병합 제목이 있는 경우
  function isGroupRow(ws, r, colCount) {
    let found = false;
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      if (isHSlave(cell) || !isLabel(txt(cell))) return;
      const s = hSpan(ws, cell);
      if (s > 1 && s < colCount) found = true;
    });
    return found;
  }

  // 앞쪽 15행 중 제목 칸이 가장 많은 행을 기준으로 위·아래로 제목 영역을 넓힌다.
  function detectHeader(ws) {
    let R = 0, best = 0;
    const last = Math.min(ws.rowCount, 15);
    for (let r = 1; r <= last; r++) {
      const n = rowLabels(ws, r).length;
      if (n > best) { best = n; R = r; }
    }
    if (!R) return null;

    let bottom = R;
    while (bottom < R + 3 && bottom < ws.rowCount && continuesHeader(ws, bottom, bottom + 1)) bottom++;

    const leaf = rowLabels(ws, bottom);
    let top = R;
    while (top > 1 && top > R - 3 && isGroupRow(ws, top - 1, leaf.length)) top--;

    const cols = leaf.map(({ c }) => {
      const parts = [];
      for (let r = top; r <= bottom; r++) {
        const cell = ws.getCell(r, c);
        const t = txt(cell);
        if (!isLabel(t)) continue;
        if (cell.isMerged && leaf.length > 1 && hSpan(ws, cell) >= leaf.length) continue; // 표 전체 제목
        if (parts[parts.length - 1] !== t) parts.push(t);
      }
      return { c, label: parts.join(' - ') };
    }).filter((x) => x.label);
    return cols.length ? { top, bottom, cols } : null;
  }

  // 데이터 유효성 목록 수식 → 선택지 배열
  function resolveList(wb, ws, formula) {
    if (!formula) return [];
    let f = String(formula).trim();
    if (f.startsWith('=')) f = f.slice(1);
    if (f.startsWith('"')) {
      return f.replace(/^"|"$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(f);
    if (!m) return []; // 이름 정의 등은 지원하지 않음
    const sheet = m[1] ? wb.getWorksheet(m[1]) : ws;
    if (!sheet) return [];
    const c1 = colNum(m[2]), r1 = +m[3];
    const c2 = m[4] ? colNum(m[4]) : c1, r2 = m[5] ? +m[5] : r1;
    const out = [];
    for (let r = r1; r <= r2 && out.length < 500; r++) {
      for (let c = c1; c <= c2; c++) {
        const t = cellText(sheet.getCell(r, c));
        if (t) out.push(t);
      }
    }
    return out;
  }

  function colNum(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  // 한컴 셀 등이 만든 파일은 <x:sheet> 처럼 태그에 네임스페이스 접두어가 붙어 있어 ExcelJS가 읽지 못한다
  // ("reading 'company'" 등). 접두어를 표준 형태(기본 네임스페이스)로 바꾸고 문서 정보 파일은 제거해 다시 읽는다.
  const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  function stripMainPrefix(xml) {
    const m = new RegExp('xmlns:([A-Za-z_][\\w.-]*)="' + MAIN_NS + '"').exec(xml);
    if (!m) return xml;
    const p = m[1];
    return xml
      .replace(new RegExp('(</?)' + p + ':', 'g'), '$1')
      .replace('xmlns:' + p + '="' + MAIN_NS + '"', 'xmlns="' + MAIN_NS + '"');
  }

  async function loadWorkbook(buf) {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      return wb;
    } catch (firstErr) {
      if (typeof JSZip === 'undefined') throw firstErr;
      try {
        const zip = await JSZip.loadAsync(buf);
        zip.remove('docProps/app.xml');
        const parts = Object.keys(zip.files).filter((n) => /^xl\/.*\.xml$/.test(n) && !/\.rels$/.test(n));
        for (const name of parts) {
          zip.file(name, stripMainPrefix(await zip.file(name).async('string')));
        }
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await zip.generateAsync({ type: 'arraybuffer' }));
        return wb;
      } catch (e) {
        throw new Error('엑셀 파일을 읽지 못했습니다. 엑셀에서 열어 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 다시 저장한 뒤 올려 주세요. (' + firstErr.message + ')');
      }
    }
  }

  async function parseTemplate(file) {
    if (!/\.xlsx$/i.test(file.name)) {
      throw new Error('.xlsx 파일만 읽을 수 있습니다. .xls 파일은 엑셀에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 변환해 주세요.');
    }
    const wb = await loadWorkbook(await file.arrayBuffer());

    let best = null;
    for (const ws of wb.worksheets) {
      if (ws.state !== 'visible') continue;
      const h = detectHeader(ws);
      if (h && (!best || h.cols.length > best.h.cols.length)) best = { ws, h };
    }
    if (!best) throw new Error('제목 행을 찾지 못했습니다. 첫 줄에 항목 이름이 있는 파일인지 확인해 주세요.');

    const { ws, h } = best;
    const warnings = [];
    const used = {};
    const fields = h.cols.map(({ c, label }) => {
      let name = label, n = 2;
      while (used[name]) name = label + ' (' + n++ + ')';
      used[name] = true;

      let type = guessType(name);
      let options = [];
      let dv = null;
      for (const r of [h.bottom + 1, h.bottom + 2]) {
        const cell = ws.getCell(r, c);
        if (cell.dataValidation && cell.dataValidation.type) { dv = cell.dataValidation; break; }
      }
      if (dv) {
        if (dv.type === 'list') {
          options = resolveList(wb, ws, dv.formulae && dv.formulae[0]);
          if (options.length) type = 'select';
          else warnings.push('"' + name + '" 항목은 드롭다운이지만 선택지를 읽지 못했습니다. 직접 입력해 주세요.');
        } else if (dv.type === 'whole' || dv.type === 'decimal') type = 'number';
        else if (dv.type === 'date') type = 'date';
      }
      return { label: name, type, required: false, options };
    });

    const skipped = ws.rowCount - h.bottom;
    const range = h.top === h.bottom ? h.top + '행' : h.top + '~' + h.bottom + '행';
    if (h.cols.length < 2) warnings.push('인식된 항목이 1개뿐입니다. 제목 행이 여러 줄이거나 표 형태가 복잡한 양식일 수 있으니 직접 확인해 주세요.');
    return {
      title: file.name.replace(/\.xlsx$/i, ''),
      fields,
      warnings,
      info: '"' + ws.name + '" 시트의 ' + range + '을 제목으로 인식했습니다.' + (h.top !== h.bottom ? ' 여러 줄 제목은 " - "로 이어 붙였습니다.' : '') + (skipped > 0 ? ' (아래 데이터 행은 무시)' : ''),
    };
  }

  async function buildWorkbook({ fields, headers, rows, includeTimestamp }) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('응답');
    const colCount = includeTimestamp ? headers.length : fields.length;

    ws.addRow(headers.slice(0, colCount));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEFC' } };
      cell.border = { bottom: { style: 'thin' } };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of rows) {
      ws.addRow(row.slice(0, colCount).map((v, i) => {
        const f = fields[i];
        if (f && f.type === 'number' && v !== '' && !isNaN(Number(v))) return Number(v);
        return v;
      }));
    }

    // 텍스트 칸(전화번호 등)이 숫자로 바뀌지 않도록 서식 지정
    fields.forEach((f, i) => {
      if (f.type === 'tel' || f.type === 'text' || f.type === 'select') ws.getColumn(i + 1).numFmt = '@';
      ws.getColumn(i + 1).width = Math.min(Math.max(f.label.length * 2 + 4, 14), 40);
    });
    if (includeTimestamp) ws.getColumn(colCount).width = 20;

    // 드롭다운 유효성 검사 복원
    const lastRow = Math.max(rows.length + 1, 1000);
    let optSheet = null, optCol = 0;
    fields.forEach((f, i) => {
      if (f.type !== 'select' || !f.options.length) return;
      const inline = f.options.join(',');
      let formula;
      if (inline.length <= 250 && !f.options.some((o) => o.includes(',') || o.includes('"'))) {
        formula = '"' + inline + '"';
      } else {
        if (!optSheet) { optSheet = wb.addWorksheet('옵션'); optSheet.state = 'hidden'; }
        optCol++;
        f.options.forEach((o, k) => { optSheet.getCell(k + 1, optCol).value = o; });
        const L = colLetter(optCol);
        formula = "'옵션'!$" + L + '$1:$' + L + '$' + f.options.length;
      }
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(r, i + 1).dataValidation = {
          type: 'list', allowBlank: true, formulae: [formula],
          showErrorMessage: true, errorTitle: '선택 오류', error: '목록에서 선택해 주세요.',
        };
      }
    });
    return wb;
  }

  function colLetter(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  async function downloadResponses(data, includeTimestamp) {
    const wb = await buildWorkbook({
      fields: data.form.fields, headers: data.headers, rows: data.rows, includeTimestamp,
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const safe = data.form.title.replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safe + '_' + stamp + '.xlsx';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  root.XlsxIO = { parseTemplate, buildWorkbook, downloadResponses };
})(typeof window !== 'undefined' ? window : globalThis);
