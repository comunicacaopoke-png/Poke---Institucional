/* POKE CUT — edição de vídeo com IA, 100% no navegador.
   Pipeline: quadros (canvas) + transcrição (Whisper via transformers.js em worker) → Claude decide o plano (JSON) → timeline + render em canvas → exportação (MediaRecorder). */
'use strict';

/* ---------- utilitários ---------- */
const $ = selector => document.querySelector(selector);
const FPS = 30, PAD = 8, IMAGE_SECONDS = 3, FRAME_BUDGET = 90;
const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY_STORAGE = 'pokecut.anthropicKey';
const OVERLAY_STYLES = ['hook', 'title', 'lower_third', 'highlight', 'cta'];
const STYLE_LABEL = { hook: 'GANCHO', title: 'TÍTULO', lower_third: 'LEGENDA DE NOME', highlight: 'DESTAQUE', cta: 'CHAMADA FINAL' };
const MODEL_LABEL = { 'claude-fable-5-1': 'CLAUDE FABLE 5.1', 'claude-opus-5': 'CLAUDE OPUS 5' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const el = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
let uid = 0; const newId = prefix => `${prefix}${++uid}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function formatBytes(bytes) { if (!bytes) return '—'; const units = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
function shortTime(seconds) { if (!Number.isFinite(seconds) || seconds < 0) return '—'; const total = Math.round(seconds * 10) / 10; const m = Math.floor(total / 60), s = total - m * 60; return `${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${Number.isInteger(s) ? s : s.toFixed(1)}`; }
function tc(seconds) { seconds = Math.max(0, seconds || 0); const whole = Math.floor(seconds); const frame = Math.min(FPS - 1, Math.floor((seconds - whole) * FPS)); return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60, frame].map(v => String(v).padStart(2, '0')).join(':'); }
function once(target, event, timeout = 8000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { cleanup(); resolve(false); }, timeout); const ok = () => { cleanup(); resolve(true); }; const fail = () => { cleanup(); reject(new Error('media error')); }; function cleanup() { clearTimeout(timer); target.removeEventListener(event, ok); target.removeEventListener('error', fail); } target.addEventListener(event, ok, { once: true }); target.addEventListener('error', fail, { once: true }); }); }
function storageGet(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function storageSet(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* armazenamento indisponível */ } }

/* ---------- estado ---------- */
let files = [];
let plan = emptyPlan();
let selectedId = null, t = 0, playing = false, lastTs = 0, pxPerSec = 10, drag = null, dirtyFrames = 2;
let undoStack = [], redoStack = [], rightTab = 'ai', aiLog = [], aiBusy = false, pipelineRun = 0, exporting = null;
function emptyPlan() { return { summary: '', clips: [], broll: [], overlays: [], music: [], captions: true, model: '' }; }
const byId = id => files.find(record => record.id === id);

/* ---------- configurações da tela inicial ---------- */
const chipValue = group => document.querySelector(`[data-group="${group}"] .chip.active`)?.dataset.value;
const chipText = group => document.querySelector(`[data-group="${group}"] .chip.active`)?.textContent.trim();
document.addEventListener('click', event => {
  const chip = event.target.closest('[data-group] .chip'); if (!chip) return;
  const group = chip.closest('[data-group]');
  group.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
  if (group.dataset.group === 'destination' && chip.dataset.format) document.querySelectorAll('[data-group="format"] .chip').forEach(c => c.classList.toggle('active', c.dataset.value === chip.dataset.format));
});
function aspect() { const [a, b] = (chipValue('format') || '9:16').split(':').map(Number); return [a, b]; }
function outputSize(longSide = 1920) { const [a, b] = aspect(); return a < b ? [Math.round(longSide * a / b / 2) * 2, longSide] : [longSide, Math.round(longSide * b / a / 2) * 2]; }
const durationAuto = $('#durationAuto'), durationInput = $('#durationInput'), durationHint = $('#durationHint');
let durationIsAuto = true;
function parseDuration(value) { const text = value.trim().toLowerCase().replace(',', '.'); const clock = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/); if (clock) { const v = clock.slice(1).filter(Boolean).map(Number); return v.length === 3 ? v[0] * 3600 + v[1] * 60 + v[2] : v[0] * 60 + v[1]; } const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:minuto|minutos|min|m)\b/)?.[1] || 0); const seconds = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:segundo|segundos|seg|s)\b/)?.[1] || 0); const total = Math.round(minutes * 60 + seconds); return total > 0 ? total : null; }
function setDurationMode(auto) { durationIsAuto = auto; durationAuto.classList.toggle('active', auto); durationInput.classList.toggle('auto', auto); durationHint.textContent = auto ? 'A IA escolhe a duração ideal para o destino. Clique no campo para fixar um tempo.' : 'Tempo obrigatório para a IA. HH:MM:SS, MM:SS ou “45 segundos”.'; }
setDurationMode(true);
durationAuto.addEventListener('click', () => setDurationMode(true));
durationInput.addEventListener('focus', () => setDurationMode(false));
durationInput.addEventListener('blur', () => { const s = parseDuration(durationInput.value); if (s) durationInput.value = tc(s).slice(0, 8); });
function targetSeconds() { return durationIsAuto ? null : parseDuration(durationInput.value); }
function settingsSnapshot() {
  return { destination: chipText('destination'), format: chipValue('format'), size: outputSize(1920).join('×'), duration: targetSeconds(), captions: chipValue('captions'), production: chipValue('production'), productionLabel: chipText('production'), motion: chipValue('motion'), motionLabel: chipText('motion'), freedom: chipValue('freedom'), freedomLabel: chipText('freedom'), model: chipValue('model'), language: chipValue('language') === 'auto' ? null : chipValue('language'), languageLabel: chipText('language'), brief: $('#brief').value.trim() };
}

/* ---------- chave da IA ---------- */
const getKey = () => storageGet(KEY_STORAGE);
function renderKeyBox(box) {
  const key = getKey();
  box.innerHTML = key
    ? `<span class="key-ok">● CLAUDE CONECTADA · •••${esc(key.slice(-4))}</span><button type="button" data-key="remove">TROCAR CHAVE</button><p>A chave fica só neste navegador e vai direto para a Anthropic. O custo é cobrado na conta dona da chave.</p>`
    : `<input type="password" placeholder="Cole sua chave da API Anthropic (sk-ant-...)" autocomplete="off" data-key="input"><button type="button" data-key="save">SALVAR</button><p>Crie em <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com/settings/keys</a>. Fica salva só neste navegador.</p>`;
}
function renderKeyBoxes() { renderKeyBox($('#keyRow')); if (rightTab === 'ai' && $('#editor').classList.contains('active')) renderInspector(); }
document.addEventListener('click', event => {
  const action = event.target.closest('[data-key]')?.dataset.key; if (!action || action === 'input') return;
  const box = event.target.closest('.key-row, .inspector');
  if (action === 'remove') storageSet(KEY_STORAGE, '');
  if (action === 'save') { const value = box.querySelector('[data-key="input"]').value.trim(); if (!/^sk-ant-/.test(value)) { box.querySelector('p').textContent = 'Essa chave não parece da Anthropic (começa com sk-ant-).'; return; } storageSet(KEY_STORAGE, value); }
  renderKeyBoxes();
});
document.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.matches('[data-key="input"]')) event.target.closest('.key-row, .inspector').querySelector('[data-key="save"]').click(); });
renderKeyBox($('#keyRow'));

/* ---------- material ---------- */
const dropzone = $('#dropzone'), staged = $('#staged'), fileStatus = $('#fileStatus');
const picker = el('input'); picker.type = 'file'; picker.multiple = true; picker.accept = 'video/*,audio/*,image/*'; picker.hidden = true; document.body.append(picker);
const kindLabel = { video: 'VID', audio: 'AUD', image: 'IMG', other: 'AST' };
const kindName = { video: 'VÍDEO', audio: 'ÁUDIO', image: 'IMAGEM', other: 'ARQUIVO' };
function mediaKind(file) { const ext = (file.name.split('.').pop() || '').toLowerCase(); if (file.type.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video'; if (file.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio'; if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'; return 'other'; }
async function inspectFile(file) {
  const record = { id: newId('f'), file, url: URL.createObjectURL(file), kind: mediaKind(file), duration: null, width: 0, height: 0, thumb: null, playable: true, frames: null, transcript: null, speech: null };
  try {
    if (record.kind === 'image') { const image = new Image(); image.src = record.url; await image.decode(); record.width = image.naturalWidth; record.height = image.naturalHeight; record.thumb = record.url; record.image = image; }
    else if (record.kind === 'video' || record.kind === 'audio') {
      const media = el(record.kind); media.preload = 'metadata'; media.muted = true; media.src = record.url;
      await once(media, 'loadedmetadata', 10000);
      record.duration = Number.isFinite(media.duration) ? media.duration : null;
      if (record.kind === 'video') { record.width = media.videoWidth; record.height = media.videoHeight; if (!media.videoWidth) record.playable = false; }
      media.removeAttribute('src'); media.load();
    } else record.playable = false;
  } catch { record.playable = false; }
  if (!record.duration && record.kind !== 'image') record.playable = false;
  return record;
}
function renderFiles() {
  staged.replaceChildren();
  files.forEach(record => {
    const row = el('div', 'staged-file'); const type = el('span', 'kind'); type.textContent = kindLabel[record.kind];
    const name = el('span', 'name'); name.textContent = record.file.name;
    const size = el('small'); size.textContent = `${formatBytes(record.file.size)}${record.duration ? ` / ${shortTime(record.duration)}` : ''}${record.playable ? '' : ' / NÃO TOCA NO NAVEGADOR'}`;
    const remove = el('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remover ${record.file.name}`);
    remove.addEventListener('click', event => { event.stopPropagation(); removeFile(record.id); });
    row.append(type, name, size, remove); staged.append(row);
  });
  const unplayable = files.filter(r => !r.playable).length;
  fileStatus.textContent = files.length ? `${files.length} arquivo${files.length > 1 ? 's' : ''} no projeto.${unplayable ? ` ${unplayable} não toca${unplayable > 1 ? 'm' : ''} neste navegador (converta para MP4 H.264).` : ''}` : '';
}
function removeFile(id) { const record = byId(id); if (record) URL.revokeObjectURL(record.url); files = files.filter(r => r.id !== id); for (const key of ['clips', 'broll', 'music']) plan[key] = plan[key].filter(c => c.src !== id); renderFiles(); }
async function addFiles(list) {
  const known = new Set(files.map(r => `${r.file.name}-${r.file.size}-${r.file.lastModified}`));
  const incoming = Array.from(list).filter(f => !known.has(`${f.name}-${f.size}-${f.lastModified}`)); if (!incoming.length) return;
  fileStatus.textContent = 'Lendo arquivos…';
  files = [...files, ...await Promise.all(incoming.map(inspectFile))]; renderFiles();
}
let dragDepth = 0;
dropzone.addEventListener('click', () => picker.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
picker.addEventListener('change', async () => { await addFiles(picker.files); picker.value = ''; });
dropzone.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; dropzone.classList.add('dragging'); });
dropzone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
dropzone.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dropzone.classList.remove('dragging'); } });
dropzone.addEventListener('drop', async e => { e.preventDefault(); dragDepth = 0; dropzone.classList.remove('dragging'); await addFiles(e.dataTransfer.files); });

