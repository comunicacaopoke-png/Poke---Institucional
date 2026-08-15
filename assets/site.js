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

  document.querySelectorAll('[data-menu]').forEach(menuElement => {
    if (menuElement.querySelector('[data-home-link]')) return;
    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.textContent = 'INÍCIO';
    homeLink.dataset.homeLink = 'true';
    menuElement.prepend(homeLink);
  });

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

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mainContent = document.querySelector('main');
  const firstContentBlock = mainContent?.firstElementChild;
  const isHomeHero = firstContentBlock?.classList.contains('hero');

  if (!prefersReducedMotion && mainContent && !isHomeHero && !document.body.classList.contains('a-poke-story')) {
    const navigationType = performance.getEntriesByType('navigation')[0]?.type;
    const header = document.querySelector('.site-header');
    const firstShell = firstContentBlock?.querySelector('.shell');
    const entryPieces = firstShell ? [...firstShell.children].slice(0, 5) : [];

    if (navigationType !== 'back_forward') {
      requestAnimationFrame(() => {
        header?.animate?.([
          { opacity: 0, transform: 'translate3d(0,-15px,0)' },
          { opacity: 1, transform: 'none' }
        ], { duration: 440, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
        entryPieces.forEach((element, index) => element.animate?.([
          { opacity: 0, transform: 'translate3d(0,30px,0) scale(.985)' },
          { opacity: .96, transform: 'translate3d(0,-3px,0) scale(1.002)', offset: .82 },
          { opacity: 1, transform: 'none' }
        ], { duration: 720, delay: 90 + index * 95, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }));
      });
    }

    const motionObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries, observer) => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }), { threshold: .02, rootMargin: '0px 0px 7% 0px' })
      : null;

    const prepareScrollStage = (stage, stageIndex) => {
      if (stage.hidden || stage === firstContentBlock) return;
      stage.classList.add('scroll-stage');
      const frame = stage.querySelector(':scope > .shell') || stage;
      const pieces = new Set();
      const add = (element, motion = 'rise') => {
        if (!element || pieces.has(element)) return;
        pieces.add(element);
        element.classList.add('scroll-piece');
        element.dataset.scrollMotion = motion;
        element.style.setProperty('--scroll-delay', `${Math.min(pieces.size - 1, 7) * 86}ms`);
      };
      const addAll = (selector, motion) => frame.querySelectorAll(selector).forEach(element => add(element, motion));

      if (stage.classList.contains('article-body')) {
        [...stage.children].filter(element => element.matches('p,h2,h3,.pullquote,figure,img,ul,ol')).forEach((element, index) => {
          add(element, element.matches('figure,img') ? 'zoom' : index % 3 === 1 ? 'left' : 'rise');
        });
      } else if (stage.classList.contains('service-block')) {
        addAll(':scope > .service-block__media', stageIndex % 2 ? 'left' : 'right');
        addAll(':scope > .service-block__copy', 'rise');
      } else {
        addAll(':scope > .section-heading', 'rise');
        addAll(':scope > .split > .split__media,:scope > .split > .gallery,:scope > .split > figure', stageIndex % 2 ? 'left' : 'right');
        addAll(':scope > .split > :not(.split__media):not(.gallery):not(figure)', 'rise');
        addAll(':scope > .contact-layout > *', 'rise');
        addAll(':scope > .insights-feature > *', 'rise');
        addAll(':scope > .principles > .principle', 'rise');
        addAll(':scope > .editorial-list > .editorial,:scope > .article-list > .article-row', 'rise');
        addAll(':scope > .gallery > img', 'zoom');
        addAll(':scope > .portfolio-grid > .portfolio-card,:scope > .projects-grid > .project-tile', 'zoom');
        addAll(':scope > .filters,:scope > .prose.small,:scope > .article-gallery__rail', 'rise');

        if (!pieces.size) {
          [...frame.children].filter(element => !element.hidden).forEach((element, index) => {
            const motion = element.matches('.split__media,.service-block__media,.gallery,img,figure')
              ? 'zoom'
              : index % 3 === 1 ? 'left' : 'rise';
            add(element, motion);
          });
        }
      }

      if (!stage.dataset.scrollStageReady) {
        stage.dataset.scrollStageReady = 'true';
        if (motionObserver) motionObserver.observe(stage);
        else stage.classList.add('is-visible');
      }
    };

    const prepareScrollStages = () => [...mainContent.children].forEach(prepareScrollStage);
    prepareScrollStages();
    window.addEventListener('poke:content-ready', prepareScrollStages);
  }

  if (!prefersReducedMotion) {
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');
      if (!link || link.target || link.hasAttribute('download') || link.dataset.noPageTransition !== undefined) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const destination = new URL(link.href, window.location.href);
      const isSameDocument = destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash;
      if (destination.origin !== window.location.origin || isSameDocument || !/^https?:$/.test(destination.protocol)) return;
      event.preventDefault();
      document.body.classList.add('poke-page-leaving');
      window.setTimeout(() => window.location.assign(destination.href), 230);
    });
    window.addEventListener('pageshow', () => document.body.classList.remove('poke-page-leaving'));
  }

  const initializeArticleGalleries = () => {
    document.querySelectorAll('[data-accordion-gallery]').forEach(gallery => {
      const cards = [...gallery.querySelectorAll('.article-card')];
      if (!cards.length) return;
      const defaultIndex = Math.min(Math.max(Number(gallery.dataset.accordionDefault) || 0, 0), cards.length - 1);
      const activate = (index, preview = false) => {
        cards.forEach((card, cardIndex) => {
          const active = cardIndex === index;
          card.classList.toggle('is-active', active);
          card.classList.toggle('is-preview', active && preview);
        });
      };
      cards.forEach((card, index) => {
        card.onpointerenter = () => activate(index, true);
        card.onfocus = () => activate(index, true);
        card.onpointermove = event => {
          if (event.pointerType && event.pointerType !== 'mouse') return;
          const bounds = card.getBoundingClientRect();
          const x = ((event.clientX - bounds.left) / bounds.width - .5) * -2.5;
          const y = ((event.clientY - bounds.top) / bounds.height - .5) * -2.5;
          card.style.setProperty('--image-x', `${x.toFixed(2)}%`);
          card.style.setProperty('--image-y', `${y.toFixed(2)}%`);
        };
      });
      gallery.onpointerleave = () => activate(defaultIndex);
      activate(defaultIndex);
      gallery.classList.add('is-ready');
    });
  };
  initializeArticleGalleries();
  window.addEventListener('poke:content-ready', initializeArticleGalleries);

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
