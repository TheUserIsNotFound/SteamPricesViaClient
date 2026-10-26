(function () {
    'use strict';

    if (!document.body) return;

    /* ================= НАСТРОЙКИ ================= */
    const DEBOUNCE_MS   = 200;  // задержка обработки динамических блоков
    const SHOW_ORIGINAL = true; // true = переписывать зачёркнутую цену (цифры без флагов); false = не трогать её
    const DEFAULT_RATES = { RUB: 2.0, KZT: 12.0 };
    const SKIP_SELECTORS = '#header_wallet_balance, .responsive_menu_user_wallet, #uah2rub-panel';
    /* ============================================== */

    const CACHE_KEY  = 'uah2rub.cache.v2';
    const MANUAL_KEY = 'uah2rub.manual.v2';
    const SHOW_KEY   = 'uah2rub.show.v2';

    const HRYVNIA = '\u20b4'; // ₴
    const RUBLE   = '\u20bd'; // ₽
    const TENGE   = '\u20b8'; // ₸

    const PRICE_RE_AFTER  = /(\d+(?:[\s\u00a0\u202f.,]\d+)*)\s*(\u20b4|\u20bd|\u20b8)/;
    const PRICE_RE_BEFORE = /(\u20b4|\u20bd|\u20b8)\s*(\d+(?:[\s\u00a0\u202f.,]\d+)*)/;

    const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1 };

    const FLAG_CLASS = 'uah2rub-flag';
    const SEP_CLASS  = 'uah2rub-sep';
    const ALT_CLASS  = 'uah2rub-alt';
    const PANEL_ID   = 'uah2rub-panel';

    const SYMBOL_TO_CUR = { [HRYVNIA]: 'UAH', [RUBLE]: 'RUB', [TENGE]: 'KZT' };
    const CUR_SYMBOL    = { UAH: HRYVNIA, RUB: RUBLE, KZT: TENGE };
    const CUR_SHORT     = { UAH: HRYVNIA, RUB: RUBLE, KZT: TENGE };
    const CUR_NAME      = { UAH: 'Гривны (UAH)', RUB: 'Рубли (RUB)', KZT: 'Тенге (KZT)' };
    const FLAG_BY_CUR   = { UAH: 'ua', RUB: 'ru', KZT: 'kz' };
    const CURRENCIES    = ['UAH', 'RUB', 'KZT'];

    let rates = { RUB: DEFAULT_RATES.RUB, KZT: DEFAULT_RATES.KZT };
    let show = { UAH: true, RUB: true, KZT: true };
    let panelButtons = {};
    let isMutating = false;
    let pendingSync = false;

    /* ---------- Стили ---------- */
    const style = document.createElement('style');
    style.textContent =
        '.' + FLAG_CLASS + '{display:inline-block;width:1.15em;height:.8em;border-radius:.12em;' +
        'vertical-align:-.08em;margin-right:.3em;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15);}' +

        '.' + FLAG_CLASS + '.ru{background:linear-gradient(180deg,#ffffff 0 33.4%,#0039a6 33.4% 66.7%,#d52b1e 66.7% 100%);}' +
        '.' + FLAG_CLASS + '.ua{background:linear-gradient(180deg,#0057b7 0 50%,#ffd700 50% 100%);}' +
        '.' + FLAG_CLASS + '.kz{background:radial-gradient(circle at 50% 50%, #fec50c 0%, #fec50c 30%, #00afca 31%, #00afca 100%);}' +

        '.' + SEP_CLASS + '{opacity:.5;margin:0 .35em;}' +

        '.game_area_dlc_price .discount_original_price, .discount_block_inline .discount_original_price{margin-right:6px !important;}' +

        '#' + PANEL_ID + '{position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:4px;opacity:.92;}' +
        '#' + PANEL_ID + ' button{min-width:34px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,.35);' +
        'background:rgba(0,0,0,.65);color:#fff;font-size:14px;line-height:1;cursor:pointer;padding:0 6px;transition:opacity .15s,background .15s;}' +
        '#' + PANEL_ID + ' button.on{outline:2px solid #4fc3f7;background:rgba(0,0,0,.85);}' +
        '#' + PANEL_ID + ' button.off{opacity:.45;text-decoration:line-through;}';

    (document.head || document.documentElement).appendChild(style);

    /* ---------- Утилиты хранилища ---------- */
    function parseShow(v) {
        if (!v || typeof v !== 'object') return { UAH: true, RUB: true, KZT: true };
        return {
            UAH: v.UAH !== false,
            RUB: v.RUB !== false,
            KZT: v.KZT !== false
        };
    }

    function computeEffectiveRates(cacheObj, manualObj) {
        const mRub = manualObj && +manualObj.RUB > 0 ? +manualObj.RUB : 0;
        const mKzt = manualObj && +manualObj.KZT > 0 ? +manualObj.KZT : 0;
        const cRates = cacheObj && cacheObj.rates ? cacheObj.rates : {};
        const cRub = +cRates.RUB > 0 ? +cRates.RUB : 0;
        const cKzt = +cRates.KZT > 0 ? +cRates.KZT : 0;

        return {
            RUB: mRub || cRub || DEFAULT_RATES.RUB,
            KZT: mKzt || cKzt || DEFAULT_RATES.KZT
        };
    }

    function anyShow() {
        return CURRENCIES.some(cur => show[cur]);
    }

    /* ---------- Проверка и разбор цены ---------- */
    function hasCurrencySymbol(text) {
        return typeof text === 'string' && (
            text.indexOf(HRYVNIA) !== -1 ||
            text.indexOf(RUBLE) !== -1 ||
            text.indexOf(TENGE) !== -1
        );
    }

    function normalizeNumberString(str) {
        let clean = str.replace(/[\s\u00a0\u202f]/g, '');
        const lastComma = clean.lastIndexOf(',');
        const lastDot = clean.lastIndexOf('.');

        if (lastComma !== -1 && lastDot !== -1) {
            if (lastComma > lastDot) {
                clean = clean.replace(/\./g, '').replace(',', '.');
            } else {
                clean = clean.replace(/,/g, '');
            }
        } else if (lastComma !== -1) {
            const parts = clean.split(',');
            if (parts.length > 2 || (parts[1] && parts[1].length === 3)) {
                clean = clean.replace(/,/g, '');
            } else {
                clean = clean.replace(',', '.');
            }
        } else if (lastDot !== -1) {
            const parts = clean.split('.');
            if (parts.length > 2 || (parts[1] && parts[1].length === 3)) {
                clean = clean.replace(/\./g, '');
            }
        }
        return parseFloat(clean);
    }

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
        const v = normalizeNumberString(num);
        const cur = SYMBOL_TO_CUR[symbol];

        return isFinite(v) && cur ? { v, num, cur, symbol, before } : null;
    }

    function fmtNum(v) {
        if (v > 0 && v < 1) {
            return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return Math.round(v).toLocaleString('ru-RU');
    }

    /* ---------- Конвертация ---------- */
    function convert(value, from, to) {
        if (!isFinite(value) || !from || !to) return NaN;
        if (from === to) return value;

        let uah = NaN;
        if (from === 'UAH') uah = value;
        else if (from === 'RUB' && rates.RUB > 0) uah = value / rates.RUB;
        else if (from === 'KZT' && rates.KZT > 0) uah = value / rates.KZT;

        if (!isFinite(uah)) return NaN;
        if (to === 'UAH') return uah;
        if (to === 'RUB') return rates.RUB > 0 ? uah * rates.RUB : NaN;
        if (to === 'KZT') return rates.KZT > 0 ? uah * rates.KZT : NaN;

        return NaN;
    }

    function getDisplayEntries(value, from) {
        const entries = [];
        if (!isFinite(value) || !from) return entries;

        const order = [from, ...CURRENCIES.filter(c => c !== from)];

        for (const cur of order) {
            if (!show[cur]) continue;
            const v = convert(value, from, cur);
            if (isFinite(v)) {
                entries.push({ cur, text: fmtNum(v) });
            }
        }
        return entries;
    }

    /* ---------- Вспомогательные DOM-элементы ---------- */
    function flagSpan(cls) {
        const s = document.createElement('span');
        s.className = FLAG_CLASS + ' ' + cls;
        if (cls === 'ru' && rates.RUB > 0) s.title = 'Курс UAH→RUB: ' + rates.RUB.toFixed(2);
        if (cls === 'kz' && rates.KZT > 0) s.title = 'Курс UAH→KZT: ' + rates.KZT.toFixed(2);
        return s;
    }

    function sepSpan() {
        const s = document.createElement('span');
        s.className = SEP_CLASS;
        s.textContent = '|';
        return s;
    }

    const isOriginalPrice = el => !!el.closest('.discount_original_price');

    function isOwnNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.id === PANEL_ID) return true;
        const cl = node.classList;
        return cl && (cl.contains(FLAG_CLASS) || cl.contains(SEP_CLASS) || cl.contains(ALT_CLASS));
    }

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
        return !!(f && isOwnNode(f));
    }

    function isFullPriceElement(el, parsed) {
        if (!el || el.childElementCount !== 0) return false;
        const noSpace = el.textContent.trim().replace(/[\s\u00a0\u202f]+/g, '');
        const numNoSpace = parsed.num.replace(/[\s\u00a0\u202f]+/g, '');
        return noSpace === numNoSpace + parsed.symbol || noSpace === parsed.symbol + numNoSpace;
    }

    function clearPriceMarkers(el) {
        if (!el || !el.dataset) return;
        isMutating = true;
        el.querySelectorAll('.' + ALT_CLASS).forEach(s => s.remove());
        isMutating = false;

        delete el.dataset.uah2rub;
        delete el.dataset.uah2rubSrc;
        delete el.dataset.uah2rubCur;
        delete el.dataset.uah2rubBefore;
        delete el.dataset.uah2rubPlain;
        delete el.dataset.uah2rubAlt;
        delete el.dataset.uah2rubSkip;
    }

    /* ---------- Сборка содержимого цены ---------- */
    function fillAltSpan(s, parent) {
        if (!s || !parent) return;

        const value = parseFloat(s.dataset.uah2rub || parent.dataset.uah2rub);
        const cur = s.dataset.uah2rubCur || parent.dataset.uah2rubCur || 'UAH';

        isMutating = true;
        s.textContent = '';

        if (isFinite(value)) {
            const entries = getDisplayEntries(value, cur).filter(e => e.cur !== cur);
            if (entries.length) {
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
        }
        isMutating = false;
    }

    function fillPrice(el, value, num, cur, before) {
        if (!el) return;

        const entries = getDisplayEntries(value, cur);
        isMutating = true;
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
        isMutating = false;
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

    /* ---------- Сканирование DOM (TreeWalker) ---------- */
    function scan(rootEl) {
        if (!anyShow() || !rootEl) return;

        const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const p = node.parentElement;
                if (!p || SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
                if (isOwnNode(p) || (p.closest && p.closest('#' + PANEL_ID))) return NodeFilter.FILTER_REJECT;
                if (p.dataset && p.dataset.uah2rubSkip === '1') return NodeFilter.FILTER_REJECT;
                if (p.dataset && p.dataset.uah2rub && isProcessed(p)) return NodeFilter.FILTER_REJECT;

                return hasCurrencySymbol(node.nodeValue)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        });

        const hits = [];
        while (walker.nextNode()) hits.push(walker.currentNode);

        for (const node of hits) {
            const el = node.parentElement;
            if (!el || !node.isConnected) continue;

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
                if (node.nextElementSibling && node.nextElementSibling.classList.contains(ALT_CLASS)) {
                    continue;
                }

                isMutating = true;
                const s = document.createElement('span');
                s.className = ALT_CLASS;
                s.dataset.uah2rub = String(parsed.v);
                s.dataset.uah2rubCur = parsed.cur;

                el.dataset.uah2rub = String(parsed.v);
                el.dataset.uah2rubCur = parsed.cur;
                el.dataset.uah2rubAlt = '1';

                delete el.dataset.uah2rubPlain;
                delete el.dataset.uah2rubSkip;

                fillAltSpan(s, el);
                node.after(s);
                isMutating = false;
            }
        }
    }

    /* ---------- Наблюдатель за изменениями DOM ---------- */
    const queue = new Set();
    let timer = 0;

    function enqueue(el) {
        if (!el || el.nodeType !== 1 || isOwnNode(el)) return;
        for (const existing of queue) {
            if (existing.contains(el)) return;
            if (el.contains(existing)) queue.delete(existing);
        }
        queue.add(el);
    }

    function flush() {
        timer = 0;
        const roots = Array.from(queue);
        queue.clear();

        for (const r of roots) {
            if (r.isConnected) scan(r);
        }
    }

    const observer = new MutationObserver(muts => {
        if (isMutating) return;

        for (let i = 0; i < muts.length; i++) {
            const m = muts[i];

            if (m.type === 'characterData') {
                if (hasCurrencySymbol(m.target.nodeValue || '')) {
                    const el = m.target.parentElement;
                    if (el && el.dataset && el.dataset.uah2rubSkip !== '1') {
                        if (el.dataset.uah2rub) clearPriceMarkers(el);
                        enqueue(el);
                    }
                }
                continue;
            }

            for (let j = 0; j < m.addedNodes.length; j++) {
                const n = m.addedNodes[j];
                if (isOwnNode(n)) continue;

                if (n.nodeType === 1) {
                    if (n.closest && n.closest('#' + PANEL_ID)) continue;
                    enqueue(n);
                } else if (n.nodeType === 3 && hasCurrencySymbol(n.nodeValue) && n.parentElement) {
                    const p = n.parentElement;
                    if (isOwnNode(p) || (p.closest && p.closest('#' + PANEL_ID))) continue;
                    if (p.dataset && p.dataset.uah2rubSkip !== '1') {
                        if (p.dataset.uah2rub) clearPriceMarkers(p);
                        enqueue(p);
                    }
                }
            }
        }

        if (queue.size && !timer) timer = setTimeout(flush, DEBOUNCE_MS);
    });

    /* ---------- Панель кнопок на странице ---------- */
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        isMutating = true;
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
        isMutating = false;
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

    function applyFullDOMUpdate() {
        document.querySelectorAll('[data-uah2rub-plain="1"]').forEach(el => {
            clearPriceMarkers(el);
        });
        refreshAll();
        if (anyShow()) scan(document.body);
    }

    function toggleCurrency(cur) {
        if (!(cur in show)) return;
        show[cur] = !show[cur];
        if (chrome.runtime?.id) {
            chrome.storage.local.set({ [SHOW_KEY]: show });
        }
        applyFullDOMUpdate();
    }

    /* ---------- Синхронизация между вкладками и Popup ---------- */
    function triggerSyncUpdate() {
        if (document.hidden) {
            pendingSync = true;
            updatePanelState();
        } else {
            pendingSync = false;
            applyFullDOMUpdate();
        }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;

        if (changes[SHOW_KEY]) {
            show = parseShow(changes[SHOW_KEY].newValue);
            triggerSyncUpdate();
        }

        if (changes[MANUAL_KEY] || changes[CACHE_KEY]) {
            chrome.storage.local.get([CACHE_KEY, MANUAL_KEY], data => {
                rates = computeEffectiveRates(data[CACHE_KEY], data[MANUAL_KEY]);
                triggerSyncUpdate();
            });
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && pendingSync) {
            pendingSync = false;
            applyFullDOMUpdate();
        }
    });

    /* ---------- Инициализация ---------- */
    chrome.storage.local.get([CACHE_KEY, MANUAL_KEY, SHOW_KEY], data => {
        show = parseShow(data[SHOW_KEY]);
        rates = computeEffectiveRates(data[CACHE_KEY], data[MANUAL_KEY]);

        createPanel();
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        if (anyShow()) {
            scan(document.body);
        }

        if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({ type: 'FETCH_RATES', force: false }, res => {
                if (chrome.runtime.lastError || !res || !res.ok) return;
                const r = res.rates;
                if (r && (r.RUB !== rates.RUB || r.KZT !== rates.KZT)) {
                    rates = r;
                    refreshAll();
                    if (anyShow()) scan(document.body);
                }
            });
        }
    });
})();