/* ---------- navegação ---------- */
function showScreen(id) {
  if (id !== 'editor') pause();
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (id === 'editor') { renderEditor(); requestAnimationFrame(() => { fitStage(); renderTimeline(); dirtyFrames = 4; }); }
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.go)));

/* ---------- 1. assistir: quadros ---------- */
async function sampleFrames(record, count) {
  const video = el('video'); video.muted = true; video.preload = 'auto'; video.playsInline = true; video.src = record.url;
  try { await once(video, 'loadeddata', 12000); } catch { record.playable = false; return []; }
  if (!video.videoWidth) { record.playable = false; return []; }
  const long = 384, scale = long / Math.max(video.videoWidth, video.videoHeight);
  const canvas = el('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d'); const frames = []; const duration = record.duration || video.duration;
  for (let i = 0; i < count; i++) {
    const time = Math.min(duration - 0.05, duration * (i + 0.5) / count);
    video.currentTime = Math.max(0, time);
    await once(video, 'seeked', 6000).catch(() => false);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({ t: time, data: canvas.toDataURL('image/jpeg', 0.72).split(',')[1] });
  }
  record.thumb = `data:image/jpeg;base64,${frames[0]?.data || ''}`;
  video.removeAttribute('src'); video.load();
  return frames;
}
function imageFrame(record) {
  const long = 512, scale = Math.min(1, long / Math.max(record.width, record.height));
  const canvas = el('canvas'); canvas.width = Math.max(1, Math.round(record.width * scale)); canvas.height = Math.max(1, Math.round(record.height * scale));
  canvas.getContext('2d').drawImage(record.image, 0, 0, canvas.width, canvas.height);
  return [{ t: 0, data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] }];
}
function frameCounts(visual) {
  const images = visual.filter(r => r.kind === 'image').length; const videos = visual.filter(r => r.kind === 'video');
  const budget = Math.max(videos.length * 2, FRAME_BUDGET - images);
  const wanted = videos.map(r => clamp(Math.ceil((r.duration || 0) / 2.5), 3, 20)); const sum = wanted.reduce((a, b) => a + b, 0);
  const factor = sum > budget ? budget / sum : 1;
  return new Map(videos.map((r, i) => [r.id, Math.max(2, Math.floor(wanted[i] * factor))]));
}

/* ---------- 2. ouvir: transcrição (Whisper no navegador) ---------- */
const WORKER_SOURCE = `
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
let asr = null, device = null;
async function load(target) {
  asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', {
    device: target,
    dtype: target === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: p => { if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); },
  });
  device = target;
}
self.onmessage = async event => {
  const { id, audio, language } = event.data;
  try {
    if (!asr) {
      let gpu = false;
      try { gpu = !!(self.navigator.gpu && await self.navigator.gpu.requestAdapter()); } catch { gpu = false; }
      try { await load(gpu ? 'webgpu' : 'wasm'); } catch (error) { if (!gpu) throw error; await load('wasm'); }
      self.postMessage({ type: 'ready', device });
    }
    const options = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
    if (language) options.language = language;
    const output = await asr(audio, options);
    self.postMessage({ id, type: 'result', chunks: output.chunks || [], text: output.text || '' });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: String((error && error.message) || error) });
  }
};`;
let asrWorker = null, asrSeq = 0, asrListener = null; const asrPending = new Map();
function asr() {
  if (asrWorker) return asrWorker;
  asrWorker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })), { type: 'module' });
  asrWorker.onmessage = event => {
    const message = event.data;
    if (message.type === 'progress' || message.type === 'ready') { asrListener?.(message); return; }
    const pending = asrPending.get(message.id); if (!pending) return; asrPending.delete(message.id);
    message.type === 'error' ? pending.reject(new Error(message.message)) : pending.resolve(message);
  };
  asrWorker.onerror = event => { for (const p of asrPending.values()) p.reject(new Error(event.message || 'Falha ao carregar o transcritor.')); asrPending.clear(); asrWorker = null; };
  return asrWorker;
}
function transcribeAudio(audio, language) { return new Promise((resolve, reject) => { const id = ++asrSeq; asrPending.set(id, { resolve, reject }); asr().postMessage({ id, audio, language }, [audio.buffer]); }); }
function wordsToSegments(words) {
  const segments = []; let current = null;
  for (const word of words) {
    if (current && (word.start - current.end > 0.7 || current.words.length >= 14)) { segments.push(current); current = null; }
    if (!current) current = { start: word.start, end: word.end, words: [] };
    current.words.push(word); current.end = word.end;
    if (/[.!?…]$/.test(word.text) || (/[,;:]$/.test(word.text) && current.words.length >= 6)) { segments.push(current); current = null; }
  }
  if (current) segments.push(current);
  return segments.map(seg => ({ start: seg.start, end: seg.end, text: seg.words.map(w => w.text).join(' ') }));
}
async function decodeMono16k(file) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext; const ctx = new AudioCtx({ sampleRate: 16000 });
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const out = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) { const data = buffer.getChannelData(c); for (let i = 0; i < data.length; i++) out[i] += data[i] / buffer.numberOfChannels; }
    return out;
  } finally { ctx.close(); }
}
function loudness(samples) { let peak = 0; const block = 1600; for (let i = 0; i < samples.length; i += block) { let sum = 0; const end = Math.min(samples.length, i + block); for (let j = i; j < end; j++) sum += samples[j] * samples[j]; peak = Math.max(peak, Math.sqrt(sum / (end - i))); } return peak; }

