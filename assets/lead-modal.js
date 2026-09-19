// Pop-up "Comece um projeto". Todo botão de chamada para /contato/ (e o botão
// flutuante) abre este formulário em vez de trocar de página. O envio vai para
// o mesmo endpoint do formulário de contato, marcado com tipo: 'projeto'.
(() => {
  const TRIGGERS = 'a.nav-cta[href="/contato/"],a.button[href="/contato/"],a[class*="marca__btn"][href="/contato/"],[data-lead-open]';
  const onContactPage = /^\/contato\/?$/.test(window.location.pathname);

  let endpoint = '';
  window.addEventListener('poke:content-ready', event => {
    endpoint = event.detail?.site?.contactFormEndpoint || endpoint;
  });
  const resolveEndpoint = async () => {
    if (endpoint) return endpoint;
    try {
      const content = await fetch('/assets/content.json', { cache: 'no-store' }).then(r => r.json());
      endpoint = content?.site?.contactFormEndpoint || '';
    } catch (error) { /* segue sem endpoint e mostra o aviso */ }
    return endpoint;
  };

  const modal = document.createElement('dialog');
  modal.className = 'lead-modal';
  modal.setAttribute('aria-labelledby', 'lead-modal-title');
  modal.innerHTML = `
    <div class="lead-modal__inner">
      <button class="lead-modal__close" type="button" data-lead-close aria-label="Fechar">×</button>
      <span class="eyebrow">Comece um projeto</span>
      <h2 id="lead-modal-title">Vamos conversar.</h2>
      <p class="lead-modal__lead">Conte para a gente onde está o atrito. Estudamos seu caso e voltamos com uma proposta de solução.</p>
      <form novalidate>
        <div class="lead-modal__row">
          <label>Seu nome<input name="nome" autocomplete="name" required></label>
          <label>Nome da sua empresa<input name="empresa" autocomplete="organization" required></label>
        </div>
        <label>Seu e-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Nos conte qual problema você quer resolver. Iremos estudar seu caso e te trazer uma solução.<textarea name="mensagem" required></textarea></label>
        <div class="lead-modal__actions">
          <button class="lead-modal__submit" type="submit">Enviar <span>→</span></button>
          <p class="lead-modal__status" data-lead-status role="status" aria-live="polite"></p>
        </div>
      </form>
      <div class="lead-modal__done" data-lead-done hidden>
        <p>Recebemos. Vamos estudar o seu caso e voltamos com uma solução pelo e-mail informado.</p>
        <button class="lead-modal__submit" type="button" data-lead-close>Fechar</button>
      </div>
    </div>`;

  const form = modal.querySelector('form');
  const status = modal.querySelector('[data-lead-status]');
  const done = modal.querySelector('[data-lead-done]');
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.innerHTML;
  let origin = '';

  const setStatus = (message, isError) => {
    status.textContent = message;
    status.toggleAttribute('data-error', Boolean(isError));
  };

  const open = source => {
    origin = source;
    if (!done.hidden) { done.hidden = true; form.hidden = false; }
    setStatus('');
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    document.documentElement.style.overflow = 'hidden';
    window.pokeTrack?.('lead_modal_open', { source });
  };
  const close = () => {
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  };
  modal.addEventListener('close', () => { document.documentElement.style.overflow = ''; });
  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('[data-lead-close]')) close();
  });

  document.addEventListener('click', event => {
    const trigger = event.target.closest(TRIGGERS);
    if (!trigger || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button > 0) return;
    event.preventDefault();
    open(trigger.dataset.leadSource || trigger.textContent.replace(/[↗→]/g, '').trim());
  }, true); // captura: roda antes da transição de página do site.js

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    const url = await resolveEndpoint();
    if (!url) {
      setStatus('O envio ainda não está ativo. Escreva para contato@pokecomunicacao.com.br.', true);
      return;
    }
    const payload = Object.fromEntries(new FormData(form).entries());
    Object.assign(payload, {
      tipo: 'projeto',
      interesse: 'Pop-up: comece um projeto',
      origem: origin,
      page_url: window.location.href,
      submitted_at: new Date().toISOString()
    });
    submit.disabled = true;
    submit.textContent = 'ENVIANDO…';
    setStatus('');
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Falha ao enviar');
      form.reset();
      form.hidden = true;
      done.hidden = false;
      done.querySelector('button').focus();
      window.pokeTrack?.('generate_lead', { form_name: 'popup_projeto', source: origin });
    } catch (error) {
      setStatus('Não foi possível enviar agora. Tente de novo ou escreva para contato@pokecomunicacao.com.br.', true);
    } finally {
      submit.disabled = false;
      submit.innerHTML = submitLabel;
    }
  });

  document.body.append(modal);

  // Botão flutuante: aparece depois que a pessoa começa a rolar a página.
  // Na página de contato o formulário já está à vista, então ele não aparece.
  if (onContactPage) return;
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'lead-fab';
  fab.setAttribute('data-lead-open', '');
  fab.dataset.leadSource = 'Botão flutuante';
  fab.innerHTML = '<span class="lead-fab__dot" aria-hidden="true"></span>Comece um projeto';
  document.body.append(fab);
  const toggleFab = () => fab.classList.toggle('is-visible', window.scrollY > 320);
  window.addEventListener('scroll', toggleFab, { passive: true });
  toggleFab();
})();
