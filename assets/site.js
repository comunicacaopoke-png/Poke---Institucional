(() => {
  const menuButton = document.querySelector('[data-menu-button]');
  const menu = document.querySelector('[data-menu]');

  if (menuButton && menu) {
    menuButton.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('is-open');
      menuButton.setAttribute('aria-expanded', String(isOpen));
      menuButton.textContent = isOpen ? 'FECHAR' : 'MENU';
    });
  }

  document.querySelectorAll('.eyebrow').forEach(label => {
    const compact = label.textContent.replace(/^\[\s*|\s*\]$/g, '').trim();
    const withoutLeadingOrder = compact.replace(/^\d+\s*[-–—/]\s*/, '');
    label.textContent = withoutLeadingOrder.replace(/\s*[/–—-]\s*\d+\s*$/, '').trim();
  });
  document.querySelectorAll('.principle > span:first-child').forEach(marker => {
    if (/^\d+$/.test(marker.textContent.trim())) marker.textContent = '';
  });

  const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, observer) => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }), { threshold: .12 })
    : null;
  document.querySelectorAll('.reveal').forEach(element => {
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add('visible');
  });

  const maskedHeadings = document.querySelectorAll('[data-masked-heading]');
  const maskedHeadingObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, observer) => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }), { threshold: .35 })
    : null;
  maskedHeadings.forEach(heading => {
    heading.classList.add('is-pending');
    if (maskedHeadingObserver) maskedHeadingObserver.observe(heading);
    else heading.classList.add('is-visible');
  });

  document.querySelectorAll('[data-articles-carousel]').forEach(carousel => {
    const rail = carousel.querySelector('.articles-carousel__rail, .insights-carousel__rail');
    const previous = carousel.querySelector('[data-carousel-prev]');
    const next = carousel.querySelector('[data-carousel-next]');
    if (!rail) return;
    const move = direction => rail.scrollBy({ left: direction * Math.max(rail.clientWidth * .82, 280), behavior: 'smooth' });
    previous?.addEventListener('click', () => move(-1));
    next?.addEventListener('click', () => move(1));
    rail.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    });
  });

  const filters = document.querySelectorAll('[data-project-filter]');
  filters.forEach(filter => filter.addEventListener('click', () => {
    const category = filter.dataset.projectFilter;
    filters.forEach(item => {
      const active = item === filter;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-project-category]').forEach(project => {
      project.hidden = category !== 'todos' && !project.dataset.projectCategory.split(' ').includes(category);
    });
  }));

  window.pokeTrack = (eventName, params = {}) => {
    if (typeof window.gtag === 'function') window.gtag('event', eventName, params);
  };
  document.querySelectorAll('[data-track]').forEach(element => {
    element.addEventListener('click', () => window.pokeTrack(element.dataset.track, {
      link_url: element.href || undefined,
      link_text: element.textContent.trim()
    }));
  });

  let consentVisible = false;
  const showAnalyticsConsent = () => {
    const analyticsId = document.querySelector('meta[name="google-analytics-id"]')?.content.trim();
    if (!/^G-[A-Z0-9]+$/i.test(analyticsId || '') || localStorage.getItem('poke.analytics-consent') || consentVisible) return;
    consentVisible = true;
    const consent = document.createElement('aside');
    consent.className = 'consent';
    consent.setAttribute('aria-label', 'Preferências de medição');
    consent.innerHTML = '<strong>Medir para melhorar</strong><p>Usamos métricas anônimas para entender como o site é utilizado. Você pode aceitar ou recusar a medição.</p><div class="consent__actions"><button class="button" type="button" data-consent="accept">ACEITAR</button><button class="consent__deny" type="button" data-consent="deny">RECUSAR</button><a class="consent__deny" href="/privacidade/">PRIVACIDADE</a></div>';
    consent.querySelector('[data-consent="accept"]').addEventListener('click', () => {
      window.pokeSetAnalyticsConsent?.(true);
      consentVisible = false;
      consent.remove();
    });
    consent.querySelector('[data-consent="deny"]').addEventListener('click', () => {
      window.pokeSetAnalyticsConsent?.(false);
      consentVisible = false;
      consent.remove();
    });
    document.body.append(consent);
  };
  showAnalyticsConsent();
  window.addEventListener('poke:content-ready', showAnalyticsConsent);

  const contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    const status = contactForm.querySelector('[data-form-status]');
    contactForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!contactForm.checkValidity()) return contactForm.reportValidity();
      const endpoint = contactForm.dataset.endpoint;
      const payload = Object.fromEntries(new FormData(contactForm).entries());
      payload.page_url = window.location.href;
      payload.submitted_at = new Date().toISOString();
      const submit = contactForm.querySelector('[type="submit"]');
      if (!endpoint) {
        status.innerHTML = 'O envio ainda não foi configurado. Escreva para <a href="mailto:contato@seudominio.com.br">contato@seudominio.com.br</a>.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'ENVIANDO…';
      try {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Falha ao enviar');
        status.textContent = 'Recebemos sua mensagem. A gente continua daqui.';
        contactForm.reset();
        window.pokeTrack('generate_lead', { form_name: 'contato' });
      } catch (error) {
        status.textContent = 'Não foi possível enviar agora. Tente novamente ou fale conosco por e-mail.';
      } finally {
        submit.disabled = false;
        submit.textContent = 'ENVIAR MENSAGEM →';
      }
    });
  }
})();
