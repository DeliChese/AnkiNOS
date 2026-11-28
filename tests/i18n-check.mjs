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
for (const file of ['i18n.js', 'i18n-en.js', 'i18n-zh-cn.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'assets', file), 'utf8'), context, {filename: file});
}
const i18n = context.NOSI18n;
const en = text => i18n.translate(text, 'en');
const zh = text => i18n.translate(text, 'zh-cn');

// 1. Ensure dict in assets/i18n-en.js and assets/i18n-zh-cn.js has zero duplicate keys and exact key parity.
function extractDictKeys(relFile) {
  const src = fs.readFileSync(path.join(root, relFile), 'utf8');
  const body = src.slice(src.indexOf('const dict = {'), src.indexOf('const UNITS = {'));
  const seen = new Set();
  const dups = [];
  for (const m of body.matchAll(/^\s+"((?:\\.|[^"\\])+)"\s*:/gm)) {
    const key = JSON.parse(`"${m[1]}"`);
    if (seen.has(key)) dups.push(key);
    seen.add(key);
  }
  assert.deepEqual(dups, [], `Duplicate keys in ${relFile}:\n` + dups.join('\n'));
  return seen;
}
const enKeys = extractDictKeys('assets/i18n-en.js');
const zhKeys = extractDictKeys('assets/i18n-zh-cn.js');
assert.deepEqual([...enKeys].filter(k => !zhKeys.has(k)), [], 'Keys in i18n-en.js missing from i18n-zh-cn.js');
assert.deepEqual([...zhKeys].filter(k => !enKeys.has(k)), [], 'Extra keys in i18n-zh-cn.js missing from i18n-en.js');

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
  'Gom an toàn không sửa due thật · ≈ 5 phút': 'Safe catch-up without editing due dates · ≈ 5 min',
  '12 hôm nay + 8 quá hạn · ≈ 5 phút · R trung bình 82% · R cao → thấp':
    '12 today + 8 overdue · ≈ 5 min · Avg R 82% · High R → Low',
  'Phiên đang dở: còn 10 thẻ (2 thẻ đang học lại được bảo vệ).':
    'Active session: 10 cards left (2 relearning cards protected).',
  'Đã trả 10 thẻ về bộ thẻ gốc.': 'Returned 10 cards to their home decks.',
  'R thấp (64%) — ưu tiên ôn hôm nay': 'Low R (64%) — prioritized for today',
  'Đề xuất dời 18 thẻ quá hạn · 4 thẻ R thấp về Hôm nay · 14 thẻ rải sang 5 ngày tương lai thưa thẻ.':
    'Proposed rescheduling 18 overdue cards · 4 low-R cards to Today · 14 cards spread across 5 light future days.',
  'Đã hoàn tác 12 thẻ về ngày cũ (bỏ qua 2 thẻ bạn đã ôn).':
    'Restored 12 cards to their previous due dates (skipped 2 cards you already reviewed).',
  'Khoảng 10–18 phút cho các lượt hiện có (mốc giữa 14 phút).':
    'About 10–18 min for the current queue (median 14 min).',
  'Tỷ lệ trả lời đúng giảm 12 điểm phần trăm: 92% → 80%.':
    'Correct-answer rate dropped 12 percentage points: 92% → 80%.',
  'Hôm nay · 8/10 lượt đúng': 'Today · 8/10 correct',
  'Hôm nay · 8/10 lượt đúng · True Retention 88%': 'Today · 8/10 correct · True Retention 88%',
  'Hôm nay · 5,2 giây/thẻ · 10 lượt': 'Today · 5,2 sec/card · 10 reviews',
  '4,2 lượt/phút': '4,2 reviews/min',
  '5,40 giây/thẻ (11,1 thẻ/phút)': '5,40 sec/card (11,1 cards/min)',
  'Tổng toàn bộ:': 'All-time total:',
  'Quay lại giao diện AnkiNOS': 'Return to AnkiNOS',
  'Bật / tắt giao diện AnkiNOS': 'Toggle AnkiNOS / native Anki UI',
  'Focus': 'Focus',
  'Chỉnh sửa thẻ (E)': 'Edit card (E)',
  'Hiện đáp án (Space)': 'Show Answer (Space)',
  'Phím tắt: 3': 'Shortcut key: 3',
  '(Kết thúc)': '(end)',
  'Chuỗi lạ chưa dịch': 'Chuỗi lạ chưa dịch',
};
for (const [source, expected] of Object.entries(cases)) assert.equal(en(source), expected, source);

