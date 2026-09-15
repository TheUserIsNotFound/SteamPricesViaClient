(async function () {
  'use strict';

  if (!document.body) return;

  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) {
    console.error('[uah2rub] chrome.storage/chrome.runtime недоступны');
    return;
  }

  /* ---------- локальное хранилище расширения ---------- */
  const storageData = await new Promise(resolve => {
    try {
      chrome.storage.local.get(null, items => {
        if (chrome.runtime.lastError) {
          console.error('[uah2rub] storage get error:', chrome.runtime.lastError);
        }
        resolve(items || {});
      });
    } catch (e) {
      console.error('[uah2rub] storage get exception:', e);
      resolve({});
    }
  });

  function getValue(key, defaultValue) {
    return Object.prototype.hasOwnProperty.call(storageData, key)
      ? storageData[key]
      : defaultValue;
  }

  function setValue(key, value) {
    storageData[key] = value;

    try {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          console.error('[uah2rub] storage set error:', chrome.runtime.lastError);
        }
      });
    } catch (e) {
      console.error('[uah2rub] storage set exception:', e);
    }
  }

  /* ---------- сетевые запросы через background ---------- */
  function requestJson(details) {
    if (!details || !details.url) return;

    let finished = false;
    const timeout = details.timeout || 8000;

    const safetyTimer = setTimeout(() => {
      if (!finished) {
        finished = true;

        if (details.ontimeout) {
          details.ontimeout({ status: 0 });
        } else if (details.onerror) {
          details.onerror({ status: 0 });
        }
      }
    }, timeout + 1500);

    function done(fn, arg) {
      if (finished) return;

      finished = true;
      clearTimeout(safetyTimer);

      if (fn) {
        fn(arg);
      }
    }

    function directFetch() {
      try {
        const controller = new AbortController();
        const fetchTimer = setTimeout(() => controller.abort(), timeout);

        fetch(details.url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json'
          }
        })
          .then(async response => {
            const text = await response.text();
            let json;

            try {
              json = JSON.parse(text);
            } catch (e) {
              json = undefined;
            }

            if (!response.ok) {
              done(details.onerror, {
                status: response.status,
                statusText: response.statusText || 'Error'
              });
              return;
            }

            done(details.onload, {
              status: response.status,
              response: json !== undefined && json !== null ? json : text,
              responseText: text
            });
          })
          .catch(e => {
            done(details.onerror, {
              status: 0,
              statusText: String(e)
            });
          })
          .finally(() => {
            clearTimeout(fetchTimer);
          });
      } catch (e) {
        done(details.onerror, {
          status: 0,
          statusText: String(e)
        });
      }
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: 'uah2rub-fetch',
          url: details.url,
          timeout
        },
        response => {
          if (chrome.runtime.lastError || !response) {
            directFetch();
            return;
          }

          if (!response.ok) {
            if (response.timeout) {
              done(details.ontimeout || details.onerror, { status: 0 });
            } else {
              done(details.onerror, { status: response.status || 0 });
            }
            return;
          }

          done(details.onload, {
            status: response.status || 200,
            response:
              response.json !== undefined && response.json !== null
                ? response.json
                : response.text,
            responseText: response.text || ''
          });
        }
      );
    } catch (e) {
      directFetch();
    }
  }

  /* ================= НАСТРОЙКИ ================= */
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const DEBOUNCE_MS = 250;
  const SHOW_ORIGINAL = true;

  const DEFAULT_RATES = { RUB: 2.0, KZT: 12.0 };

  const SKIP_SELECTORS = '#header_wallet_balance, .responsive_menu_user_wallet, #uah2rub-panel';

  const RATE_SOURCES = [
    {
      url: 'https://open.er-api.com/v6/latest/UAH',
      pick: j => (j && j.rates ? { RUB: j.rates.RUB, KZT: j.rates.KZT } : null)
    },
    {
      url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/uah.min.json',
      pick: j => (j && j.uah ? { RUB: j.uah.rub, KZT: j.uah.kzt } : null)
    }
  ];
  /* ============================================== */

  const CACHE_KEY = 'uah2rub.cache.v2';
  const MANUAL_KEY = 'uah2rub.manual.v2';
  const SHOW_KEY = 'uah2rub.show.v2';
  const OLD_MANUAL_KEY = 'uah2rub.manual';

  const HRYVNIA = '\u20b4';
  const RUBLE = '\u20bd';
  const TENGE = '\u20b8';

  const PRICE_RE_AFTER = /([\d][\d\s\u00a0\u202f.,]*)\s*(\u20b4|\u20bd|\u20b8)/;
  const PRICE_RE_BEFORE = /(\u20b4|\u20bd|\u20b8)\s*([\d][\d\s\u00a0\u202f.,]*)/;

  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1 };

  const FLAG_CLASS = 'uah2rub-flag';
  const SEP_CLASS = 'uah2rub-sep';
  const ALT_CLASS = 'uah2rub-alt';
  const PANEL_ID = 'uah2rub-panel';

  const SYMBOL_TO_CUR = {
    [HRYVNIA]: 'UAH',
    [RUBLE]: 'RUB',
    [TENGE]: 'KZT'
  };

  const CUR_SYMBOL = {
    UAH: HRYVNIA,
    RUB: RUBLE,
    KZT: TENGE
  };

  const CUR_SHORT = {
    UAH: HRYVNIA,
    RUB: RUBLE,
    KZT: TENGE
  };

  const CUR_NAME = {
    UAH: 'Гривны (UAH)',
    RUB: 'Рубли (RUB)',
    KZT: 'Тенге (KZT)'
  };

  const FLAG_BY_CUR = {
    UAH: 'ua',
    RUB: 'ru',
    KZT: 'kz'
  };

  const CURRENCIES = ['UAH', 'RUB', 'KZT'];

  let rates = { RUB: 0, KZT: 0 };
  let show = loadShow();
  let panelButtons = {};

  let scriptActive = false;
  let observerConnected = false;
  let fetchingRates = false;
  const rateCallbacks = [];

  /* ---------- стили ---------- */
  const style = document.createElement('style');
  style.textContent =
    '.' + FLAG_CLASS + '{display:inline-block;width:1.15em;height:.8em;border-radius:.12em;' +
    'vertical-align:-.08em;margin-right:.3em;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15);}' +
    '.' + FLAG_CLASS + '.ru{background:linear-gradient(180deg,#ffffff 0 33.4%,#0039a6 33.4% 66.7%,#d52b1e 66.7% 100%);}' +
    '.' + FLAG_CLASS + '.ua{background:linear-gradient(180deg,#0057b7 0 50%,#ffd700 50% 100%);}' +
    '.' + FLAG_CLASS + '.kz{background:radial-gradient(circle at 50% 50%, #fec50c 0%, #fec50c 30%, #00afca 31%, #00afca 100%);}' +
    '.' + SEP_CLASS + '{opacity:.5;margin:0 .35em;}' +
    '#' + PANEL_ID + '{position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:4px;opacity:.92;}' +
    '#' + PANEL_ID + ' button{min-width:34px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,.35);' +
    'background:rgba(0,0,0,.65);color:#fff;font-size:14px;line-height:1;cursor:pointer;padding:0 6px;}' +
    '#' + PANEL_ID + ' button.on{outline:2px solid #4fc3f7;background:rgba(0,0,0,.8);}' +
    '#' + PANEL_ID + ' button.off{opacity:.45;text-decoration:line-through;}';

  (document.head || document.documentElement).appendChild(style);

  /* ---------- сохранение/загрузка видимости валют ---------- */
  function loadShow() {
    const def = { UAH: true, RUB: true, KZT: true };
    const v = getValue(SHOW_KEY, null);

    if (!v || typeof v !== 'object') return def;

    return {
      UAH: v.UAH !== false,
      RUB: v.RUB !== false,
      KZT: v.KZT !== false
    };
  }

  function saveShow() {
    setValue(SHOW_KEY, show);
  }

  function anyShow() {
    return CURRENCIES.some(cur => show[cur]);
  }

  /* ---------- проверка наличия символа валюты ---------- */
  function hasCurrencySymbol(text) {
    return (
      typeof text === 'string' &&
      (
        text.indexOf(HRYVNIA) !== -1 ||
        text.indexOf(RUBLE) !== -1 ||
        text.indexOf(TENGE) !== -1
      )
    );
  }

  /* ---------- разбор числа из исходного текста Steam ---------- */
  function parsePrice(text) {
    let m = PRICE_RE_AFTER.exec(text);
    let raw = null;
    let symbol = null;
    let before = false;

    if (m) {
      raw = m[1];
      symbol = m[2];
    } else {
      m = PRICE_RE_BEFORE.exec(text);
      if (m) {
        symbol = m[1];
        raw = m[2];
        before = true;
      }
    }

    if (!raw || !symbol) return null;

    const num = raw.replace(/[\s\u00a0\u202f.,]+$/, '');
    const v = parseFloat(raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    const cur = SYMBOL_TO_CUR[symbol];

    return isFinite(v) && cur ? { v, num, cur, symbol, before } : null;
  }

  const fmtNum = v => Math.round(v).toLocaleString('ru-RU');

  /* ---------- конвертация ---------- */
  function convert(value, from, to) {
    if (!isFinite(value) || !from || !to) return NaN;
    if (from === to) return value;

    if (from === 'UAH') {
      if (to === 'RUB') return rates.RUB > 0 ? value * rates.RUB : NaN;
      if (to === 'KZT') return rates.KZT > 0 ? value * rates.KZT : NaN;
    }

    if (from === 'KZT') {
      if (!(rates.KZT > 0)) return NaN;
      const uah = value / rates.KZT;

      if (to === 'UAH') return uah;
      if (to === 'RUB') return rates.RUB > 0 ? uah * rates.RUB : NaN;
    }

    if (from === 'RUB') {
      if (!(rates.RUB > 0)) return NaN;
      const uah = value / rates.RUB;

      if (to === 'UAH') return uah;
      if (to === 'KZT') return rates.KZT > 0 ? uah * rates.KZT : NaN;
    }

    return NaN;
  }

  function getDisplayEntries(value, from) {
    const entries = [];
    if (!isFinite(value) || !from) return entries;

    const order = [from];

    for (const cur of CURRENCIES) {
      if (cur !== from) order.push(cur);
    }

    for (const cur of order) {
      if (!show[cur]) continue;

      const v = convert(value, from, cur);

      if (isFinite(v)) {
        entries.push({ cur, text: fmtNum(v) });
      }
    }

    return entries;
  }

  /* ---------- вспомогательные DOM-элементы ---------- */
  function flagSpan(cls) {
    const s = document.createElement('span');
    s.className = FLAG_CLASS + ' ' + cls;

    if (cls === 'ru' && rates.RUB > 0) {
      s.title = 'Курс UAH→RUB: ' + rates.RUB.toFixed(2);
    }

    if (cls === 'kz' && rates.KZT > 0) {
      s.title = 'Курс UAH→KZT: ' + rates.KZT.toFixed(2);
    }

    return s;
  }

  function sepSpan() {
    const s = document.createElement('span');
    s.className = SEP_CLASS;
    s.textContent = '|';
    return s;
  }

  const isOriginalPrice = el => !!el.closest('.discount_original_price');

  function isProcessed(el) {
    if (!el || !el.dataset) return false;

    if (
      el.dataset.uah2rubPlain === '1' ||
      el.dataset.uah2rubAlt === '1' ||
      el.dataset.uah2rubSkip === '1'
    ) {
      return true;
    }

    const f = el.firstElementChild;
    if (!f) return false;

    const c = f.classList;
    return c.contains(FLAG_CLASS) || c.contains(SEP_CLASS) || c.contains(ALT_CLASS);
  }

  function isFullPriceElement(el, parsed) {
    if (!el || el.childElementCount !== 0) return false;

    const noSpace = el.textContent.trim().replace(/[\s\u00a0\u202f]+/g, '');
    const numNoSpace = parsed.num.replace(/[\s\u00a0\u202f]+/g, '');

    return noSpace === numNoSpace + parsed.symbol || noSpace === parsed.symbol + numNoSpace;
  }

  function clearPriceMarkers(el) {
    if (!el || !el.dataset) return;

    el.querySelectorAll('.' + ALT_CLASS).forEach(s => s.remove());

    delete el.dataset.uah2rub;
    delete el.dataset.uah2rubSrc;
    delete el.dataset.uah2rubCur;
    delete el.dataset.uah2rubBefore;
    delete el.dataset.uah2rubPlain;
    delete el.dataset.uah2rubAlt;
    delete el.dataset.uah2rubSkip;
  }

  /* ---------- восстановление исходных цен при полном отключении ---------- */
  function restoreOriginalPrices() {
    if (!document.body) return;

    document.querySelectorAll('.' + ALT_CLASS).forEach(s => s.remove());

    const marked = document.querySelectorAll(
      '[data-uah2rub], [data-uah2rub-plain], [data-uah2rub-skip], [data-uah2rub-alt]'
    );

    marked.forEach(el => {
      if (el.dataset.uah2rubAlt === '1') {
        clearPriceMarkers(el);
        return;
      }

      const cur = el.dataset.uah2rubCur;
      const num = el.dataset.uah2rubSrc;

      if (cur && num && CUR_SYMBOL[cur]) {
        const before = el.dataset.uah2rubBefore === '1';
        el.textContent = before ? CUR_SYMBOL[cur] + num : num + CUR_SYMBOL[cur];
      }

      clearPriceMarkers(el);
    });
  }

  /* ---------- сборка содержимого цены ---------- */
  function fillAltSpan(s, parent) {
    if (!s || !parent || !parent.dataset) return;

    const value = parseFloat(parent.dataset.uah2rub);
    const cur = parent.dataset.uah2rubCur || 'UAH';

    s.textContent = '';

    if (!isFinite(value)) return;

    const entries = getDisplayEntries(value, cur).filter(e => e.cur !== cur);
    if (!entries.length) return;

    s.append(sepSpan());

    entries.forEach((entry, i) => {
      if (i) s.append(sepSpan());

      if (isOriginalPrice(parent)) {
        s.append(document.createTextNode(entry.text));
      } else {
        s.append(flagSpan(FLAG_BY_CUR[entry.cur]), document.createTextNode(entry.text));
      }
    });
  }

  function fillPrice(el, value, num, cur, before) {
    if (!el) return;

    const entries = getDisplayEntries(value, cur);

    el.textContent = '';

    if (!entries.length) {
      const originalText = before
        ? (CUR_SYMBOL[cur] || '') + num
        : num + (CUR_SYMBOL[cur] || '');

      el.append(document.createTextNode(originalText));
      el.dataset.uah2rubPlain = '1';
    } else {
      delete el.dataset.uah2rubPlain;

      if (isOriginalPrice(el)) {
        entries.forEach((entry, i) => {
          if (i) el.append(sepSpan());
          el.append(document.createTextNode(entry.text));
        });
      } else {
        entries.forEach((entry, i) => {
          if (i) el.append(sepSpan());
          el.append(flagSpan(FLAG_BY_CUR[entry.cur]), document.createTextNode(entry.text));
        });
      }
    }

    el.dataset.uah2rub = String(value);
    el.dataset.uah2rubSrc = num;
    el.dataset.uah2rubCur = cur;
    el.dataset.uah2rubBefore = before ? '1' : '0';

    delete el.dataset.uah2rubSkip;
    delete el.dataset.uah2rubAlt;
  }

  function refreshAll() {
    document.querySelectorAll('[data-uah2rub-src]').forEach(el => {
      const value = parseFloat(el.dataset.uah2rub);
      const cur = el.dataset.uah2rubCur || 'UAH';
      const before = el.dataset.uah2rubBefore === '1';

      if (isFinite(value)) {
        fillPrice(el, value, el.dataset.uah2rubSrc, cur, before);
      }
    });

    document.querySelectorAll('.' + ALT_CLASS).forEach(s => {
      const p = s.parentElement;
      if (!p || !p.dataset || p.dataset.uah2rubSkip === '1') return;
      fillAltSpan(s, p);
    });

    updatePanelState();
  }

  /* ---------- однократный проход по поддереву ---------- */
  function scan(rootEl) {
    if (!scriptActive || !anyShow()) return;
    if (!rootEl || !rootEl.isConnected) return;

    if (rootEl !== document.body && !hasCurrencySymbol(rootEl.textContent || '')) {
      return;
    }

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;

        if (!p || SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('#' + PANEL_ID)) return NodeFilter.FILTER_REJECT;
        if (p.dataset && p.dataset.uah2rubSkip === '1') return NodeFilter.FILTER_REJECT;
        if (p.dataset && p.dataset.uah2rub && isProcessed(p)) return NodeFilter.FILTER_REJECT;

        return hasCurrencySymbol(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });

    const hits = [];

    while (walker.nextNode()) {
      hits.push(walker.currentNode);
    }

    for (const node of hits) {
      const el = node.parentElement;
      if (!el || !anyShow()) continue;

      if (el.dataset && el.dataset.uah2rub && isProcessed(el)) continue;

      if (SKIP_SELECTORS && el.closest(SKIP_SELECTORS)) {
        el.dataset.uah2rubSkip = '1';
        continue;
      }

      if (!SHOW_ORIGINAL && isOriginalPrice(el)) {
        el.dataset.uah2rubSkip = '1';
        continue;
      }

      const parsed = parsePrice(node.nodeValue);
      if (!parsed) continue;

      if (isFullPriceElement(el, parsed)) {
        fillPrice(el, parsed.v, parsed.num, parsed.cur, parsed.before);
      } else {
        const s = document.createElement('span');
        s.className = ALT_CLASS;

        el.dataset.uah2rub = String(parsed.v);
        el.dataset.uah2rubCur = parsed.cur;
        el.dataset.uah2rubAlt = '1';

        delete el.dataset.uah2rubPlain;
        delete el.dataset.uah2rubSkip;

        fillAltSpan(s, el);
        node.after(s);
      }
    }
  }

  /* ---------- событийная дозагрузка ---------- */
  const queue = new Set();
  let timer = 0;

  function flush() {
    timer = 0;

    if (!scriptActive) {
      queue.clear();
      return;
    }

    const roots = Array.from(queue);
    queue.clear();

    for (const r of roots) {
      if (r.isConnected) scan(r);
    }
  }

  const observer = new MutationObserver(muts => {
    if (!scriptActive) return;

    for (let i = 0; i < muts.length; i++) {
      const m = muts[i];

      if (m.type === 'characterData') {
        if (hasCurrencySymbol(m.target.nodeValue || '')) {
          const el = m.target.parentElement;

          if (
            el &&
            el.dataset &&
            el.dataset.uah2rub &&
            el.dataset.uah2rubPlain !== '1' &&
            el.dataset.uah2rubSkip !== '1'
          ) {
            clearPriceMarkers(el);
            queue.add(el);
          }
        }

        continue;
      }

      for (let j = 0; j < m.addedNodes.length; j++) {
        const n = m.addedNodes[j];

        if (n.nodeType === 1) {
          if (n.id === PANEL_ID || (n.closest && n.closest('#' + PANEL_ID))) continue;

          if (hasCurrencySymbol(n.textContent || '')) {
            queue.add(n);
          }
        } else if (n.nodeType === 3 && hasCurrencySymbol(n.nodeValue) && n.parentElement) {
          const p = n.parentElement;

          if (p.closest && p.closest('#' + PANEL_ID)) continue;

          if (
            p.dataset &&
            p.dataset.uah2rub &&
            p.dataset.uah2rubPlain !== '1' &&
            p.dataset.uah2rubSkip !== '1'
          ) {
            clearPriceMarkers(p);
            queue.add(p);
          } else {
            queue.add(p);
          }
        }
      }
    }

    if (queue.size && !timer) {
      timer = setTimeout(flush, DEBOUNCE_MS);
    }
  });

  function startObserver() {
    if (observerConnected || !document.body) return;

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    observerConnected = true;
  }

  function stopObserver() {
    if (!observerConnected) return;

    observer.disconnect();
    observerConnected = false;
  }

  /* ---------- загрузка курса без лишних повторных запросов ---------- */
  function ensureRates(callback) {
    if (callback) {
      rateCallbacks.push(callback);
    }

    if (fetchingRates) return;

    fetchingRates = true;

    fetchRates(false, r => {
      fetchingRates = false;

      if (r && (r.RUB !== rates.RUB || r.KZT !== rates.KZT)) {
        rates = r;

        if (scriptActive) {
          refreshAll();
        }
      }

      const callbacks = rateCallbacks.splice(0, rateCallbacks.length);

      for (let i = 0; i < callbacks.length; i++) {
        try {
          callbacks[i](r);
        } catch (e) {
          // ignore
        }
      }
    });
  }

  /* ---------- запуск/остановка скрипта ---------- */
  function startScript() {
    if (scriptActive || !anyShow()) return;

    scriptActive = true;
    document.documentElement.dataset.uah2rubActive = '1';

    startObserver();

    scan(document.body);

    ensureRates(() => {
      if (!scriptActive) return;

      refreshAll();
      scan(document.body);
    });
  }

  function stopScript() {
    if (!scriptActive) return;

    scriptActive = false;
    document.documentElement.dataset.uah2rubActive = '0';

    stopObserver();

    queue.clear();

    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }

    restoreOriginalPrices();
  }

  /* ---------- панель кнопок ---------- */
  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    CURRENCIES.forEach(cur => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = CUR_SHORT[cur];

      b.addEventListener('click', ev => {
        ev.preventDefault();
        toggleCurrency(cur);
      });

      panel.appendChild(b);
      panelButtons[cur] = b;
    });

    document.body.appendChild(panel);
    updatePanelState();
  }

  function updatePanelState() {
    CURRENCIES.forEach(cur => {
      const b = panelButtons[cur];
      if (!b) return;

      b.className = show[cur] ? 'on' : 'off';
      b.title = (show[cur] ? 'Включено' : 'Выключено') + ': ' + CUR_NAME[cur];
    });
  }

  function toggleCurrency(cur) {
    if (!(cur in show)) return;

    const wasActive = anyShow();

    show[cur] = !show[cur];
    saveShow();
    updatePanelState();

    const nowActive = anyShow();

    if (!nowActive) {
      stopScript();
      return;
    }

    if (!wasActive) {
      startScript();
    } else {
      document.querySelectorAll('[data-uah2rub-plain="1"]').forEach(el => {
        clearPriceMarkers(el);
      });

      refreshAll();
      scan(document.body);
    }
  }

  /* ---------- курс: кэш + не более 1 запроса в сутки ---------- */
  function validRates(r) {
    return !!r && typeof r === 'object' && ((+r.RUB > 0) || (+r.KZT > 0));
  }

  function normalizeRates(r) {
    const rub = r && isFinite(+r.RUB) && +r.RUB > 0 ? +r.RUB : 0;
    const kzt = r && isFinite(+r.KZT) && +r.KZT > 0 ? +r.KZT : 0;

    return { RUB: rub, KZT: kzt };
  }

  function cachedRates() {
    const c = getValue(CACHE_KEY, null);

    if (c && c.t && Date.now() - c.t < CACHE_TTL_MS && validRates(c.rates)) {
      return normalizeRates(c.rates);
    }

    return { RUB: 0, KZT: 0 };
  }

  function expiredCachedRates() {
    const c = getValue(CACHE_KEY, null);

    if (c && validRates(c.rates)) {
      return normalizeRates(c.rates);
    }

    return { RUB: 0, KZT: 0 };
  }

  function getManualRates() {
    const m = getValue(MANUAL_KEY, null);

    if (m && typeof m === 'object') {
      return {
        RUB: +m.RUB > 0 ? +m.RUB : 0,
        KZT: +m.KZT > 0 ? +m.KZT : 0
      };
    }

    const old = getValue(OLD_MANUAL_KEY, 0);

    if (old > 0) {
      return { RUB: +old, KZT: 0 };
    }

    return { RUB: 0, KZT: 0 };
  }

  function saveManualRates(manual) {
    setValue(MANUAL_KEY, {
      RUB: manual && +manual.RUB > 0 ? +manual.RUB : 0,
      KZT: manual && +manual.KZT > 0 ? +manual.KZT : 0
    });
  }

  function trySource(i, done) {
    if (i >= RATE_SOURCES.length) {
      done(expiredCachedRates());
      return;
    }

    const src = RATE_SOURCES[i];

    requestJson({
      url: src.url,
      timeout: 8000,
      onload(res) {
        let picked = null;

        try {
          picked = src.pick(res.response || JSON.parse(res.responseText));
        } catch (e) {}

        const normalized = normalizeRates(picked);

        if (validRates(normalized)) {
          setValue(CACHE_KEY, { t: Date.now(), rates: normalized });
          done(normalized);
        } else {
          trySource(i + 1, done);
        }
      },
      onerror() {
        trySource(i + 1, done);
      },
      ontimeout() {
        trySource(i + 1, done);
      }
    });
  }

  function fetchRates(force, done) {
    const manual = getManualRates();
    const cache = cachedRates();

    if (!force && manual.RUB > 0 && manual.KZT > 0) {
      done({ RUB: manual.RUB, KZT: manual.KZT });
      return;
    }

    if (!force && validRates(cache)) {
      const combined = {
        RUB: manual.RUB || cache.RUB,
        KZT: manual.KZT || cache.KZT
      };

      if (combined.RUB > 0 && combined.KZT > 0) {
        done(combined);
        return;
      }
    }

    trySource(0, fetched => {
      const fallback = validRates(fetched) ? fetched : expiredCachedRates();

      const combined = {
        RUB: manual.RUB || fallback.RUB || cache.RUB || DEFAULT_RATES.RUB,
        KZT: manual.KZT || fallback.KZT || cache.KZT || DEFAULT_RATES.KZT
      };

      done(combined);
    });
  }

  /* ---------- старт ---------- */
  const initialCache = cachedRates();
  const initialManual = getManualRates();

  rates = {
    RUB: initialManual.RUB || initialCache.RUB,
    KZT: initialManual.KZT || initialCache.KZT
  };

  createPanel();
  updatePanelState();

  if (anyShow()) {
    startScript();
  } else {
    scriptActive = false;
    document.documentElement.dataset.uah2rubActive = '0';
  }
})();
