// Checks the interface-language engine without a browser:
//  * zero duplicate keys in assets/i18n-en.js,
//  * every Vietnamese string across all HTML views (including numeric entities) has an English translation,
//  * dynamic patterns across every module translate cleanly,
//  * unknown languages and untranslated strings fall back to the source text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = {
  document: {readyState: 'complete', body: null, documentElement: {}, addEventListener() {}, dispatchEvent() {}},
  CustomEvent: class {},
  Intl,
};
context.window = context;
vm.createContext(context);
for (const file of ['i18n.js', 'i18n-en.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'assets', file), 'utf8'), context, {filename: file});
}
const i18n = context.NOSI18n;
const en = text => i18n.translate(text, 'en');

// 1. Ensure dict in assets/i18n-en.js has zero duplicate keys.
const enSource = fs.readFileSync(path.join(root, 'assets', 'i18n-en.js'), 'utf8');
const dictBody = enSource.slice(enSource.indexOf('const dict = {'), enSource.indexOf('const UNITS = {'));
const seenKeys = new Set();
const duplicateKeys = [];
for (const m of dictBody.matchAll(/^\s+"((?:\\.|[^"\\])+)"\s*:/gm)) {
  const key = JSON.parse(`"${m[1]}"`);
  if (seenKeys.has(key)) duplicateKeys.push(key);
  seenKeys.add(key);
}
assert.deepEqual(duplicateKeys, [], 'Duplicate keys in assets/i18n-en.js:\n' + duplicateKeys.join('\n'));

// 2. Comprehensive spot checks across all modules.
const cases = {
  'Thống kê': 'Statistics',
  '  Cài đặt AnkiNOS ': '  AnkiNOS settings ',
  'AnkiNOS — Không gian ghi nhớ': 'AnkiNOS — A space for memory',
  'AnkiNOS — Chuẩn bị học': 'AnkiNOS — Prepare to study',
  'AnkiNOS · Công cụ học': 'AnkiNOS · Study tools',
  '12 thẻ đang chờ bạn. Bắt đầu một chút, nhớ thêm thật nhiều.': '12 cards are waiting for you. Start small and remember a lot more.',
  '42 lượt/giờ': '42 reviews/h',
  '<1 phút': '<1 min',
  'so với 30 ngày trước': 'vs. 30 days earlier',
  'Chào buổi chiều, Quân': 'Good afternoon, Quân',
  'Tháng 3': 'March',
  'Th11': 'Nov',
  'CN': 'Sun',
  'T2 · 27/11': 'Mon · 27/11',
  '2 giờ 5 phút': '2 h 5 min',
  '120 / 200 lượt ôn': '120 / 200 reviews',
  '180 lượt ôn · 24 ngày học trong năm 2026': '180 reviews · 24 days studied in 2026',
  '24/09/2026: Không có lượt ôn': '24/09/2026: No reviews',
  '24/09/2026: 18 lượt ôn': '24/09/2026: 18 reviews',
  '1 ngày – 2 ngày: 26 thẻ (tích lũy: 26)': '1 days – 2 days: 26 cards (cumulative: 26)',
  'hôm nay (40.00 giây/thẻ)': 'today (40.00 sec/card)',
  ', Lọc:': ', Filtered:',
  'Lọc:': 'Filter:',
  'KHÔNG CÓ DỮ LIỆU': 'NO DATA',
  'dòng đời bộ thẻ': 'deck lifetime',
  '12 trong 31 (38.71%)': '12 of 31 (38.71%)',
  '218 thẻ / 210 ghi chú': '218 cards / 210 notes',
  'Độ mờ kính (Glass Blur)': 'Glass blur strength',
  '30% (Trong suốt rõ nền)': '30% (Transparent)',
  'NOS Glass · Tối': 'NOS Glass · Dark',
  'Hoàng hôn · Cực quang · Trái · Kính mờ 16px · 74% · Hiệu ứng mượt': 'Dusk · Aurora · Left · Glass 16px · 74% · Smooth effects',
  '120 thẻ · 3 bộ con': '120 cards · 3 sub-decks',
  'Xem 3 deck con': 'View 3 sub-decks',
  'Đã ôn 8 lượt trong phiên này': '8 reviews in this session',
  'Đã đủ thời gian Focus. 15 phút 5 giây tập trung · 32 lượt trả lời. Bạn có thể nghỉ hoặc tiếp tục khi sẵn sàng.':
    'Focus goal reached. 15 min 5 sec focused · 32 answers. Take a break or keep studying when ready.',
  '2026-11-27: 25 phút · 2 phiên': '2026-11-27: 25 min · 2 sessions',
  '25 phút · 30 lượt ôn · Đạt mục tiêu': '25 min · 30 reviews · Goal reached',
  '4 kết quả · ↑ ↓ để chọn · Enter để mở': '4 results · ↑ ↓ to select · Enter to open',
  '12 từ · 84 ký tự': '12 words · 84 characters',
  '3 ghi chú · Nhấn để mở': '3 notes · Click to open',
  'Gắn với note Anki 123': 'Linked to Anki note 123',
  'Đã chọn ảnh cho Chuẩn bị học. Lưu tự động.': 'Selected image for Prepare to study. Saved automatically.',
  'Hôm nay · T6, 27/11/2026': 'Today · Fri, 27/11/2026',
  'R thấp (64%) — ưu tiên ôn hôm nay': 'Low R (64%) — prioritized for today',
  'Đề xuất dời 18 thẻ quá hạn · 4 thẻ R thấp về Hôm nay · 14 thẻ rải sang 5 ngày tương lai thưa thẻ.':
    'Proposed rescheduling 18 overdue cards · 4 low-R cards to Today · 14 cards spread across 5 light future days.',
  'Đã hoàn tác 12 thẻ về ngày cũ (bỏ qua 2 thẻ bạn đã ôn).':
    'Restored 12 cards to their previous due dates (skipped 2 cards you already reviewed).',
  'Khoảng 10–18 phút cho các lượt hiện có (mốc giữa 14 phút).':
    'About 10–18 min for the current queue (median 14 min).',
  'Tỷ lệ trả lời đúng giảm 12 điểm phần trăm: 92% → 80%.':
    'Correct-answer rate dropped 12 percentage points: 92% → 80%.',
  'Chuỗi lạ chưa dịch': 'Chuỗi lạ chưa dịch',
};
for (const [source, expected] of Object.entries(cases)) assert.equal(en(source), expected, source);
assert.equal(i18n.translate('Thống kê', 'vi'), 'Thống kê');
assert.equal(i18n.translate('Thống kê', 'xx'), 'Thống kê');
assert.ok(i18n.has('en') && i18n.has('vi') && !i18n.has('xx'));
assert.equal(i18n.locale('en'), 'en-US');