/* ---------- 3. decidir: Claude ---------- */
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'clips', 'broll', 'overlays', 'captions', 'music'],
  properties: {
    summary: { type: 'string' },
    clips: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'in', 'out', 'crop_x', 'crop_y', 'zoom', 'reason'], properties: { file: { type: 'string' }, in: { type: 'number' }, out: { type: 'number' }, crop_x: { type: 'number' }, crop_y: { type: 'number' }, zoom: { type: 'number' }, reason: { type: 'string' } } } },
    broll: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'in', 'out', 'at', 'crop_x', 'crop_y', 'zoom'], properties: { file: { type: 'string' }, in: { type: 'number' }, out: { type: 'number' }, at: { type: 'number' }, crop_x: { type: 'number' }, crop_y: { type: 'number' }, zoom: { type: 'number' } } } },
    overlays: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'at', 'duration', 'style'], properties: { text: { type: 'string' }, at: { type: 'number' }, duration: { type: 'number' }, style: { type: 'string', enum: OVERLAY_STYLES } } } },
    captions: { type: 'boolean' },
    music: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'in', 'out', 'at', 'volume'], properties: { file: { type: 'string' }, in: { type: 'number' }, out: { type: 'number' }, at: { type: 'number' }, volume: { type: 'number' } } } },
  },
};
const SYSTEM_PROMPT = `Você é o editor de vídeo sênior da POKE, uma agência brasileira de comunicação. Você recebe o material bruto de um projeto — quadros amostrados de cada vídeo com o segundo em que foram capturados e a transcrição das falas com tempos — junto com o brief e as configurações escolhidas. Você decide a edição completa e devolve o plano no esquema JSON. O resultado deve parecer editado por um profissional, não uma sequência de arquivos.

Como a ferramenta executa o plano:
- clips: a sequência principal, tocada em ordem com o áudio original. "in"/"out" são segundos do arquivo de origem. A duração final do vídeo é a soma dos clips. Cada clip é cortado para preencher o formato de saída sem faixas pretas: crop_x e crop_y (0 a 1) são o centro do enquadramento dentro do quadro original e zoom (1 = só preencher; até 2.5) aproxima. Escolha esse centro olhando os quadros para manter o assunto (rosto de quem fala, ação principal) dentro do formato — em saída vertical a partir de material horizontal, isso decide a qualidade.
- broll: vídeos ou imagens exibidos por cima da sequência principal, só a imagem (o áudio da sequência continua). "at" é o segundo na timeline final. Ótimo para cobrir cortes de fala e ilustrar o que é dito.
- overlays: textos de motion design animados por cima do vídeo. Estilos: hook (frase de impacto no início), title, lower_third (nome, cargo ou local), highlight (palavra ou número em destaque), cta (chamada final). "at" e "duration" em segundos da timeline final. Textos curtos, em português, sem emojis.
- captions: legendas automáticas geradas a partir da transcrição dos trechos escolhidos.
- music: arquivos de áudio usados como trilha; volume de 0 a 1. A ferramenta abaixa a trilha sozinha enquanto alguém fala.
- Arquivos de imagem usados em clips ou broll: use in = 0 e out = quantos segundos a imagem fica na tela.

Critérios: gancho forte nos primeiros 2–3 segundos; uma história com começo, meio e fim; cortes de fala em fronteiras de frase usando os tempos da transcrição, nunca no meio de uma palavra; remova hesitações, repetições e trechos fracos; evite quadros tremidos, desfocados ou vazios; ritmo adequado ao destino. Quando uma configuração estiver como "IA decide", decida você. Uma duração definida pelo usuário é obrigatória (tolerância de 5%). Use somente os ids de arquivo listados. Em "summary", explique em português, em até 4 frases, a história escolhida e as principais decisões; em "reason", diga por que cada trecho entrou.`;
function projectHeader(settings) {
  const destinationHint = /REELS|STORY|TIKTOK|SHORTS|ADS/.test(settings.destination || '') ? ' (vertical, para celular; normalmente 15 a 60 s)' : '';
  return [
    'PROJETO',
    `Destino: ${settings.destination}${destinationHint}`,
    `Formato de saída: ${settings.format} (${settings.size})`,
    `Duração: ${settings.duration ? `${settings.duration} segundos — obrigatória` : 'IA decide'}`,
    `Produção: ${settings.productionLabel}${settings.production === 'video' ? ' — não use overlays' : settings.production === 'motion' ? ' — o vídeo é guiado por textos de motion' : ''}`,
    `Motion / textos: ${settings.motionLabel}`,
    `Legendas: ${settings.captions === 'ai' ? 'IA decide' : settings.captions === 'on' ? 'sim' : 'não'}`,
    `Liberdade criativa: ${settings.freedomLabel}`,
    `Idioma da fala: ${settings.languageLabel || 'auto'} (textos e legendas nesse idioma)`,
    `Brief: ${settings.brief ? `"${settings.brief}"` : 'sem brief — encontre a melhor história no material.'}`,
  ].join('\n');
}
function materialContent() {
  const content = [];
  for (const record of files) {
    if (!record.playable) continue;
    const info = [`ARQUIVO ${record.id} — "${record.file.name}" — ${kindName[record.kind]}`];
    if (record.width) info.push(`${record.width}×${record.height}`);
    if (record.duration) info.push(`duração ${record.duration.toFixed(2)} s`);
    if (record.kind !== 'image') info.push(record.speech === false ? 'sem fala detectada' : record.transcript?.length ? 'com fala' : 'fala não transcrita');
    let text = info.join(' · ');
    if (record.transcript?.length) text += `\nTRANSCRIÇÃO:\n${record.transcript.map(s => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${s.text.trim()}`).join('\n')}`;
    if (record.frames?.length) text += `\nQUADROS (${record.frames.length}):`;
    content.push({ type: 'text', text });
    for (const frame of record.frames || []) {
      if (record.kind === 'video') content.push({ type: 'text', text: `${record.id} @ ${frame.t.toFixed(2)} s` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame.data } });
    }
  }
  return content;
}
function planForPrompt() {
  return JSON.stringify({
    clips: layout(plan.clips).map(i => ({ file: i.clip.src, in: +i.clip.in.toFixed(2), out: +i.clip.out.toFixed(2), crop_x: +i.clip.cx.toFixed(3), crop_y: +i.clip.cy.toFixed(3), zoom: +i.clip.zoom.toFixed(2), reason: i.clip.reason || '', timeline_start: +i.start.toFixed(2) })),
    broll: plan.broll.map(b => ({ file: b.src, in: +b.in.toFixed(2), out: +b.out.toFixed(2), at: +b.at.toFixed(2), crop_x: b.cx, crop_y: b.cy, zoom: b.zoom })),
    overlays: plan.overlays.map(o => ({ text: o.text, at: +o.at.toFixed(2), duration: +o.dur.toFixed(2), style: o.style })),
    captions: plan.captions,
    music: plan.music.map(m => ({ file: m.src, in: +m.in.toFixed(2), out: +m.out.toFixed(2), at: +m.at.toFixed(2), volume: m.volume })),
  });
}
async function callClaude(content, { model, onStatus }) {
  const key = getKey(); if (!key) throw new Error('Conecte sua chave da Anthropic para a IA editar.');
  const body = { model, max_tokens: 32000, stream: true, output_config: { effort: 'high', format: { type: 'json_schema', schema: PLAN_SCHEMA } }, fallbacks: 'default', system: SYSTEM_PROMPT, messages: [{ role: 'user', content }] };
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' };
  onStatus?.('Enviando material para a IA…');
  let response = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (response.status === 400) {
    const detail = await response.json().catch(() => ({})); const message = detail?.error?.message || '';
    if (!/fallback/i.test(message)) throw new Error(message || 'A IA recusou a requisição (400).');
    delete body.fallbacks; delete headers['anthropic-beta'];
    response = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})); const message = detail?.error?.message || response.statusText;
    const hints = { 401: 'Chave inválida. Confira a chave da Anthropic.', 403: 'Esta chave não tem acesso a esse modelo.', 404: 'Modelo indisponível para esta chave.', 413: 'Material grande demais para uma requisição.', 429: 'Limite de uso da conta atingido. Aguarde um pouco.', 529: 'A IA está sobrecarregada. Tente de novo em instantes.' };
    throw new Error(`${hints[response.status] || 'Erro da IA.'} (${response.status}: ${message})`);
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = '', text = '', stopReason = null, usage = {}, usedModel = model; const started = performance.now();
  const ticker = setInterval(() => { if (!text) onStatus?.(`A IA está assistindo e decidindo… ${Math.round((performance.now() - started) / 1000)} s`); }, 1000);
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const line = raw.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
        let event; try { event = JSON.parse(line.slice(5)); } catch { continue; }
        if (event.type === 'message_start') { usedModel = event.message?.model || usedModel; Object.assign(usage, event.message?.usage || {}); }
        else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') { text += event.delta.text; onStatus?.(`A IA está escrevendo o plano de edição… ${text.length} caracteres`); }
        else if (event.type === 'message_delta') { stopReason = event.delta?.stop_reason ?? stopReason; Object.assign(usage, event.usage || {}); }
        else if (event.type === 'error') throw new Error(event.error?.message || 'Erro durante a resposta da IA.');
      }
    }
  } finally { clearInterval(ticker); }
  if (stopReason === 'refusal') throw new Error('A IA recusou este pedido.');
  if (stopReason === 'max_tokens') throw new Error('A resposta da IA foi cortada antes do fim. Tente com menos material.');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('A IA não devolveu um plano de edição.');
  return { raw: JSON.parse(text.slice(start, end + 1)), usage, model: usedModel };
}
function normalizePlan(raw, settings) {
  const source = id => { const r = byId(id); return r && r.playable ? r : null; };
  const range = (record, a, b) => {
    if (record.kind === 'image') { const length = clamp((+b || 0) - (+a || 0) || IMAGE_SECONDS, 0.5, 30); return [0, length]; }
    const max = record.duration || 0; const i = clamp(+a || 0, 0, max), o = clamp(+b || 0, 0, max);
    return o - i >= 0.2 ? [i, o] : null;
  };
  const framing = item => ({ cx: clamp(Number.isFinite(+item.crop_x) ? +item.crop_x : 0.5, 0, 1), cy: clamp(Number.isFinite(+item.crop_y) ? +item.crop_y : 0.5, 0, 1), zoom: clamp(+item.zoom || 1, 1, 2.5) });
  const next = emptyPlan();
  next.summary = String(raw.summary || '');
  for (const item of raw.clips || []) { const r = source(item.file); if (!r || !['video', 'image'].includes(r.kind)) continue; const span = range(r, item.in, item.out); if (span) next.clips.push({ id: newId('c'), src: r.id, in: span[0], out: span[1], ...framing(item), reason: String(item.reason || '') }); }
  if (!next.clips.length) throw new Error('A IA não devolveu nenhum trecho utilizável do material.');
  const total = next.clips.reduce((s, c) => s + c.out - c.in, 0);
  for (const item of raw.broll || []) { const r = source(item.file); if (!r || !['video', 'image'].includes(r.kind)) continue; const span = range(r, item.in, item.out); const at = clamp(+item.at || 0, 0, total - 0.2); if (span) next.broll.push({ id: newId('b'), src: r.id, in: span[0], out: span[0] + Math.min(span[1] - span[0], total - at), at, ...framing(item) }); }
  if (settings.production !== 'video') for (const item of raw.overlays || []) { const text = String(item.text || '').trim(); if (!text) continue; const at = clamp(+item.at || 0, 0, total - 0.3); next.overlays.push({ id: newId('o'), text, at, dur: clamp(+item.duration || 2, 0.5, Math.max(0.5, total - at)), style: OVERLAY_STYLES.includes(item.style) ? item.style : 'highlight' }); }
  for (const item of raw.music || []) { const r = source(item.file); if (!r || r.kind !== 'audio') continue; const span = range(r, item.in, item.out); const at = clamp(+item.at || 0, 0, total - 0.2); if (span) next.music.push({ id: newId('m'), src: r.id, in: span[0], out: span[0] + Math.min(span[1] - span[0], total - at), at, volume: clamp(+item.volume || 0.6, 0, 1) }); }
  next.captions = settings.captions === 'on' ? true : settings.captions === 'off' ? false : !!raw.captions;
  return next;
}

/* ---------- pipeline (tela de análise) ---------- */
const STEPS = [
  { id: 'watch', label: 'Assistindo o material', sub: 'Quadros de cada vídeo e imagem' },
  { id: 'listen', label: 'Ouvindo as falas', sub: 'Transcrição com tempos, no navegador' },
  { id: 'decide', label: 'Decidindo a edição', sub: 'História, cortes, enquadramento, textos' },
  { id: 'build', label: 'Montando a timeline', sub: 'Plano aplicado ao editor' },
];
const stepState = {};
function renderSteps() { $('#anSteps').innerHTML = STEPS.map(s => { const st = stepState[s.id] || { state: 'pending' }; const label = { pending: 'AGUARDANDO', running: 'EM ANDAMENTO', done: 'CONCLUÍDO', error: 'ERRO', skipped: 'PULADO' }[st.state]; return `<li class="${st.state}"><div><strong>${esc(s.label)}</strong><small>${esc(st.detail || s.sub)}</small></div><em>${label}</em></li>`; }).join(''); }
function setStep(id, state, detail) { stepState[id] = { state, detail }; renderSteps(); }
function setProgress(fraction, label) { const pct = Math.round(clamp(fraction, 0, 1) * 100); $('#anBar').style.width = `${pct}%`; $('#anPct').textContent = `${pct}%`; if (label) $('#anStep').textContent = label; }
const live = text => { $('#anLive').textContent = text; };
function analysisActions(buttons) { const box = $('#anActions'); box.replaceChildren(...buttons.map(([label, handler, primary]) => { const b = el('button', primary ? 'pill' : 'ghost'); b.textContent = label; b.addEventListener('click', handler); return b; })); }

$('#createBtn').addEventListener('click', () => {
  if (!files.some(r => r.playable && r.kind !== 'audio')) { fileStatus.textContent = 'Adicione pelo menos um vídeo ou imagem que toque neste navegador.'; dropzone.focus(); return; }
  if (!getKey()) { const box = $('#keyRow'); box.querySelector('p').textContent = 'Cole sua chave da Anthropic para a IA editar.'; box.querySelector('input')?.focus(); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  runPipeline();
});
async function runPipeline() {
  const run = ++pipelineRun; const settings = settingsSnapshot(); const alive = () => run === pipelineRun;
  for (const s of STEPS) stepState[s.id] = { state: 'pending' };
  renderSteps(); showScreen('analysis'); analysisActions([]); setProgress(0, 'INICIANDO');
  $('#anEyebrow').textContent = `PROJECT / ${(settings.brief || 'NOVA EDIÇÃO').slice(0, 48).toUpperCase()}`;
  $('#anTitle').innerHTML = 'A IA ESTÁ<br>ASSISTINDO SEU <span class="green">MATERIAL.</span>';

  // 1. quadros
  setStep('watch', 'running'); const visual = files.filter(r => r.playable && (r.kind === 'video' || r.kind === 'image')); const counts = frameCounts(visual);
  for (const [index, record] of visual.entries()) {
    if (!alive()) return;
    setProgress(0.25 * index / visual.length, `QUADROS ${index + 1}/${visual.length}`); live(`Capturando quadros de ${record.file.name}…`);
    if (record.kind === 'image') record.frames = imageFrame(record);
    else if (!record.frames || record.frames.length !== counts.get(record.id)) record.frames = await sampleFrames(record, counts.get(record.id));
  }
  const frameTotal = visual.reduce((s, r) => s + (r.frames?.length || 0), 0);
  setStep('watch', 'done', `${frameTotal} quadros de ${visual.length} arquivo${visual.length > 1 ? 's' : ''}`);

  // 2. transcrição
  if (!alive()) return;
  const audible = files.filter(r => r.playable && r.kind === 'video' && (r.transcript === null || (r.speech && r.transcriptLanguage !== settings.language)));
  if (!audible.length) setStep('listen', files.some(r => r.transcript?.length) ? 'done' : 'skipped', files.some(r => r.transcript?.length) ? 'Transcrição já feita' : 'Nenhum vídeo com áudio');
  else {
    setStep('listen', 'running', 'Preparando o transcritor (download único de ~200 MB na primeira vez)');
    const downloads = new Map();
    asrListener = message => {
      if (message.type === 'progress' && message.total) { downloads.set(message.file, [message.loaded, message.total]); const [loaded, total] = [...downloads.values()].reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]); live(`Baixando o transcritor: ${formatBytes(loaded)} de ${formatBytes(total)} (só na primeira vez).`); }
      if (message.type === 'ready') live(`Transcritor pronto (${message.device === 'webgpu' ? 'GPU' : 'CPU'}).`);
    };
    let words = 0, failure = null;
    for (const [index, record] of audible.entries()) {
      if (!alive()) return;
      setProgress(0.25 + 0.35 * index / audible.length, `OUVINDO ${index + 1}/${audible.length}`);
      try {
        live(`Extraindo o áudio de ${record.file.name}…`);
        const samples = await decodeMono16k(record.file);
        if (loudness(samples) < 0.01) { record.speech = false; record.transcript = []; continue; }
        live(`Transcrevendo ${record.file.name}… (pode levar alguns minutos em vídeos longos)`);
        const result = await transcribeAudio(samples, settings.language);
        record.words = result.chunks.map(c => ({ start: +c.timestamp[0] || 0, end: +(c.timestamp[1] ?? c.timestamp[0]) || 0, text: String(c.text || '').trim() })).filter(w => w.text);
        for (const w of record.words) if (w.end <= w.start) w.end = w.start + 0.25;
        record.transcript = wordsToSegments(record.words); record.transcriptLanguage = settings.language;
        record.speech = record.transcript.length > 0; words += record.transcript.reduce((s, x) => s + x.text.trim().split(/\s+/).length, 0);
      } catch (error) {
        if (/decode|EncodingError|Unable to decode/i.test(String(error))) { record.speech = false; record.transcript = []; }
        else { failure = error; record.transcript = null; }
      }
    }
    asrListener = null;
    if (failure && !words) setStep('listen', 'error', `Transcrição indisponível (${failure.message}). A IA vai editar só pelas imagens.`);
    else setStep('listen', 'done', words ? `${words} palavras transcritas` : 'Sem fala detectada');
  }

  // 3. IA
  await decideWithAi(settings, run);
}
async function decideWithAi(settings, run) {
  const alive = () => run === pipelineRun;
  const modelName = MODEL_LABEL[settings.model] || settings.model;
  setStep('decide', 'running', modelName); setProgress(0.62, 'IA DECIDINDO'); analysisActions([]);
  $('#anTitle').innerHTML = 'A IA ESTÁ<br>EDITANDO SEU <span class="green">VÍDEO.</span>';
  try {
    const content = [{ type: 'text', text: projectHeader(settings) }, ...materialContent(), { type: 'text', text: 'Decida a edição completa e devolva o plano.' }];
    const result = await callClaude(content, { model: settings.model, onStatus: text => { if (alive()) live(text); } });
    if (!alive()) return;
    setStep('decide', 'done', `${MODEL_LABEL[result.model] || result.model} · ${usageText(result.usage)}`);
    setStep('build', 'running'); setProgress(0.95, 'MONTANDO');
    plan = normalizePlan(result.raw, settings); plan.model = result.model; plan.settings = settings;
    selectedId = null; t = 0; undoStack = []; redoStack = [];
    aiLog = [{ title: `EDIÇÃO CRIADA · ${MODEL_LABEL[result.model] || result.model}`, detail: plan.summary, usage: result.usage }];
    setStep('build', 'done', `${plan.clips.length} cortes · ${plan.broll.length} b-roll · ${plan.overlays.length} textos · ${shortTime(totalDuration())}`);
    setProgress(1, 'EDIÇÃO PRONTA'); $('#anTitle').innerHTML = 'EDIÇÃO<br><span class="green">PRONTA.</span>'; live(plan.summary);
    rightTab = 'ai'; await sleep(1200); if (alive() && $('#analysis').classList.contains('active')) showScreen('editor');
  } catch (error) {
    if (!alive()) return;
    setStep('decide', 'error', error.message); setProgress(0.62, 'A IA NÃO CONCLUIU'); live(error.message);
    $('#anTitle').innerHTML = 'A IA NÃO<br>CONSEGUIU <span class="green">EDITAR.</span>';
    analysisActions([['TENTAR DE NOVO →', () => decideWithAi(settingsSnapshot(), ++pipelineRun), true], ['VOLTAR E AJUSTAR', () => showScreen('home')]]);
    const keyBox = el('div', 'key-row'); renderKeyBox(keyBox); if (/chave/i.test(error.message)) $('#anActions').append(keyBox);
  }
}
function usageText(usage) { const input = usage?.input_tokens || 0, output = usage?.output_tokens || 0; return input || output ? `${(input / 1000).toFixed(1)}k tokens enviados · ${(output / 1000).toFixed(1)}k gerados` : ''; }

/* ---------- modelo da timeline ---------- */
const len = item => item.dur ?? item.out - item.in;
function layout(list) { let start = 0; return list.map(clip => { const item = { clip, start, end: start + len(clip) }; start = item.end; return item; }); }
function totalDuration() { const main = plan.clips.reduce((s, c) => s + len(c), 0); return main || Math.max(0, ...plan.overlays.map(o => o.at + o.dur), ...plan.broll.map(b => b.at + len(b))); }
const itemAt = (list, time) => layout(list).find(item => time >= item.start && time < item.end) || null;
const activeAt = (list, time) => list.find(item => time >= item.at && time < item.at + len(item)) || null;
function findEntity(id) { for (const track of ['clips', 'broll', 'overlays', 'music']) { const item = plan[track].find(x => x.id === id); if (item) return { track, list: plan[track], item }; } return null; }
function snapshot() { return JSON.stringify(plan); }
function commit(before) { undoStack.push(before || snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack = []; }
function restore(json) { plan = JSON.parse(json); if (!findEntity(selectedId)) selectedId = null; t = Math.min(t, totalDuration()); renderEditor(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
function maxOut(record) { return record.kind === 'image' ? 60 : record.duration || 0; }
let cueCache = null;
function captionCues() {
  if (cueCache) return cueCache; cueCache = []; if (!plan.captions) return cueCache;
  for (const item of layout(plan.clips)) {
    const record = byId(item.clip.src); if (!record?.words?.length) continue;
    const words = record.words.filter(w => w.start >= item.clip.in - 0.05 && w.end <= item.clip.out + 0.1).map(w => ({ text: w.text, start: item.start + clamp(w.start - item.clip.in, 0, len(item.clip)), end: item.start + clamp(w.end - item.clip.in, 0, len(item.clip)) }));
    let group = [];
    const flush = () => { if (!group.length) return; const next = { start: group[0].start, end: Math.max(group.at(-1).end, group[0].start + 0.3), text: group.map(w => w.text).join(' '), words: group }; cueCache.push(next); group = []; };
    for (const word of words) { if (group.length && (group.length >= 4 || word.start - group.at(-1).end > 0.5)) flush(); group.push(word); if (/[.!?,…]$/.test(word.text)) flush(); }
    flush();
  }
  for (let i = 0; i < cueCache.length - 1; i++) if (cueCache[i + 1].start - cueCache[i].end < 0.35) cueCache[i].end = cueCache[i + 1].start;
  return cueCache;
}
function planChanged() { cueCache = null; dirtyFrames = 3; }

/* ---------- render (preview e exportação usam o mesmo desenho) ---------- */
const mainVideo = el('video'), brollVideo = el('video'), musicEl = el('audio');
for (const media of [mainVideo, brollVideo]) { media.playsInline = true; media.preload = 'auto'; }
brollVideo.muted = true;
for (const media of [mainVideo, brollVideo, musicEl]) { media.addEventListener('loadedmetadata', () => syncAll(true)); media.addEventListener('seeked', () => { dirtyFrames = 3; }); media.addEventListener('loadeddata', () => { dirtyFrames = 3; }); }
function makeRenderer(canvas) { const layer = el('canvas'); return { canvas, ctx: canvas.getContext('2d'), layer, lctx: layer.getContext('2d') }; }
const stage = makeRenderer($('#stage'));
function drawCover(ctx, source, sw, sh, framing, W, H, extraZoom = 1) {
  if (!sw || !sh) return;
  const scale = Math.max(W / sw, H / sh) * clamp((framing.zoom || 1) * extraZoom, 1, 4);
  const vw = W / scale, vh = H / scale;
  const sx = clamp(framing.cx * sw - vw / 2, 0, sw - vw), sy = clamp(framing.cy * sh - vh / 2, 0, sh - vh);
  ctx.drawImage(source, sx, sy, vw, vh, 0, 0, W, H);
}
function drawLayer(ctx, record, element, framing, W, H, progress) {
  if (record.kind === 'image') { if (record.image) drawCover(ctx, record.image, record.width, record.height, framing, W, H, 1 + 0.06 * progress); return true; }
  if (element.dataset.src === record.id && element.readyState >= 2) { drawCover(ctx, element, element.videoWidth, element.videoHeight, framing, W, H); return true; }
  return false;
}
function wrapLines(ctx, text, maxWidth) { const words = text.split(/\s+/); const lines = []; let line = ''; for (const word of words) { const test = line ? `${line} ${word}` : word; if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test; } if (line) lines.push(line); return lines; }
const ease = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
function drawOverlay(ctx, W, H, overlay, time) {
  const S = Math.min(W, H) / 1080; const local = time - overlay.at; const animated = plan.settings?.motion !== 'none';
  const intro = animated ? ease(local / 0.35) : 1, outro = animated ? ease((overlay.at + overlay.dur - time) / 0.25) : 1; const alpha = Math.min(intro, outro);
  const text = overlay.text.toUpperCase(); ctx.save(); ctx.globalAlpha = alpha; ctx.textBaseline = 'middle';
  if (overlay.style === 'hook' || overlay.style === 'highlight') {
    const size = (overlay.style === 'hook' ? 88 : 70) * S; ctx.font = `800 ${size}px Manrope, sans-serif`; ctx.textAlign = 'center';
    const lines = wrapLines(ctx, text, W * 0.8); const lineH = size * 1.12; const cy = H * (overlay.style === 'hook' ? 0.28 : 0.5) + (1 - intro) * 40 * S; const top = cy - lines.length * lineH / 2;
    lines.forEach((line, i) => { const w = ctx.measureText(line).width + size * 0.5; const y = top + i * lineH + lineH / 2; ctx.fillStyle = overlay.style === 'hook' ? '#D5FF00' : '#070707'; ctx.fillRect(W / 2 - w / 2 * intro, y - lineH / 2, w * intro, lineH); ctx.fillStyle = overlay.style === 'hook' ? '#070707' : '#D5FF00'; ctx.fillText(line, W / 2, y + size * 0.04); });
  } else if (overlay.style === 'title') {
    const size = 104 * S; ctx.font = `800 ${size}px Manrope, sans-serif`; ctx.textAlign = 'center';
    const lines = wrapLines(ctx, text, W * 0.84); const lineH = size * 0.98; const top = H * 0.45 - lines.length * lineH / 2 + (1 - intro) * 30 * S;
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30 * S; ctx.fillStyle = '#F7F7F2'; lines.forEach((line, i) => ctx.fillText(line, W / 2, top + i * lineH + lineH / 2));
    ctx.shadowBlur = 0; ctx.fillStyle = '#D5FF00'; const barW = W * 0.3 * intro; ctx.fillRect(W / 2 - barW / 2, top + lines.length * lineH + 18 * S, barW, 10 * S);
  } else if (overlay.style === 'lower_third') {
    const size = 42 * S; ctx.font = `700 ${size}px Manrope, sans-serif`; ctx.textAlign = 'left';
    const lines = wrapLines(ctx, text, W * 0.7); const lineH = size * 1.25; const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 70 * S; const boxH = lines.length * lineH + 36 * S;
    const x = 56 * S - (1 - intro) * 80 * S, y = H * 0.66;
    ctx.fillStyle = 'rgba(7,7,7,.88)'; ctx.fillRect(x, y, boxW, boxH); ctx.fillStyle = '#D5FF00'; ctx.fillRect(x, y, 12 * S, boxH);
    ctx.fillStyle = '#F7F7F2'; lines.forEach((line, i) => ctx.fillText(line, x + 40 * S, y + 18 * S + i * lineH + lineH / 2));
  } else if (overlay.style === 'cta') {
    const size = 58 * S; ctx.font = `800 ${size}px Manrope, sans-serif`; ctx.textAlign = 'center';
    const lines = wrapLines(ctx, text, W * 0.78); const lineH = size * 1.1; const boxH = lines.length * lineH + 60 * S; const y = H * 0.8 - boxH / 2 + (1 - intro) * 50 * S;
    ctx.fillStyle = '#D5FF00'; ctx.fillRect(W * 0.07, y, W * 0.86, boxH); ctx.fillStyle = '#070707'; lines.forEach((line, i) => ctx.fillText(line, W / 2, y + 30 * S + i * lineH + lineH / 2));
  }
  ctx.restore();
}
function drawCaption(ctx, W, H, time) {
  const cue = captionCues().find(c => time >= c.start && time < c.end); if (!cue) return;
  const S = Math.min(W, H) / 1080; const size = 62 * S; const lowerThird = plan.overlays.some(o => o.style === 'lower_third' && time >= o.at && time < o.at + o.dur);
  ctx.save(); ctx.font = `800 ${size}px Manrope, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const words = cue.words.map(w => ({ ...w, text: w.text.toUpperCase().replace(/[,.]$/, '') })); const space = ctx.measureText(' ').width; const maxWidth = W * 0.86;
  const lines = [[]]; let lineWidth = 0;
  for (const word of words) { const w = ctx.measureText(word.text).width; if (lines.at(-1).length && lineWidth + space + w > maxWidth) { lines.push([]); lineWidth = 0; } lines.at(-1).push({ ...word, width: w }); lineWidth += (lineWidth ? space : 0) + w; }
  const lineH = size * 1.18; const baseY = H * (lowerThird ? 0.58 : 0.74) - (lines.length - 1) * lineH / 2;
  lines.forEach((line, i) => {
    const width = line.reduce((sum, w, j) => sum + w.width + (j ? space : 0), 0); let x = W / 2 - width / 2; const y = baseY + i * lineH;
    for (const word of line) { const active = time >= word.start && time < Math.max(word.end, word.start + 0.2); ctx.lineWidth = 12 * S; ctx.strokeStyle = '#070707'; ctx.strokeText(word.text, x, y); ctx.fillStyle = active ? '#D5FF00' : '#F7F7F2'; ctx.fillText(word.text, x, y); x += word.width + space; }
  });
  ctx.restore();
}
function drawFrame(renderer, time) {
  const { canvas, ctx, layer, lctx } = renderer; const W = canvas.width, H = canvas.height;
  if (layer.width !== W || layer.height !== H) { layer.width = W; layer.height = H; lctx.fillStyle = '#000'; lctx.fillRect(0, 0, W, H); }
  const main = itemAt(plan.clips, time);
  if (main) { const record = byId(main.clip.src); if (record) drawLayer(lctx, record, mainVideo, main.clip, W, H, (time - main.start) / len(main.clip)); }
  else if (!plan.clips.length) { lctx.fillStyle = '#000'; lctx.fillRect(0, 0, W, H); }
  const broll = activeAt(plan.broll, time);
  ctx.drawImage(layer, 0, 0);
  if (broll) { const record = byId(broll.src); if (record) { if (!drawLayer(ctx, record, brollVideo, broll, W, H, (time - broll.at) / len(broll)) && renderer.brollLayer) ctx.drawImage(renderer.brollLayer, 0, 0); } }
  drawCaption(ctx, W, H, time);
  for (const overlay of plan.overlays) if (time >= overlay.at && time < overlay.at + overlay.dur) drawOverlay(ctx, W, H, overlay, time);
}
function fitStage() {
  const box = $('#playerBox'); const [a, b] = aspect(); const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
  let cw = w, ch = w * b / a; if (ch > h) { ch = h; cw = h * a / b; }
  const canvas = stage.canvas; canvas.style.width = `${Math.floor(cw)}px`; canvas.style.height = `${Math.floor(ch)}px`;
  const ratio = Math.min(window.devicePixelRatio || 1, 1280 / Math.max(cw, ch)); const pw = Math.round(cw * ratio), ph = Math.round(ch * ratio);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; dirtyFrames = 3; }
}

