/**
 * ═══════════════════════════════════════════════════════════
 * AGORA — VVP Review · response collector (Google Apps Script)
 * ═══════════════════════════════════════════════════════════
 *
 * Receives answers from the VVP site and writes them into this
 * spreadsheet:
 *   Responses  one row per person per idea (a changed vote updates its row)
 *   Sessions   one row per person: age, gender, city, the random order they
 *              saw, their closing note, and whether they pressed Submit
 *   Summary    live roll-up by idea
 *
 * SETUP (about 5 minutes; full walkthrough in README.md)
 *  1. In a new Google Sheet: Extensions → Apps Script.
 *  2. Replace everything in Code.gs with this file, then Save.
 *  3. Choose `setup` in the function menu, press Run, approve access.
 *  4. Deploy → New deployment → gear icon → Web app.
 *       Execute as:      Me
 *       Who has access:  Anyone
 *  5. Copy the Web app URL (ends in /exec) into config.js → endpoint.
 *
 * Edited this script later? Deploy → Manage deployments → pencil →
 * Version: New version → Deploy. The URL stays the same.
 */

var RESPONSES = 'Responses';
var SESSIONS  = 'Sessions';
var SUMMARY   = 'Summary';

var RESPONSE_COLUMNS = [
  'key', 'received_at', 'updated_at', 'round', 'session_id',
  'vvp_num', 'vvp_label', 'position', 'reaction', 'reaction_score',
  'reasons', 'reason_keys', 'seconds_to_react'
];

var SESSION_COLUMNS = [
  'session_id', 'received_at', 'updated_at', 'round',
  'age', 'gender', 'city', 'started_at',
  'submitted', 'submitted_at', 'cards_answered', 'cards_total',
  'closing_note', 'order', 'device', 'screen', 'user_agent'
];

var NUMERIC_COLUMNS = ['vvp_num', 'position', 'reaction_score', 'seconds_to_react', 'age', 'cards_answered', 'cards_total'];
var MAX_EVENTS = 100;
var MAX_TEXT = 5000;

/* ── web app entry points ─────────────────────────────────── */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);
    var responses = table_(ss.getSheetByName(RESPONSES), RESPONSE_COLUMNS, 'key');
    var sessions  = table_(ss.getSheetByName(SESSIONS),  SESSION_COLUMNS,  'session_id');

    var receivedAt = new Date();
    var written = 0, skipped = 0;

    events.forEach(function (ev) {
      if (!ev || typeof ev !== 'object' || !validSessionId_(ev.session_id)) { skipped++; return; }

      if (ev.type === 'response') {
        var num = Number(ev.vvp_num);
        if (!isFinite(num) || Math.floor(num) !== num) { skipped++; return; }
        ev.key = ev.session_id + '|' + num;
        if (responses.upsert(ev, receivedAt)) written++; else skipped++;
      } else if (ev.type === 'session') {
        if (sessions.upsert(ev, receivedAt)) written++; else skipped++;
      } else {
        skipped++;
      }
    });

    return json_({ ok: true, written: written, skipped: skipped });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('Agora VVP collector is live. Paste this URL into config.js → endpoint.');
}

/** Run once from the editor: creates the tabs and prompts for access.
 *  Safe to run again after the columns change: it repairs the header rows
 *  and rebuilds the Summary formulas. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  var summary = ss.getSheetByName(SUMMARY);
  if (summary) ss.deleteSheet(summary);
  makeSummary_(ss);
}

/** Optional: run from the editor to drop in a fake answer and watch the rows appear. */
function testPost() {
  var id = 'editor-test-' + new Date().getTime();
  var now = new Date().toISOString();
  var out = doPost({ postData: { contents: JSON.stringify({ events: [
    { type: 'session', session_id: id, round: 'Test', age: 30, gender: 'Other', city: 'Editor', started_at: now,
      updated_at: now, submitted: false, submitted_at: '', cards_answered: 1, cards_total: 1,
      closing_note: 'Test row from the Apps Script editor. Safe to delete.', order: '1', device: 'editor' },
    { type: 'response', session_id: id, round: 'Test', vvp_num: 1, vvp_label: '', position: 1,
      reaction: 'Would use this ASAP', reaction_score: 3,
      reasons: 'Solves a problem I have; Sounds fun', reason_keys: 'problem; fun',
      seconds_to_react: 4.2, updated_at: now }
  ] }) } });
  Logger.log(out.getContent());
}

/* ── tables ───────────────────────────────────────────────── */

/**
 * Keyed upsert over one tab. Reads the key column once per request,
 * then writes each record into its existing row or a new one. An event
 * older than what's already stored (a retry that arrives late) is skipped.
 */
