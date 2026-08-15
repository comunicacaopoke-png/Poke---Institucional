(() => {
  const contentUrl = '/assets/content.json';
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
    node.href = url || '/contato/';
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
    if (site.gaMeasurementId) document.querySelector('meta[name="google-analytics-id"]')?.setAttribute('content', site.gaMeasurementId);
  };

  const renderProjects = projects => {
    const target = document.querySelector('[data-cms-projects]');
    if (!target) return;
    const items = published(projects);
    if (!items.length) return;
    target.replaceChildren(...items.map(project => {
      const card = link(project.url, 'project-tile');
      card.dataset.projectCategory = text(project.categories, 'todos').toLowerCase();
      card.append(image(project.heroImage, project.name));
      const caption = element('div', 'project-tile__caption');
      caption.append(element('span', 'tag', [project.services, project.year].filter(Boolean).join(' / ')));
      const title = element('h2', '', text(project.name));
      caption.append(title); card.append(caption); return card;
    }));
  };

  const renderProducts = products => {
    const ping = published(products).find(product => product.slug === 'ping');
    if (ping) {
      document.querySelectorAll('[data-cms-ping-name]').forEach(node => { node.textContent = ping.name; });
      document.querySelectorAll('[data-cms-ping-headline]').forEach(node => { node.textContent = ping.headline; });
      document.querySelectorAll('[data-cms-ping-description]').forEach(node => { node.textContent = ping.description; });
      document.querySelectorAll('[data-cms-ping-link]').forEach(node => { node.href = ping.externalUrl || '/produtos/ping/'; });
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
    const items = published(articles);
    if (!items.length) return;
    const featured = items.find(article => article.featured) || items[0];
    const feature = link(featured.url, 'insights-feature');
    const visual = element('div', 'insights-feature__image');
    if (featured.imageUrl) visual.style.backgroundImage = `url("${featured.imageUrl.replace(/"/g, '%22')}")`;
    feature.append(visual);
    const copy = element('div');
    copy.append(element('span', 'eyebrow', `[ ${text(featured.category, 'INSIGHTS').toUpperCase()} ]`));
    copy.append(element('h2', '', featured.title));
    copy.append(element('p', '', featured.summary));
    const cta = element('span', 'nav-cta', 'LER ARTIGO →'); cta.style.marginTop = '25px'; copy.append(cta); feature.append(copy);
    const list = element('div', 'article-list'); list.style.marginTop = '70px';
    items.filter(article => article !== featured).forEach(article => {
      const row = link(article.url, 'article-row');
      row.append(element('span', 'date', text(article.category, 'Insights')));
      row.append(element('h2', '', article.title));
      row.append(element('span', 'arrow', '↗'));
      list.append(row);
    });
    target.replaceChildren(feature, list);
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
