'use strict';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY    = 'uah2rub.cache.v2';
const MANUAL_KEY   = 'uah2rub.manual.v2';
const DEFAULT_RATES = { RUB: 2.0, KZT: 12.0 };

const RATE_SOURCES = [
    {
        url: 'https://open.er-api.com/v6/latest/UAH',
        pick: j => j && j.rates ? { RUB: j.rates.RUB, KZT: j.rates.KZT } : null
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/uah.min.json',
        pick: j => j && j.uah ? { RUB: j.uah.rub, KZT: j.uah.kzt } : null
    }
];

function isCompleteRates(r) {
    return !!r && typeof r === 'object' && (+r.RUB > 0) && (+r.KZT > 0);
}

function normalizeRates(r) {
    const rub = r && isFinite(+r.RUB) && +r.RUB > 0 ? +r.RUB : 0;
    const kzt = r && isFinite(+r.KZT) && +r.KZT > 0 ? +r.KZT : 0;
    return { RUB: rub, KZT: kzt };
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchFromSources() {
    let partial = { RUB: 0, KZT: 0 };

    for (const src of RATE_SOURCES) {
        const json = await fetchWithTimeout(src.url, 8000);
        if (!json) continue;

        let picked = null;
        try {
            picked = src.pick(json);
        } catch (e) {}

        const norm = normalizeRates(picked);
        partial = {
            RUB: partial.RUB || norm.RUB,
            KZT: partial.KZT || norm.KZT
        };

        if (isCompleteRates(partial)) {
            await chrome.storage.local.set({
                [CACHE_KEY]: { t: Date.now(), rates: partial }
            });
            return partial;
        }
    }

    return partial;
}

async function handleGetRates(force = false) {
    const data = await chrome.storage.local.get([CACHE_KEY, MANUAL_KEY]);
    const manual = normalizeRates(data[MANUAL_KEY]);
    const cacheObj = data[CACHE_KEY];
    const isCacheFresh = cacheObj && cacheObj.t && (Date.now() - cacheObj.t) < CACHE_TTL_MS;
    const cached = cacheObj && cacheObj.rates ? normalizeRates(cacheObj.rates) : { RUB: 0, KZT: 0 };

    if (!force && isCompleteRates(manual)) {
        return manual;
    }

    if (!force && isCacheFresh && isCompleteRates(cached)) {
        return {
            RUB: manual.RUB || cached.RUB,
            KZT: manual.KZT || cached.KZT
        };
    }

    const fetched = await fetchFromSources();

    return {
        RUB: manual.RUB || fetched.RUB || cached.RUB || DEFAULT_RATES.RUB,
        KZT: manual.KZT || fetched.KZT || cached.KZT || DEFAULT_RATES.KZT
    };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'FETCH_RATES') {
        handleGetRates(!!msg.force).then(rates => {
            sendResponse({ ok: true, rates });
        }).catch(() => {
            sendResponse({ ok: false, rates: DEFAULT_RATES });
        });
        return true; // удерживаем канал открытым для асинхронного ответа
    }
});