function table_(sheet, columns, keyName) {
  var keyCol = columns.indexOf(keyName) + 1;
  var updCol = columns.indexOf('updated_at') + 1;
  var index = {};
  var last = sheet.getLastRow();

  if (last >= 2) {
    var keys = sheet.getRange(2, keyCol, last - 1, 1).getValues();
    var stamps = sheet.getRange(2, updCol, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i][0] !== '') index[String(keys[i][0])] = { row: i + 2, t: toTime_(stamps[i][0]) };
    }
  }
  var nextRow = Math.max(last, 1) + 1;

  return {
    upsert: function (record, receivedAt) {
      var key = String(record[keyName]);
      var existing = index[key];
      var incoming = toTime_(record.updated_at);
      if (existing && !isNaN(incoming) && !isNaN(existing.t) && incoming < existing.t) return false;

      record.received_at = receivedAt;
      var row = existing ? existing.row : nextRow++;
      ensureRows_(sheet, row);
      sheet.getRange(row, 1, 1, columns.length)
        .setValues([columns.map(function (c) { return cell_(c, record[c]); })]);
      index[key] = { row: row, t: incoming };
      return true;
    }
  };
}

function cell_(column, value) {
  if (column === 'received_at') return value;
  if (column === 'submitted') return value === true || value === 'true';
  if (NUMERIC_COLUMNS.indexOf(column) !== -1) {
    if (value === '' || value === null || value === undefined) return '';
    var n = Number(value);
    return isFinite(n) ? n : '';
  }
  if (value === null || value === undefined) return '';
  var s = String(value).slice(0, MAX_TEXT);
  // text starting with = + - @ would otherwise run as a spreadsheet formula
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function ensureRows_(sheet, row) {
  var max = sheet.getMaxRows();
  if (row > max) sheet.insertRowsAfter(max, Math.max(500, row - max));
}

/* ── sheet setup ──────────────────────────────────────────── */

function ensureSheets_(ss) {
  syncHeaders_(makeTab_(ss, RESPONSES, RESPONSE_COLUMNS), RESPONSE_COLUMNS);
  syncHeaders_(makeTab_(ss, SESSIONS, SESSION_COLUMNS), SESSION_COLUMNS);
  if (!ss.getSheetByName(SUMMARY)) makeSummary_(ss);
}

/** If the columns in this script changed, bring the sheet's header row along. */
function syncHeaders_(sheet, columns) {
  var width = Math.max(sheet.getLastColumn(), columns.length);
  var current = sheet.getRange(1, 1, 1, width).getValues()[0];
  var same = true;
  for (var i = 0; i < columns.length; i++) {
    if (String(current[i]) !== columns[i]) { same = false; break; }
  }
  if (same) return sheet;
  if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
  // an older layout may have been wider: clear any header left over to the right
  var extra = sheet.getLastColumn() - columns.length;
  if (extra > 0) sheet.getRange(1, columns.length + 1, 1, extra).clearContent();
  applyFormats_(sheet, columns);
  return sheet;
}

function makeTab_(ss, name, columns) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  applyFormats_(sheet, columns);
  return sheet;
}

function applyFormats_(sheet, columns) {
  var rows = sheet.getMaxRows();
  columns.forEach(function (c, i) {
    var col = sheet.getRange(1, i + 1, rows, 1);
    if (c === 'received_at') col.setNumberFormat('yyyy-mm-dd hh:mm:ss');
    // keep text as typed: stops Sheets turning notes, ids and timestamps into dates or numbers
    else if (NUMERIC_COLUMNS.indexOf(c) === -1 && c !== 'submitted') col.setNumberFormat('@');
  });
}

function makeSummary_(ss) {
  var sheet = ss.insertSheet(SUMMARY, 0);
  var r = function (name) { return letter_(RESPONSE_COLUMNS.indexOf(name) + 1); };
  var num = r('vvp_num'), score = r('reaction_score'), reaction = r('reaction');
  var data = RESPONSES + '!A:' + letter_(RESPONSE_COLUMNS.length);
  var submitted = letter_(SESSION_COLUMNS.indexOf('submitted') + 1);

  sheet.getRange('A1').setValue('Agora VVP Review · live summary').setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue('Participants');
  sheet.getRange('B2').setFormula('=COUNTA(' + SESSIONS + '!A2:A)');
  sheet.getRange('C2').setValue('Submitted');
  sheet.getRange('D2').setFormula('=COUNTIF(' + SESSIONS + '!' + submitted + '2:' + submitted + ', TRUE)');

  sheet.getRange('A4').setValue('By idea, best first  ·  score 1 = not for me, 2 = interesting, 3 = ASAP').setFontWeight('bold');
  sheet.getRange('A5').setFormula(
    '=IFERROR(QUERY(' + data + ', "select ' + num + ', count(' + score + '), avg(' + score + ')' +
    ' where ' + score + ' is not null group by ' + num + ' order by avg(' + score + ') desc' +
    " label " + num + " 'VVP #', count(" + score + ") 'Votes', avg(" + score + ") 'Avg score'" +
    " format avg(" + score + ") '0.00'\", 1), \"No votes yet\")"
  );

  sheet.getRange('F4').setValue('How people reacted, by idea').setFontWeight('bold');
  sheet.getRange('F5').setFormula(
    '=IFERROR(QUERY(' + data + ', "select ' + num + ', count(' + num + ')' +
    ' where ' + score + ' is not null group by ' + num + ' pivot ' + reaction +
    " label " + num + " 'VVP #'\", 1), \"\")"
  );
  return sheet;
}

/* ── helpers ──────────────────────────────────────────────── */

function validSessionId_(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  var t = Date.parse(String(v === undefined || v === null ? '' : v));
  return isNaN(t) ? NaN : t;
}

function letter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