// 3. Check ALL 5 HTML templates (decoding HTML numeric entities and skipping data-i18n-skip blocks).
const decodeHtml = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const vnRe = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;
const skip = new Set(['Tiếng Việt', 'Vietnamese', 'English', 'Tiếng Anh', 'Rosé Pine']);
const htmlFiles = [
  'ankios-ui.html',
  'ankios-overview.html',
  'ankios-review.html',
  'ankios-tools.html',
  'assets/reviewer-controls-preview.html',
];
// Strip any element (and its balanced nested content) carrying data-i18n-skip.
function stripSkipped(source) {
  let out = source;
  const openRe = /<([a-z][a-z0-9-]*)\b[^>]*\bdata-i18n-skip\b[^>]*>/i;
  let match;
  while ((match = openRe.exec(out)) !== null) {
    const tag = match[1];
    const start = match.index;
    const tagRe = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, 'gi');
    tagRe.lastIndex = start + match[0].length;
    let depth = 1, end = out.length, m;
    while ((m = tagRe.exec(out)) !== null) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) { end = tagRe.lastIndex; break; }
    }
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

let totalStrings = 0;
const missingAll = [];
for (const rel of htmlFiles) {
  const html = stripSkipped(
    fs.readFileSync(path.join(root, rel), 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<textarea[^>]*>[\s\S]*?<\/textarea>/g, '')
  );
  const strings = new Set();
  for (const match of html.matchAll(/>([^<>]+)</g)) {
    const text = decodeHtml(match[1]).replace(/\s+/g, ' ').trim();
    if (text && vnRe.test(text)) strings.add(text);
  }
  for (const match of html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]+)"/g)) {
    const text = decodeHtml(match[1]).replace(/\s+/g, ' ').trim();
    if (text && vnRe.test(text)) strings.add(text);
  }
  totalStrings += strings.size;
  for (const s of strings) {
    if (!skip.has(s) && en(s) === s) missingAll.push(`${rel}: ${s}`);
  }
}
assert.deepEqual(missingAll, [], 'Missing English translations:\n' + missingAll.join('\n'));
console.log(`i18n ok: ${totalStrings} markup strings across ${htmlFiles.length} HTML files, ${Object.keys(cases).length} spot checks, 0 duplicate keys`);
