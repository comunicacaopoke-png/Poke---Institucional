(() => {
  const repositoryBase = '';
  const sitePath = url => String(url || '').startsWith('/') ? `${repositoryBase}${url}` : url;
  const contentUrl = sitePath('/assets/content.json');
  const published = items => (Array.isArray(items) ? items : []).filter(item => item.status === 'published');
  const text = (value, fallback = '') => String(value || fallback);
  const element = (name, className, value) => {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const link = (url, className) => {
    const node = document.createElement('a');
    node.className = className;
    node.href = sitePath(url || '/contato/');
    return node;
  };
  const image = (url, alt) => {
    const node = document.createElement('img');
    node.src = url || 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1800&q=86';
    node.alt = alt || '';
    node.loading = 'lazy';
    node.width = 1800;
    node.height = 1200;
    return node;
  };

  const updateContact = site => {
    if (!site) return;
    const location = [site.city, site.state].filter(Boolean).join(' — ') + (site.city || site.state ? ' / Brasil' : '');
    document.querySelectorAll('a[href^="mailto:"]').forEach(anchor => {
      if (!site.email) return;
      const suffix = anchor.textContent.includes('↗') ? ' ↗' : '';
      anchor.href = `mailto:${site.email}`;
      anchor.textContent = `${site.email}${suffix}`;
    });
    if (site.instagramUrl) document.querySelectorAll('a[href*="instagram.com"]').forEach(anchor => { anchor.href = site.instagramUrl; });
    if (site.linkedinUrl) document.querySelectorAll('a[href*="linkedin.com"]').forEach(anchor => { anchor.href = site.linkedinUrl; });
    if (location) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.filter(node => node.nodeValue.trim() === 'Curitiba — PR / Brasil').forEach(node => { node.nodeValue = location; });
    }
    const form = document.querySelector('[data-contact-form]');
    if (form && site.contactFormEndpoint) form.dataset.endpoint = site.contactFormEndpoint;
    const newsletter = document.querySelector('[data-newsletter-form]');
    if (newsletter && site.newsletterEndpoint) newsletter.dataset.endpoint = site.newsletterEndpoint;
    if (site.gaMeasurementId) document.querySelector('meta[name="google-analytics-id"]')?.setAttribute('content', site.gaMeasurementId);
  };

  const renderProjects = projects => {
    const target = document.querySelector('[data-cms-projects]');
    if (!target) return;
    const items = published(projects);
    if (!items.length) return;
    target.replaceChildren(...items.map(project => {
      const card = link(project.url, 'portfolio-card');
      card.dataset.projectCategory = text(project.categories, 'todos').toLowerCase();
      const media = element('div', 'portfolio-card__media');
      media.append(image(project.heroImage, project.name));
      card.append(media);
      const caption = element('div', 'portfolio-card__caption');
      caption.append(element('span', 'portfolio-card__tag', [project.services, project.year].filter(Boolean).join(' · ')));
      const title = element('h2', '', text(project.name));
      caption.append(title);
      caption.append(element('p', 'portfolio-card__summary', text(project.result || project.solution || project.challenge, 'Estratégia, design e tecnologia desenvolvidos para este contexto.')));
      caption.append(element('span', 'portfolio-card__link', 'Ver projeto ↗'));
      card.append(caption); return card;
    }));
  };

  const renderProducts = products => {
    const ping = published(products).find(product => product.slug === 'ping');
    if (ping) {
      document.querySelectorAll('[data-cms-ping-name]').forEach(node => { node.textContent = ping.name; });
      document.querySelectorAll('[data-cms-ping-headline]').forEach(node => { node.textContent = ping.headline; });
      document.querySelectorAll('[data-cms-ping-description]').forEach(node => { node.textContent = ping.description; });
      document.querySelectorAll('[data-cms-ping-link]').forEach(node => { node.href = sitePath(ping.externalUrl || '/produtos/ping/'); });
    }
    const target = document.querySelector('[data-cms-products]');
    const items = published(products).filter(product => product.slug !== 'ping');
    if (!target || !items.length) return;
    target.closest('section').hidden = false;
    target.replaceChildren(...items.map(product => {
      const card = link(product.externalUrl, 'project-tile');
      card.append(image(product.imageUrl, product.name));
      const caption = element('div', 'project-tile__caption');
      caption.append(element('span', 'tag', 'Produto POKE'));
      caption.append(element('h2', '', product.name));
      card.append(caption); return card;
    }));
  };

  const renderInsights = articles => {
    const target = document.querySelector('[data-cms-insights]');
    if (!target) return;
    const fallbackImage = 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1800&q=86';
    const items = published(articles).sort((first, second) => {
      const firstDate = Date.parse(first.publishedAt || '') || 0;
      const secondDate = Date.parse(second.publishedAt || '') || 0;
      return secondDate - firstDate;
    });
    if (!items.length) return;
    const limit = Math.max(1, Number(target.dataset.insightsLimit) || 5);
    const cards = items.slice(0, limit).map(article => {
      const card = link(article.url, 'article-card');
      const imageUrl = text(article.imageUrl, fallbackImage);
      const media = element('div', 'article-card__media');
      media.setAttribute('aria-hidden', 'true');
      media.append(image(imageUrl, ''));
      const copy = element('div', 'article-card__content');
      copy.append(element('span', 'article-card__category', text(article.category, 'Insights')));
      copy.append(element('h3', '', text(article.title, 'Novo artigo')));
      copy.append(element('p', 'article-card__summary', text(article.summary, 'Uma leitura curta sobre decisões de produto, design, comunicação e tecnologia.')));
      copy.append(element('span', 'article-card__link', 'Ler artigo ↗'));
      card.append(media, copy);
      return card;
    });
    target.replaceChildren(...cards);
  };

  fetch(contentUrl, { cache: 'no-store' })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('content unavailable')))
    .then(content => {
      updateContact(content.site);
      renderProjects(content.projects);
      renderProducts(content.products);
      renderInsights(content.articles);
      window.dispatchEvent(new CustomEvent('poke:content-ready', { detail: content }));
    })
    .catch(() => {});
})();
