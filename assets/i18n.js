/* AnkiNOS interface language support.
 *
 * Vietnamese is the source language: every string in the markup and scripts
 * is written in Vietnamese. A language pack (assets/i18n-<code>.js) maps those
 * source strings, and regular-expression patterns for strings with numbers in
 * them, to another language. This file translates the live DOM (text and the
 * title / aria-label / placeholder / alt attributes) and keeps the original
 * text so the language can be switched back at any time.
 *
 * To add a language: create assets/i18n-<code>.js that calls
 * NOSI18n.register('<code>', {name, native, locale, dict, patterns}), load it
 * after this file, and allow the code in `LANGUAGES` in integration.py and
 * backup_store.py. Strings missing from a pack simply stay in Vietnamese. */
(function initNOSI18n() {
  'use strict';
  if (window.NOSI18n) return;
  const SOURCE = 'vi';
  const packs = {};
  const meta = {[SOURCE]: {id: SOURCE, name: 'Tiếng Việt', english: 'Vietnamese', locale: 'vi-VN'}};
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  const SKIP_TEXT = 'script,style,textarea,[data-i18n-skip]';
  const SKIP_ATTR = 'script,style,[data-i18n-skip]';
  const texts = new WeakMap();
  const attrs = new WeakMap();
  const formatters = new Map();
  let current = SOURCE;
  let observer = null;
  let pending = [];
  let frame = 0;
  let titleRec = null;

  const norm = value => value.replace(/\s+/g, ' ').trim();
  const known = lang => lang === SOURCE || !!packs[lang];

  function register(id, pack) {
    packs[id] = {dict: new Map(Object.entries(pack.dict || {})), patterns: pack.patterns || []};
    meta[id] = {id, name: pack.native || id, english: pack.name || id, locale: pack.locale || id};
    // A pack that arrives after the language was chosen applies immediately.
    if (current === id) apply();
  }

  /** Translate one source string. Unknown strings are returned unchanged. */
  function translate(text, lang = current) {
    if (!text || lang === SOURCE) return text;
    const pack = packs[lang];
    if (!pack) return text;
    const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    const core = norm(parts[2]);
    if (!core) return text;
    let out = pack.dict.get(core);
    if (out === undefined) {
      const sub = piece => translate(piece, lang);
      for (const [pattern, build] of pack.patterns) {
        const match = pattern.exec(core);
        if (match) { out = build(match, sub); break; }
      }
    }
    return out === undefined ? text : parts[1] + out + parts[3];
  }

  const locale = (lang = current) => (meta[lang] || meta[SOURCE]).locale;

  function numberFormat(options) {
    const key = JSON.stringify(options || {});
    return {format: value => {
      const loc = locale();
      const id = loc + key;
      if (!formatters.has(id)) formatters.set(id, new Intl.NumberFormat(loc, options));
      return formatters.get(id).format(value);
    }};
  }
  function dateFormat(options) {
    const key = 'd' + JSON.stringify(options || {});
    return {format: value => {
      const loc = locale();
      const id = loc + key;
      if (!formatters.has(id)) formatters.set(id, new Intl.DateTimeFormat(loc, options));
      return formatters.get(id).format(value);
    }};
  }

  function skippedText(node) {
    const el = node.nodeType === 3 ? node.parentElement : node;
    return !el || !!el.closest(SKIP_TEXT);
  }

  function skippedAttr(node) {
    const el = node.nodeType === 3 ? node.parentElement : node;
    return !el || !!el.closest(SKIP_ATTR);
  }

  function syncTitle() {
    if (typeof document.title !== 'string' || !document.title) return;
    const value = document.title;
    if (!titleRec) {
      if (current === SOURCE) return;
      titleRec = {src: value, out: value};
    } else if (value !== titleRec.out) {
      titleRec.src = value;
    }
    const out = translate(titleRec.src);
    if (out !== value) document.title = out;
    titleRec.out = out;
  }

  function syncText(node) {
    if (skippedText(node)) return;
    const value = node.nodeValue;
    let rec = texts.get(node);
    if (!rec) {
      // Nothing to remember while the page is still in its source language.
      if (current === SOURCE || !/\S/.test(value)) return;
      rec = {src: value, out: value};
      texts.set(node, rec);
    } else if (value !== rec.out) {
      rec.src = value; // The application wrote new text.
    }
    const out = translate(rec.src);
    if (out !== value) node.nodeValue = out;
    rec.out = out;
  }

  function syncAttr(el, name) {
    if (!el.getAttribute || skippedAttr(el)) return;
    const value = el.getAttribute(name);
    if (value === null) return;
    let map = attrs.get(el);
    if (!map) attrs.set(el, map = {});
    let rec = map[name];
    if (!rec) {
      if (current === SOURCE) return;
      rec = map[name] = {src: value, out: value};
    } else if (value !== rec.out) rec.src = value;
    const out = translate(rec.src);
    if (out !== value) el.setAttribute(name, out);
    rec.out = out;
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { syncText(root); return; }
    if (root.nodeType !== 1 || skippedAttr(root)) return;
    if (!skippedText(root)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) syncText(node);
    }
    const elements = root.querySelectorAll('[title],[aria-label],[placeholder],[alt]');
    for (const el of [root, ...elements]) for (const name of ATTRS) syncAttr(el, name);
  }

  function flush() {
    frame = 0;
    const batch = pending;
    pending = [];
    for (const m of batch) {
      if (m.type === 'characterData') syncText(m.target);
      else if (m.type === 'attributes') syncAttr(m.target, m.attributeName);
      else for (const node of m.addedNodes) walk(node);
    }
  }

  function watch() {
    if (!observer) {
      observer = new MutationObserver(list => {
        pending.push(...list);
        if (!frame) frame = requestAnimationFrame(flush);
      });
    }
    observer.observe(document.body, {subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRS});
  }

  function apply() {
    if (!document.body) return;
    if (observer) observer.disconnect();
    pending = [];
    syncTitle();
    walk(document.body);
    document.documentElement.lang = current;
    // Translated text is written by this module only; other mutations are re-read.
    if (current !== SOURCE) watch();
    document.dispatchEvent(new CustomEvent('nos:language', {detail: {language: current}}));
  }

  /** Switch the interface language. Unknown codes fall back to Vietnamese. */
  function set(lang) {
    const next = known(lang) ? lang : SOURCE;
    if (next === current && document.documentElement.lang === next) return false;
    current = next;
    apply();
    return true;
  }

  const languages = () => Object.values(meta);
  const ALIASES = {
    zh: 'zh-cn', zh_cn: 'zh-cn', zh_hans: 'zh-cn', zh_hans_cn: 'zh-cn', zh_hans_sg: 'zh-cn', zh_sg: 'zh-cn',
    zh_tw: 'zh-tw', zh_hant: 'zh-tw', zh_hant_tw: 'zh-tw', zh_hk: 'zh-tw', zh_hant_hk: 'zh-tw',
    pt_br: 'pt-br', nb: 'no',
  };
  /** Resolve any Anki/browser locale (e.g. 'vi_VN', 'en_US', 'zh_CN', 'ja_JP') to the
   *  best registered pack. Automatically picks up future packs registered via register(). */
  function resolve(rawLocale) {
    if (typeof rawLocale === 'string') {
      const normalized = rawLocale.trim().replace(/-/g, '_').toLowerCase();
      if (normalized) {
        const aliased = ALIASES[normalized];
        if (aliased) {
          if (known(aliased)) return aliased;
          return known('en') ? 'en' : SOURCE;
        }
        const hyphenated = normalized.replace(/_/g, '-');
        if (known(normalized)) return normalized;
        if (known(hyphenated)) return hyphenated;
        const base = normalized.split('_')[0];
        const aliasedBase = ALIASES[base];
        if (aliasedBase && known(aliasedBase)) return aliasedBase;
        if (known(base)) return base;
        if (known('en')) return 'en';
      }
    }
    return SOURCE;
  }

  window.NOSI18n = {
    SOURCE, register, set, languages, resolve, translate, numberFormat, dateFormat, locale,
    t: text => translate(text, current),
    language: () => current,
    has: known,
    // Translate arbitrary source text for a language without touching the page.
    preview: (text, lang) => translate(text, lang),
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(), {once: true});
})();
