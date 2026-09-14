chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'uah2rub-fetch') {
    return false;
  }

  const timeout = Math.min(Math.max(Number(message.timeout) || 8000, 1000), 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  fetch(message.url, {
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

      sendResponse({
        ok: response.ok,
        status: response.status,
        json,
        text
      });
    })
    .catch(error => {
      const isTimeout = error && error.name === 'AbortError';
      const errorMessage = error && error.message ? error.message : String(error);

      sendResponse({
        ok: false,
        status: 0,
        timeout: isTimeout,
        error: errorMessage
      });
    })
    .finally(() => {
      clearTimeout(timer);
    });

  return true;
});