/* ---------- reprodução ---------- */
function syncElement(media, record, want, force) {
  if (media.dataset.src !== record.id) { media.dataset.src = record.id; media.src = record.url; return; }
  if (media.readyState < 1) return;
  if (force || Math.abs(media.currentTime - want) > (playing ? 0.35 : 0.05)) media.currentTime = clamp(want, 0, (media.duration || want) - 0.01);
  if (playing && media.paused) media.play().catch(() => {});
  if (!playing && !media.paused) media.pause();
}
const stop = media => { if (!media.paused) media.pause(); };
function speechAt(record, sourceTime) { return !!record?.transcript?.some(s => sourceTime >= s.start && sourceTime < s.end); }
function syncAll(force) {
  const total = totalDuration(); const time = total ? Math.min(t, total - 0.001) : 0;
  const main = itemAt(plan.clips, time); const mainRecord = main && byId(main.clip.src);
  if (mainRecord?.kind === 'video') syncElement(mainVideo, mainRecord, main.clip.in + (time - main.start), force); else stop(mainVideo);
  const broll = activeAt(plan.broll, time); const brollRecord = broll && byId(broll.src);
  if (brollRecord?.kind === 'video') syncElement(brollVideo, brollRecord, broll.in + (time - broll.at), force); else stop(brollVideo);
  const track = activeAt(plan.music, time); const trackRecord = track && byId(track.src);
  if (trackRecord && t < total) { syncElement(musicEl, trackRecord, track.in + (time - track.at), force); const talking = mainRecord && speechAt(mainRecord, main.clip.in + (time - main.start)); musicEl.volume = clamp(track.volume * (talking ? 0.3 : 1), 0, 1); }
  else stop(musicEl);
}
function play() { const total = totalDuration(); if (!total) return; if (t >= total - 0.02) t = 0; playing = true; lastTs = performance.now(); audioCtx?.resume(); syncAll(true); updateTransport(); }
function pause() { playing = false; stop(mainVideo); stop(brollVideo); stop(musicEl); updateTransport(); exporting?.onStop?.(); }
function seek(time) { t = clamp(time, 0, totalDuration()); syncAll(); dirtyFrames = 4; updatePlayhead(); }
function frame(now) {
  if (playing) {
    const dt = Math.min(0.1, (now - lastTs) / 1000); const main = itemAt(plan.clips, t); const record = main && byId(main.clip.src);
    if (record?.kind === 'video') {
      if (mainVideo.dataset.src === record.id && mainVideo.readyState >= 1 && !mainVideo.seeking) {
        if (mainVideo.ended) t = main.end;
        else if (!mainVideo.paused) { t = clamp(main.start + (mainVideo.currentTime - main.clip.in), main.start, main.end); if (t >= main.end - 0.01) t = main.end; }
      }
    } else t += dt;
    if (t >= totalDuration()) { t = totalDuration(); pause(); }
    syncAll(); updatePlayhead(); dirtyFrames = Math.max(dirtyFrames, 1);
  }
  const shown = Math.min(t, Math.max(0, totalDuration() - 0.001));
  if (dirtyFrames > 0 && $('#editor').classList.contains('active')) { drawFrame(stage, shown); dirtyFrames--; }
  if (exporting && playing) { drawFrame(exporting.renderer, shown); exporting.progress(shown / totalDuration()); }
  lastTs = now; requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function updateTransport() { $('#tcNow').textContent = tc(t); $('#tcTotal').textContent = tc(totalDuration()); const b = $('#btnPlay'); b.textContent = playing ? '❚❚' : '▶'; b.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir'); }
function updatePlayhead() { $('#playhead').style.left = `${PAD + t * pxPerSec}px`; updateTransport(); }

/* ---------- editor: render ---------- */
function renderEditor() { planChanged(); renderMedia(); renderTimeline(); renderInspector(); renderPreviewState(); fitStage(); syncAll(); updatePlayhead(); }
function renderPreviewState() {
  const box = $('#previewState'); const title = el('strong'); const text = el('span'); const has = plan.clips.length > 0;
  title.textContent = has ? `EDIÇÃO POR IA · ${MODEL_LABEL[plan.model] || plan.model || 'MANUAL'}` : 'SEM EDIÇÃO';
  text.textContent = has ? `${plan.clips.length} cortes · ${plan.broll.length} b-roll · ${plan.overlays.length} textos · legendas ${plan.captions ? 'ligadas' : 'desligadas'} · ${chipValue('format')} · ${tc(totalDuration()).slice(0, 8)}` : 'Crie um projeto em Novo projeto para a IA editar.';
  box.replaceChildren(title, text);
  const msg = $('#stageMsg'); msg.hidden = has; msg.innerHTML = has ? '' : '<b>POKE CUT</b>Volte em Novo projeto, adicione material e clique em Criar edição com IA.';
}
function renderMedia() {
  const list = $('#mediaList'); list.replaceChildren(); $('#mediaCount').textContent = `+ ${files.length}`;
  if (!files.length) { const empty = el('div', 'media-empty'); empty.textContent = 'Nenhum material ainda.'; list.append(empty); return; }
  const activeSrc = findEntity(selectedId)?.item.src;
  for (const record of files) {
    const item = el('div', `media-item ${record.id === activeSrc ? 'active' : ''}`);
    const thumb = el('div', 'thumb'); if (record.thumb) thumb.style.backgroundImage = `url("${record.thumb}")`; else thumb.textContent = record.kind === 'audio' ? '♪' : '▶';
    const copy = el('div'); const title = el('strong'); title.textContent = record.file.name; const meta = el('small');
    meta.textContent = `${kindName[record.kind]}${record.duration ? ` / ${shortTime(record.duration)}` : ''}${record.speech ? ' / FALA' : ''}${record.playable ? '' : ' / NÃO TOCA'}`;
    copy.append(title, meta);
    const add = el('button', 'media-add'); add.type = 'button'; add.textContent = '+'; add.title = record.kind === 'audio' ? 'Usar como trilha' : 'Adicionar ao fim da sequência'; add.disabled = !record.playable;
    add.addEventListener('click', event => { event.stopPropagation(); addToTimeline(record.id); });
    item.addEventListener('click', () => { const use = layout(plan.clips).find(i => i.clip.src === record.id); if (use) { selectedId = use.clip.id; rightTab = 'edit'; seek(use.start); renderEditor(); } });
    item.append(thumb, copy, add); list.append(item);
  }
}
function addToTimeline(id) {
  const record = byId(id); if (!record?.playable) return; commit();
  if (record.kind === 'audio') { const item = { id: newId('m'), src: id, in: 0, out: Math.min(record.duration, totalDuration() || record.duration), at: 0, volume: 0.6 }; plan.music.push(item); selectedId = item.id; }
  else { const item = { id: newId('c'), src: id, in: 0, out: record.kind === 'image' ? IMAGE_SECONDS : record.duration, cx: 0.5, cy: 0.5, zoom: 1, reason: 'Adicionado manualmente' }; plan.clips.push(item); selectedId = item.id; t = layout(plan.clips).at(-1).start; }
  rightTab = 'edit'; renderEditor();
}
function positionOf(track, item) { if (track === 'clips') return layout(plan.clips).find(i => i.clip === item).start; return item.at; }
function clipNode(track, item, px, extraClass, label) {
  const node = el('div', `clip ${extraClass} ${item.id === selectedId ? 'selected' : ''}`); node.dataset.id = item.id;
  node.style.left = `${PAD + positionOf(track, item) * px}px`; node.style.width = `${Math.max(4, len(item) * px)}px`;
  const text = el('span', 'clip-label'); text.textContent = label; node.append(el('i', 'handle l'), text, el('i', 'handle r')); return node;
}
function renderTimeline(fixedPx) {
  const area = $('#trackArea'); const total = totalDuration(); const width = area.clientWidth;
  pxPerSec = fixedPx || (total ? Math.max(1, (width - PAD * 2) / total) : 10); const px = pxPerSec;
  const ruler = $('#ruler'); ruler.replaceChildren(); const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find(s => s * px >= 64) || 600;
  for (let s = 0; s <= total + 1e-6 && PAD + s * px < width; s += step) { const tick = el('div', 'tick'); tick.style.left = `${PAD + s * px}px`; tick.textContent = shortTime(s).replace(/\.0$/, ''); ruler.append(tick); }
  const rows = { text: $('#rowText'), broll: $('#rowBroll'), video: $('#rowVideo'), caption: $('#rowCaption'), music: $('#rowMusic') }; Object.values(rows).forEach(r => r.replaceChildren());
  for (const overlay of plan.overlays) rows.text.append(clipNode('overlays', overlay, px, 'text', overlay.text));
  for (const b of plan.broll) { const record = byId(b.src); const node = clipNode('broll', b, px, 'broll', record?.file.name || '—'); if (record?.thumb) node.style.backgroundImage = `url("${record.thumb}")`; rows.broll.append(node); }
  for (const item of layout(plan.clips)) { const record = byId(item.clip.src); const node = clipNode('clips', item.clip, px, '', `${record?.file.name || '—'} · ${shortTime(len(item.clip))}`); if (record?.thumb) node.style.backgroundImage = `url("${record.thumb}")`; rows.video.append(node); }
  for (const cue of captionCues()) { const node = el('div', 'clip caption'); node.style.left = `${PAD + cue.start * px}px`; node.style.width = `${Math.max(2, (cue.end - cue.start) * px - 1)}px`; node.textContent = cue.text; rows.caption.append(node); }
  for (const m of plan.music) rows.music.append(clipNode('music', m, px, 'music', `♪ ${byId(m.src)?.file.name || '—'}`));
  const target = plan.settings?.duration;
  $('#tlInfo').textContent = `${tc(total).slice(0, 8)} / ${FPS} FPS${target ? ` · ALVO ${tc(target).slice(0, 8)}` : ''}`;
  $('#btnUndo').disabled = !undoStack.length; $('#btnRedo').disabled = !redoStack.length; $('#btnDelete').disabled = !selectedId; $('#btnExport').disabled = !plan.clips.length;
  updatePlayhead();
}

/* ---------- editor: interação na timeline ---------- */
const trackArea = $('#trackArea'), dropMarker = $('#dropMarker');
const pointerX = event => event.clientX - trackArea.getBoundingClientRect().left;
trackArea.addEventListener('pointerdown', event => {
  if (event.button !== 0) return; trackArea.setPointerCapture(event.pointerId);
  const node = event.target.closest('.clip[data-id]');
  if (!node) { drag = { mode: 'scrub' }; seek((pointerX(event) - PAD) / pxPerSec); return; }
  const entity = findEntity(node.dataset.id); if (!entity) return;
  selectedId = entity.item.id; rightTab = 'edit';
  const mode = event.target.classList.contains('l') ? 'trimL' : event.target.classList.contains('r') ? 'trimR' : 'move';
  drag = { ...entity, mode, startX: event.clientX, orig: { ...entity.item }, px: pxPerSec, before: snapshot(), moved: false, index: null, node };
  trackArea.querySelectorAll('.clip.selected').forEach(n => n.classList.remove('selected')); node.classList.add('selected'); renderInspector(); renderMedia();
});
trackArea.addEventListener('pointermove', event => {
  if (!drag) return; if (drag.mode === 'scrub') { seek((pointerX(event) - PAD) / pxPerSec); return; }
  const delta = event.clientX - drag.startX; if (Math.abs(delta) > 3) drag.moved = true; if (!drag.moved) return;
  const d = delta / drag.px, { item, orig, track } = drag; const record = byId(item.src); const total = totalDuration();
  if (track === 'clips' && drag.mode === 'move') {
    drag.node.classList.add('dragging'); drag.node.style.transform = `translateX(${delta}px)`;
    const items = layout(plan.clips); drag.index = items.filter(i => PAD + (i.start + len(i.clip) / 2) * drag.px < pointerX(event)).length;
    const at = drag.index < items.length ? items[drag.index].start : total; Object.assign(dropMarker.style, { left: `${PAD + at * drag.px - 1}px`, top: `${22 + 34 + 34}px`, height: '60px' }); dropMarker.hidden = false; return;
  }
  if (track === 'overlays') {
    if (drag.mode === 'move') item.at = clamp(orig.at + d, 0, Math.max(0, total - item.dur));
    if (drag.mode === 'trimL') { const at = clamp(orig.at + d, 0, orig.at + orig.dur - 0.3); item.dur = orig.dur - (at - orig.at); item.at = at; }
    if (drag.mode === 'trimR') item.dur = clamp(orig.dur + d, 0.3, total - item.at);
  } else if (track === 'clips') {
    if (record.kind === 'image') { if (drag.mode === 'trimR') item.out = clamp(orig.out + d, 0.3, 60); if (drag.mode === 'trimL') item.out = clamp(orig.out - d, 0.3, 60); }
    else { if (drag.mode === 'trimL') item.in = clamp(orig.in + d, 0, item.out - 0.2); if (drag.mode === 'trimR') item.out = clamp(orig.out + d, item.in + 0.2, maxOut(record)); }
  } else {
    if (drag.mode === 'move') item.at = clamp(orig.at + d, 0, Math.max(0, total - len(item)));
    if (drag.mode === 'trimL') { const shift = clamp(d, -Math.min(orig.in, orig.at), len(orig) - 0.2); item.in = orig.in + shift; item.at = orig.at + shift; }
    if (drag.mode === 'trimR') item.out = clamp(orig.out + d, item.in + 0.2, Math.min(maxOut(record), item.in + total - item.at));
  }
  planChanged(); renderTimeline(drag.px); syncAll(); renderInspector();
});
function endDrag(event) {
  if (!drag) return; const current = drag; drag = null; dropMarker.hidden = true;
  if (current.mode === 'scrub') return;
  if (current.track === 'clips' && current.mode === 'move') {
    if (current.moved && current.index !== null) { const from = plan.clips.indexOf(current.item); let to = current.index; if (to > from) to--; if (to !== from) { commit(current.before); plan.clips.splice(from, 1); plan.clips.splice(to, 0, current.item); t = layout(plan.clips).find(i => i.clip === current.item).start; } }
    else if (!current.moved && event) t = clamp((pointerX(event) - PAD) / pxPerSec, 0, totalDuration());
  } else if (current.moved) commit(current.before);
  else if (event) t = clamp((pointerX(event) - PAD) / pxPerSec, 0, totalDuration());
  t = Math.min(t, totalDuration()); renderEditor();
}
trackArea.addEventListener('pointerup', endDrag); trackArea.addEventListener('pointercancel', () => endDrag());
function splitAtPlayhead() {
  const entity = findEntity(selectedId);
  if (entity && entity.track !== 'clips') {
    const { item, list, track } = entity; const start = item.at; if (t <= start + 0.1 || t >= start + len(item) - 0.1) return; commit();
    const offset = t - start; const second = { ...item, id: newId(track[0]) };
    if (track === 'overlays') { second.at = t; second.dur = item.dur - offset; item.dur = offset; } else { second.at = t; second.in = item.in + offset; item.out = item.in + offset; }
    list.splice(list.indexOf(item) + 1, 0, second); selectedId = second.id; renderEditor(); return;
  }
  const hit = itemAt(plan.clips, t); if (!hit) return; const record = byId(hit.clip.src); const cut = record.kind === 'image' ? t - hit.start : hit.clip.in + (t - hit.start);
  if (cut - hit.clip.in < 0.1 || hit.clip.out - cut < 0.1) return; commit();
  const second = { ...hit.clip, id: newId('c'), in: record.kind === 'image' ? 0 : cut, out: record.kind === 'image' ? hit.clip.out - cut : hit.clip.out };
  hit.clip.out = cut; plan.clips.splice(plan.clips.indexOf(hit.clip) + 1, 0, second); selectedId = second.id; renderEditor();
}
function removeSelected() { const entity = findEntity(selectedId); if (!entity) return; commit(); entity.list.splice(entity.list.indexOf(entity.item), 1); selectedId = null; t = Math.min(t, totalDuration()); renderEditor(); }
function moveClip(direction) { const entity = findEntity(selectedId); if (entity?.track !== 'clips') return; const from = plan.clips.indexOf(entity.item), to = from + direction; if (to < 0 || to >= plan.clips.length) return; commit(); plan.clips.splice(from, 1); plan.clips.splice(to, 0, entity.item); t = layout(plan.clips).find(i => i.clip === entity.item).start; renderEditor(); }

/* ---------- editor: painel direito ---------- */
document.querySelectorAll('.tabs-head .tab').forEach(tab => tab.addEventListener('click', () => { rightTab = tab.dataset.tab; renderInspector(); }));
function renderInspector() {
  document.querySelectorAll('.tabs-head .tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === rightTab));
  $('#aiTag').textContent = getKey() ? (aiBusy ? 'EDITANDO…' : 'ONLINE') : 'CONECTAR';
  const entity = findEntity(selectedId); $('#inspectorTag').textContent = entity ? { clips: 'CORTE', broll: 'B-ROLL', overlays: 'TEXTO', music: 'TRILHA' }[entity.track] : 'PROJETO';
  if (rightTab === 'ai') return renderAiPanel();
  const box = $('#inspector');
  if (!entity) {
    box.innerHTML = `<div class="section-label">PROJETO</div><div class="insp-title">${plan.clips.length ? 'Edição atual' : 'Sem edição'}</div><div class="insp-sub">${plan.clips.length} cortes · ${chipValue('format')} · ${tc(totalDuration()).slice(0, 8)}</div>
      <div class="insp-field">LEGENDAS<div class="chips"><button class="chip ${plan.captions ? 'active' : ''}" data-captions="1">LIGADAS</button><button class="chip ${plan.captions ? '' : 'active'}" data-captions="0">DESLIGADAS</button></div></div>
      <div class="insp-field">NOVO TEXTO NO CURSOR<div class="chips">${OVERLAY_STYLES.map(s => `<button class="chip" data-add-overlay="${s}">${STYLE_LABEL[s]}</button>`).join('')}</div></div>
      <div class="insp-note"><strong>COMO EDITAR</strong><span class="kbd">ESPAÇO</span>play / pausa<br><span class="kbd">CLIQUE</span>seleciona ou move o cursor<br><span class="kbd">ARRASTE</span>reordena cortes e move textos<br><span class="kbd">BORDAS</span>cortam início e fim<br><span class="kbd">S</span>divide · <span class="kbd">DEL</span>remove · <span class="kbd">⌘Z</span>desfaz</div>`;
    return;
  }
  const { track, item, list } = entity; const record = item.src ? byId(item.src) : null; const num = v => (+v).toFixed(1);
  let html = `<div class="section-label">${{ clips: 'CORTE DA SEQUÊNCIA', broll: 'B-ROLL', overlays: 'TEXTO / MOTION', music: 'TRILHA' }[track]}</div>`;
  if (track === 'overlays') {
    html += `<label class="insp-field">TEXTO<textarea data-field="text">${esc(item.text)}</textarea></label>
      <div class="insp-field">ESTILO<div class="chips">${OVERLAY_STYLES.map(s => `<button class="chip ${item.style === s ? 'active' : ''}" data-style="${s}">${STYLE_LABEL[s]}</button>`).join('')}</div></div>
      <div class="insp-grid"><label>INÍCIO (s)<input data-field="at" type="number" step="0.1" value="${num(item.at)}"></label><label>DURAÇÃO (s)<input data-field="dur" type="number" step="0.1" value="${num(item.dur)}"></label></div>`;
  } else {
    html += `<div class="insp-title">${esc(record?.file.name)}</div><div class="insp-sub">${kindName[record?.kind]}${record?.duration ? ` · fonte ${shortTime(record.duration)}` : ''}${record?.width ? ` · ${record.width}×${record.height}` : ''}</div>`;
    if (item.reason) html += `<div class="insp-note"><strong>POR QUE A IA ESCOLHEU</strong>${esc(item.reason)}</div>`;
    const isImage = record?.kind === 'image';
    html += `<div class="insp-grid"><label>ENTRADA (s)<input data-field="in" type="number" step="0.1" value="${num(item.in)}" ${isImage ? 'disabled' : ''}></label><label>SAÍDA (s)<input data-field="out" type="number" step="0.1" value="${num(item.out)}"></label>${track !== 'clips' ? `<label>NA TIMELINE (s)<input data-field="at" type="number" step="0.1" value="${num(item.at)}"></label>` : ''}<label>DURAÇÃO<input disabled value="${num(len(item))} s"></label></div>`;
    if (track === 'music') html += `<label class="insp-field">VOLUME <input type="range" min="0" max="1" step="0.05" data-field="volume" value="${item.volume}"></label>`;
    else html += `<div class="insp-note"><strong>ENQUADRAMENTO</strong></div><label class="insp-field">HORIZONTAL<input type="range" min="0" max="1" step="0.01" data-field="cx" value="${item.cx}"></label><label class="insp-field">VERTICAL<input type="range" min="0" max="1" step="0.01" data-field="cy" value="${item.cy}"></label><label class="insp-field">ZOOM<input type="range" min="1" max="2.5" step="0.01" data-field="zoom" value="${item.zoom}"></label>`;
  }
  const index = list.indexOf(item);
  html += `<div class="insp-actions">${track === 'clips' ? `<button data-act="left" ${index === 0 ? 'disabled' : ''}>← ANTES</button><button data-act="right" ${index === list.length - 1 ? 'disabled' : ''}>DEPOIS →</button>` : ''}<button data-act="split">DIVIDIR (S)</button><button data-act="remove" class="danger">REMOVER</button></div>`;
  box.innerHTML = html;
}
let sliderBefore = null;
$('#inspector').addEventListener('pointerdown', event => { if (event.target.matches('input[type=range]')) sliderBefore = snapshot(); });
$('#inspector').addEventListener('input', event => {
  const field = event.target.dataset.field; const entity = findEntity(selectedId); if (!field || !entity || event.target.type !== 'range') return;
  entity.item[field] = +event.target.value; planChanged(); syncAll();
});
$('#inspector').addEventListener('change', event => {
  const field = event.target.dataset.field; const entity = findEntity(selectedId); if (!field || !entity) return; const { item, track } = entity;
  if (event.target.type === 'range') { if (sliderBefore) commit(sliderBefore); sliderBefore = null; renderTimeline(); return; }
  commit(); const value = event.target.value; const record = item.src ? byId(item.src) : null; const total = totalDuration();
  if (field === 'text') item.text = value.trim() || item.text;
  else { const n = +value; if (!Number.isFinite(n)) return renderInspector();
    if (field === 'at') item.at = clamp(n, 0, Math.max(0, total - len(item)));
    if (field === 'dur') item.dur = clamp(n, 0.3, total - item.at);
    if (field === 'in') item.in = clamp(n, 0, item.out - 0.2);
    if (field === 'out') item.out = record?.kind === 'image' && track === 'clips' ? clamp(n, 0.3, 60) : clamp(n, item.in + 0.2, maxOut(record)); }
  renderEditor();
});
$('#inspector').addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target) return; const d = target.dataset;
  if (d.act === 'left') moveClip(-1); if (d.act === 'right') moveClip(1); if (d.act === 'split') splitAtPlayhead(); if (d.act === 'remove') removeSelected();
  if (d.captions) { commit(); plan.captions = d.captions === '1'; renderEditor(); }
  if (d.style) { const entity = findEntity(selectedId); if (entity) { commit(); entity.item.style = d.style; renderEditor(); } }
  if (d.addOverlay) { const total = totalDuration(); if (!total) return; commit(); const item = { id: newId('o'), text: 'SEU TEXTO AQUI', at: Math.min(t, Math.max(0, total - 2)), dur: Math.min(2.5, total), style: d.addOverlay }; plan.overlays.push(item); selectedId = item.id; renderEditor(); }
  if (d.aiApply !== undefined) applyAiInstruction();
  if (d.aiRedo !== undefined) { $('#aiInstruction') && ($('#aiInstruction').value = 'Refaça a edição do zero com outra abordagem criativa.'); applyAiInstruction(); }
  if (d.seek !== undefined) { const item = layout(plan.clips).find(i => i.clip.id === d.seek); if (item) { selectedId = item.clip.id; seek(item.start); renderEditor(); } }
});
function renderAiPanel() {
  const box = $('#inspector');
  if (!getKey()) { box.innerHTML = '<div class="section-label">IA / CLAUDE</div><div class="insp-title">Conecte a IA</div><div class="key-row"></div>'; renderKeyBox(box.querySelector('.key-row')); return; }
  const reasons = layout(plan.clips).map((i, n) => `<li data-seek="${i.clip.id}"><b>${String(n + 1).padStart(2, '0')} · ${shortTime(i.start)}</b> — ${esc(i.clip.reason || byId(i.clip.src)?.file.name || '')}</li>`).join('');
  box.innerHTML = `<div class="section-label">O QUE A IA FEZ</div>
    <p class="ai-summary">${plan.summary ? esc(plan.summary) : 'Ainda não há edição da IA neste projeto.'}</p>
    ${reasons ? `<ul class="reason-list">${reasons}</ul>` : ''}
    <div class="insp-note"><strong>O QUE MUDAMOS?</strong>Peça em português. A IA revê o material e devolve a edição inteira atualizada (você pode desfazer).</div>
    <textarea class="ai-input" id="aiInstruction" placeholder="Ex.: Comece pela fala mais emocionante. Deixe com 20 segundos. Menos textos, mais b-roll.">${esc($('#aiInstruction')?.value || '')}</textarea>
    <button class="ai-send" data-ai-apply ${aiBusy || !files.length ? 'disabled' : ''}>${aiBusy ? 'A IA ESTÁ EDITANDO…' : 'APLICAR COM IA →'}</button>
    <p class="ai-status" id="aiStatus"></p>
    <div class="insp-actions"><button data-ai-redo ${aiBusy || !files.length ? 'disabled' : ''}>REFAZER DO ZERO</button><button data-key="remove">TROCAR CHAVE</button></div>
    <div class="ai-log">${aiLog.map(entry => `<div><span>${esc(entry.title)}</span><p>${esc(entry.detail)}${entry.usage ? `\n${usageText(entry.usage)}` : ''}</p></div>`).join('')}</div>`;
}
async function applyAiInstruction() {
  const instruction = $('#aiInstruction')?.value.trim(); if (!instruction || aiBusy) return;
  if (!files.some(r => r.frames?.length)) { $('#aiStatus').textContent = 'Crie a edição em Novo projeto primeiro para a IA assistir o material.'; return; }
  aiBusy = true; pause(); renderInspector(); const settings = { ...(plan.settings || settingsSnapshot()), model: chipValue('model') };
  const status = text => { const node = $('#aiStatus'); if (node) node.textContent = text; };
  try {
    const content = [{ type: 'text', text: projectHeader(settings) }, ...materialContent(), { type: 'text', text: `PLANO ATUAL (JSON):\n${planForPrompt()}\n\nPEDIDO DO USUÁRIO: ${instruction}\n\nDevolva o plano completo já com o pedido aplicado. Mantenha o que não foi pedido para mudar, a menos que o pedido seja refazer.` }];
    const result = await callClaude(content, { model: settings.model, onStatus: status });
    const before = snapshot(); const next = normalizePlan(result.raw, { ...settings, captions: 'ai' });
    commit(before); plan = { ...next, model: result.model, settings };
    aiLog.unshift({ title: `PEDIDO: ${instruction.slice(0, 60)}${instruction.length > 60 ? '…' : ''}`, detail: next.summary, usage: result.usage });
    selectedId = null; t = 0; $('#aiInstruction').value = '';
  } catch (error) { aiLog.unshift({ title: 'A IA NÃO APLICOU', detail: error.message }); }
  finally { aiBusy = false; renderEditor(); }
}