const zhCases = {
  'Thống kê': '统计',
  'Cài đặt AnkiNOS': 'AnkiNOS 设置',
  'AnkiNOS — Không gian ghi nhớ': 'AnkiNOS — 记忆空间',
  'Cảm ơn bạn đã dùng thử AnkiNOS!': '感谢你试用 AnkiNOS！',
  'Chào buổi sáng, Minh': '早上好，Minh',
  '4,2 lượt/phút': '4,2 次/分钟',
  'Hôm nay · 8/10 lượt đúng': '今日 · 答对 8/10',
  'Hôm nay · 8/10 lượt đúng · True Retention 88%': '今日 · 答对 8/10 · True Retention 88%',
  'Hôm nay · 5,2 giây/thẻ · 10 lượt': '今日 · 5,2 秒/张 · 10 次',
  '5,40 giây/thẻ (11,1 thẻ/phút)': '5,40 秒/张（11,1 张/分钟）',
  'Tổng lượt ôn:': '总复习次数：',
  'Tổng toàn bộ:': '历史总计：',
  'Quay lại giao diện AnkiNOS': '返回 AnkiNOS 界面',
  'Bật / tắt giao diện AnkiNOS': '切换 AnkiNOS / Anki 原生界面',
  'Tô sáng': '高亮',
  'Gạch ngang': '删除线',
  'Focus': '专注',
  'Chỉnh sửa thẻ (E)': '编辑卡片 (E)',
  'Hiện đáp án (Space)': '显示答案 (Space)',
  'Phím tắt: 3': '快捷键：3',
  '(Kết thúc)': '(结束)',
  'Chuỗi lạ chưa dịch': 'Chuỗi lạ chưa dịch',
};
for (const [source, expected] of Object.entries(zhCases)) assert.equal(zh(source), expected, 'zh-cn: ' + source);

assert.equal(i18n.translate('Thống kê', 'vi'), 'Thống kê');
assert.equal(i18n.translate('Thống kê', 'xx'), 'Thống kê');
assert.ok(i18n.has('en') && i18n.has('vi') && i18n.has('zh-cn') && !i18n.has('xx'));
assert.equal(i18n.resolve('vi_VN'), 'vi');
assert.equal(i18n.resolve('en_US'), 'en');
assert.equal(i18n.resolve('zh_CN'), 'zh-cn');
assert.equal(i18n.resolve('zh-Hans'), 'zh-cn');
assert.equal(i18n.resolve('zh_TW'), 'en');
assert.equal(i18n.resolve('ja_JP'), 'en');
assert.equal(i18n.resolve(''), 'vi');
assert.equal(i18n.locale('en'), 'en-US');
assert.equal(i18n.locale('zh-cn'), 'zh-CN');

// 3. Check ALL 5 HTML templates (decoding HTML numeric entities and skipping data-i18n-skip blocks).
const decodeHtml = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const vnRe = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;
const skip = new Set(['Tiếng Việt', 'Vietnamese', 'English', 'Tiếng Anh', '简体中文', 'Chinese (Simplified)', 'Rosé Pine']);
const htmlFiles = [
  'ankios-ui.html',
  'ankios-overview.html',
  'ankios-review.html',
  'ankios-tools.html',
  'ankios-pomodoro.html',
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
const missingEn = [];
const missingZh = [];
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
    if (!skip.has(s) && en(s) === s) missingEn.push(`${rel}: ${s}`);
    if (!skip.has(s) && zh(s) === s) missingZh.push(`${rel}: ${s}`);
  }
}
assert.deepEqual(missingEn, [], 'Missing English translations:\n' + missingEn.join('\n'));
assert.deepEqual(missingZh, [], 'Missing Simplified Chinese translations:\n' + missingZh.join('\n'));
console.log(`i18n ok: ${totalStrings} markup strings across ${htmlFiles.length} HTML files (en + zh-cn), ${Object.keys(cases).length + Object.keys(zhCases).length} spot checks, 0 duplicate keys`);
