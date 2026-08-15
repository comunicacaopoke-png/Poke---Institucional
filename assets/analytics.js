/* Google Analytics 4. O measurement ID padrão fica aqui e vale para todas as páginas;
   um meta google-analytics-id preenchido ou site.gaMeasurementId no content.json têm prioridade.
   A tag só carrega depois que a pessoa concede consentimento de medição. */
(() => {
  const storageKey = 'poke.analytics-consent';
  const defaultMeasurementId = 'G-CYZGE3DVRQ';
  const isMeasurementId = value => /^G-[A-Z0-9]+$/i.test(String(value || '').trim());
  const alreadyTagged = () => Boolean(document.querySelector('script[src*="googletagmanager.com/gtag/js"],script[src*="googletagmanager.com/gtm.js"]'));
  let id = '';

  const load = () => {
    if (window.__pokeAnalyticsLoaded || !isMeasurementId(id) || alreadyTagged()) return;
    window.__pokeAnalyticsLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(){ window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted'
    });
    window.gtag('js', new Date());
    window.gtag('config', id, { anonymize_ip: true });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.append(script);
  };

  const configure = measurementId => {
    const candidate = [
      measurementId,
      document.querySelector('meta[name="google-analytics-id"]')?.content,
      defaultMeasurementId
    ].map(value => String(value || '').trim()).find(isMeasurementId);
    if (!candidate) return;
    id = candidate;
    window.pokeAnalyticsId = id;
    window.pokeSetAnalyticsConsent = granted => {
      localStorage.setItem(storageKey, granted ? 'granted' : 'denied');
      if (granted) load();
    };
    if (localStorage.getItem(storageKey) === 'granted') load();
  };
  configure();
  window.addEventListener('poke:content-ready', event => configure(event.detail?.site?.gaMeasurementId));
})();