/* ---------- atalhos ---------- */
$('#btnPlay').addEventListener('click', () => playing ? pause() : play());
$('#btnStart').addEventListener('click', () => seek(0));
$('#btnEnd').addEventListener('click', () => { pause(); seek(totalDuration()); });
$('#btnUndo').addEventListener('click', undo); $('#btnRedo').addEventListener('click', redo);
$('#btnSplit').addEventListener('click', splitAtPlayhead); $('#btnDelete').addEventListener('click', removeSelected);
document.addEventListener('keydown', event => {
  if (!$('#editor').classList.contains('active') || exporting || event.target.closest('input, textarea')) return; const key = event.key;
  if (key === ' ') { event.preventDefault(); playing ? pause() : play(); }
  else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if (event.metaKey || event.ctrlKey || event.altKey) return;
  else if (key === 's' || key === 'S') splitAtPlayhead();
  else if ((key === 'Delete' || key === 'Backspace') && selectedId) { event.preventDefault(); removeSelected(); }
  else if (key === 'ArrowLeft' || key === 'ArrowRight') { event.preventDefault(); pause(); seek(t + (key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 1 / FPS)); }
  else if (key === 'Escape') { selectedId = null; renderEditor(); }
});
window.addEventListener('resize', () => { if ($('#editor').classList.contains('active')) { fitStage(); renderTimeline(); } });

