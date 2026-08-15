/* Configure a measurement ID (G-XXXXXXXXXX) in each page's google-analytics-id meta tag.
   The tag only loads after the visitor has granted analytics consent. */
(() => {
  const id = document.querySelector('meta[name="google-analytics-id"]')?.content.trim();
  if (!/^G-[A-Z0-9]+$/i.test(id || '')) return;
  const storageKey = 'poke.analytics-consent';
  const load = () => {
    if (window.__pokeAnalyticsLoaded) return;
    window.__pokeAnalyticsLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.append(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id, { anonymize_ip: true });
  };
  window.pokeSetAnalyticsConsent = granted => {
    localStorage.setItem(storageKey, granted ? 'granted' : 'denied');
    if (granted) load();
  };
  if (localStorage.getItem(storageKey) === 'granted') load();
})();
