// Keep the gate ahead of both Google's script and its initial page_view.
// The browser hostname is intentional: Cloud Run also serves production builds.
export function analyticsBootstrap(measurementId: string, production: boolean): string {
  const id = /^G-[A-Z0-9]+$/.test(measurementId) ? measurementId : "";
  return `(function () {
    var id = ${JSON.stringify(id)};
    var meta = document.querySelector('meta[name="youanalyst-analytics"]');
    if (meta) meta.setAttribute('content', 'disabled');
    if (id) window['ga-disable-' + id] = true;
    try {
      if (!${production} || !id || location.protocol !== 'https:' ||
          ['youanalyst.com', 'www.youanalyst.com'].indexOf(location.hostname) === -1 ||
          navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent) ||
          document.cookie.split(';').some(function (value) { return value.trim() === 'youanalyst_analytics_opt_out=1'; })) return;
      window['ga-disable-' + id] = false;
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', id);
      // Queue eligible events immediately, but let the page finish before
      // starting Google's external download (which can be slow or blocked).
      function loadGoogle() {
        try {
          if (document.cookie.split(';').some(function (value) { return value.trim() === 'youanalyst_analytics_opt_out=1'; })) {
            window['ga-disable-' + id] = true;
            if (meta) meta.setAttribute('content', 'disabled');
            return;
          }
          var script = document.createElement('script');
          script.async = true;
          script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
          document.head.appendChild(script);
        } catch (_) { /* Privacy controls may change after bootstrap. */ }
      }
      function whenIdle() {
        if (window.requestIdleCallback) window.requestIdleCallback(loadGoogle, { timeout: 3000 });
        else window.setTimeout(loadGoogle, 1000);
      }
      if (document.readyState === 'complete') whenIdle();
      else window.addEventListener('load', whenIdle, { once: true });
      if (meta) meta.setAttribute('content', 'enabled');
    } catch (_) { /* Fail closed when browser privacy controls block access. */ }
  })();`;
}