/* ---------- exportação ---------- */
let audioCtx = null, recordDestination = null;
function ensureAudioGraph() {
  if (audioCtx) return; audioCtx = new (window.AudioContext || window.webkitAudioContext)(); recordDestination = audioCtx.createMediaStreamDestination();
  for (const media of [mainVideo, musicEl]) { const source = audioCtx.createMediaElementSource(media); source.connect(audioCtx.destination); source.connect(recordDestination); }
}
const modal = $('#exportModal');
$('#btnExport').addEventListener('click', () => { pause(); modal.hidden = false; $('#exportStatus').textContent = `Duração ${tc(totalDuration()).slice(0, 8)} · formato ${chipValue('format')}.`; $('#exportBar').style.width = '0'; $('#exportDownload').hidden = true; $('#exportStart').disabled = false; $('#exportStart').textContent = 'RENDERIZAR →'; });
$('#exportClose').addEventListener('click', () => { if (exporting) { exporting.cancelled = true; pause(); } modal.hidden = true; });
$('#exportStart').addEventListener('click', async () => {
  if (exporting || !plan.clips.length) return; const statusNode = $('#exportStatus'), button = $('#exportStart');
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => window.MediaRecorder?.isTypeSupported(type));
  if (!mime) { statusNode.textContent = 'Este navegador não consegue gravar vídeo. Use Chrome, Edge ou Safari atualizados.'; return; }
  ensureAudioGraph(); await audioCtx.resume();
  const long = +chipValue('exportRes') === 720 ? 1280 : 1920; const [W, H] = outputSize(long);
  const canvas = el('canvas'); canvas.width = W; canvas.height = H; const renderer = makeRenderer(canvas);
  const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...recordDestination.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: long >= 1920 ? 12_000_000 : 6_000_000, audioBitsPerSecond: 192_000 }); const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  button.disabled = true; button.textContent = 'RENDERIZANDO…'; $('#exportDownload').hidden = true;
  selectedId = null; t = 0; syncAll(true);
  for (let i = 0; i < 40 && mainVideo.readyState < 2 && byId(plan.clips[0].src)?.kind === 'video'; i++) await sleep(50);
  drawFrame(renderer, 0);
  const finished = new Promise(resolve => {
    exporting = { renderer, cancelled: false, progress: fraction => { $('#exportBar').style.width = `${Math.round(fraction * 100)}%`; statusNode.textContent = `Renderizando ${tc(fraction * totalDuration()).slice(0, 8)} de ${tc(totalDuration()).slice(0, 8)} · ${W}×${H} · mantenha a aba visível`; }, onStop: () => resolve() };
  });
  recorder.start(1000); play(); await finished;
  const cancelled = exporting.cancelled; exporting = null;
  await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
  button.disabled = false; button.textContent = 'RENDERIZAR DE NOVO →';
  if (cancelled) { statusNode.textContent = 'Exportação cancelada.'; return; }
  const extension = mime.startsWith('video/mp4') ? 'mp4' : 'webm'; const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const link = $('#exportDownload'); if (link.href) URL.revokeObjectURL(link.href); link.href = URL.createObjectURL(blob); link.download = `poke-cut-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${extension}`; link.hidden = false;
  $('#exportBar').style.width = '100%'; statusNode.textContent = `Pronto: ${formatBytes(blob.size)} · ${extension.toUpperCase()} ${W}×${H}${extension === 'webm' ? ' · este navegador grava em WebM; o Instagram aceita, mas para MP4 use Chrome atualizado ou Safari' : ''}`;
});

/* ---------- inicialização ---------- */
renderSteps();
document.fonts?.load('800 40px Manrope'); document.fonts?.load('700 40px Manrope');
