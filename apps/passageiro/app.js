// PWA do Passageiro — roteia por query string (goal 03):
//   ?stop=CODE     tela do ponto (RF-P2/P3)   ← destino do QR /p/{code}
//   ?route=ID      detalhe da linha (RF-P4)
//   ?vehicle=CODE  visão embarcada (RF-P9)    ← destino do QR /v/{code}
//   (sem params)   início: favoritos (RF-P8)
import * as api from './api.js';
import { createMap, stopMarker, vehicleMarker, drawTrajectory } from './map.js';

const app = document.getElementById('app');
const offBanner = document.getElementById('offline-banner');
const params = new URLSearchParams(location.search);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let lastGoodAt = null;
function setOffline(off) {
  offBanner.classList.toggle('show', off);
  if (off && lastGoodAt) offBanner.textContent =
    `Sem conexão — mostrando dados de ${lastGoodAt.toLocaleTimeString('pt-BR')}`;
}

const etaHtml = (arr) => arr.position.stale
  ? '<span class="stale">⚠ sinal perdido</span>'
  : `<span class="ok">${esc(arr.eta_text)}</span>`;

const featuresHtml = (f) => [
  f?.acessivel ? '<span class="feature">♿ acessível</span>' : '',
  f?.ar_condicionado ? '<span class="feature">❄ ar-condicionado</span>' : '',
].join('');

const alertsHtml = (alerts) => (alerts ?? []).map(a =>
  `<div class="alert" role="alert"><strong>${esc(a.title)}</strong><br>${esc(a.message ?? '')}</div>`).join('');

// ================================================================ tela do ponto
async function stopView(code) {
  let map = null, markers = new Map(), stopPin = false, unsub = null;

  async function refresh() {
    const r = await api.liveStop(code).catch(() => ({ ok: false, status: 0 }));
    if (!r.ok) {
      if (r.status === 404) { app.innerHTML = '<p class="empty">Ponto não encontrado.</p>'; return; }
      setOffline(true); return;
    }
    setOffline(false);
    lastGoodAt = new Date();
    render(r.data);
  }

  function render(d) {
    const fav = api.isFavorite(code);
    let html = `
      <h2>📍 ${esc(d.stop.name)}
        <button class="fav-btn" id="fav" aria-pressed="${fav}"
          aria-label="${fav ? 'Remover dos favoritos' : 'Salvar nos favoritos'}">${fav ? '★' : '☆'}</button>
      </h2>
      <p class="sub">Próximos ônibus neste ponto</p>
      ${alertsHtml(d.alerts)}`;

    const arrivals = (d.lines ?? []).flatMap(l => l.arrivals.map(a => ({ ...a, route: l.route })));
    if (!arrivals.length) html += '<p class="empty">Nenhum ônibus a caminho neste momento.</p>';
    for (const a of arrivals) {
      html += `
      <div class="card tap" role="link" tabindex="0" data-route="${esc(a.route.short_name)}"
           aria-label="Linha ${esc(a.route.short_name)} sentido ${esc(a.headsign)}: ${a.position.stale ? 'sinal perdido' : esc(a.eta_text)}">
        <div class="line-head">
          <span class="badge" style="background:${esc(a.route.color ?? '#0b4f9e')}">${esc(a.route.short_name)}</span>
          <span class="headsign">→ ${esc(a.headsign)}</span>
        </div>
        <div class="eta">${etaHtml(a)}</div>
        <div class="meta">veículo ${esc(a.vehicle.code)} · ${(a.distance_m / 1000).toFixed(1)} km
          ${featuresHtml(a.vehicle.features)}</div>
      </div>`;
    }
    html += '<div id="map" role="application" aria-label="Mapa com a posição dos ônibus"></div>';
    html += `<div class="updated">Atualizado às ${new Date().toLocaleTimeString('pt-BR')}</div>`;
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');

    document.getElementById('fav').onclick = () => {
      api.toggleFavorite(d.stop); render(d);
    };
    app.querySelectorAll('[data-route]').forEach(el => {
      const go = () => { location.search = `?route=${el.dataset.route}&from=${code}`; };
      el.onclick = go;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });

    // mapa
    map = createMap(document.getElementById('map'));
    map.setView([d.stop.lat, d.stop.lng], 14);
    stopMarker(map, d.stop, { highlight: true });
    markers = new Map();
    for (const a of arrivals) {
      const m = vehicleMarker(map, a.route.color);
      m.update(a.position);
      markers.set(a.vehicle.code, m);
    }
  }

  await refresh();
  unsub = api.subscribe({
    channel: `stop:${code}`,
    refresh,
    onEvent(msg) {
      // movimento em tempo real: atualiza só o marcador (refresh completo a cada 30s)
      const m = markers.get(msg.vehicle?.code);
      if (m && msg.position) m.update(msg.position);
      else refresh(); // veículo novo no ponto → redesenha
    },
  });
  return unsub;
}

// ================================================================ detalhe da linha
async function routeView(id, fromStop) {
  async function refresh() {
    const r = await api.liveRoute(id).catch(() => ({ ok: false, status: 0 }));
    if (!r.ok) {
      if (r.status === 404) { app.innerHTML = '<p class="empty">Linha não encontrada.</p>'; return; }
      setOffline(true); return;
    }
    setOffline(false); lastGoodAt = new Date();
    render(r.data);
  }

  let map = null, markers = new Map();
  function render(d) {
    let html = `
      <h2><span class="badge" style="background:${esc(d.route.color ?? '#0b4f9e')}">${esc(d.route.short_name)}</span>
        ${esc(d.route.long_name ?? '')}</h2>
      ${fromStop ? `<p class="sub"><a class="link" href="?stop=${encodeURIComponent(fromStop)}">‹ voltar ao ponto</a></p>` : ''}
      ${alertsHtml(d.alerts)}
      <div id="map" role="application" aria-label="Mapa da linha com os ônibus"></div>`;

    for (const dir of d.directions ?? []) {
      html += `<div class="card"><strong>→ ${esc(dir.headsign)}</strong>`;
      for (const s of dir.stops) {
        html += `<div class="stop-item">
          <a class="link" href="?stop=${encodeURIComponent(s.code)}">${esc(s.name)}</a>
          <span class="stop-eta meta">${s.scheduled_time ? esc(s.scheduled_time.slice(0, 5)) : ''}</span>
        </div>`;
      }
      html += '</div>';
    }
    html += `<div class="updated">Atualizado às ${new Date().toLocaleTimeString('pt-BR')} ·
      ${(d.vehicles ?? []).length} veículo(s) ativo(s)</div>`;
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');

    map = createMap(document.getElementById('map'));
    const allStops = d.directions?.[0]?.stops ?? [];
    if (allStops.length) {
      const line = drawTrajectory(map, allStops, d.route.color);
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
      for (const s of allStops) stopMarker(map, s);
    } else map.setView([-10.9472, -37.0731], 12);
    markers = new Map();
    for (const v of d.vehicles ?? []) {
      const m = vehicleMarker(map, d.route.color);
      m.update(v.position);
      markers.set(v.vehicle.code, m);
    }
  }

  await refresh();
  return api.subscribe({
    channel: `route:${id}`,
    refresh,
    onEvent(msg) {
      const m = markers.get(msg.vehicle?.code);
      if (m && msg.position) m.update(msg.position);
      else refresh();
    },
  });
}

// ================================================================ visão embarcada
async function vehicleView(code) {
  async function refresh() {
    const r = await api.liveVehicle(code).catch(() => ({ ok: false, status: 0 }));
    if (!r.ok) {
      if (r.status === 404) { app.innerHTML = '<p class="empty">Veículo não encontrado.</p>'; return; }
      setOffline(true); return;
    }
    setOffline(false); lastGoodAt = new Date();
    render(r.data);
  }

  function render(d) {
    let html = `<h2>🚌 Veículo ${esc(d.vehicle.code)}</h2>`;
    if (d.route) {
      html += `<p class="sub">
        <span class="badge" style="background:${esc(d.route.color ?? '#0b4f9e')}">${esc(d.route.short_name)}</span>
        → ${esc(d.trip?.headsign ?? '')} ${featuresHtml(d.vehicle.features)}</p>`;
    } else {
      html += '<p class="sub">Fora de operação no momento.</p>';
    }
    html += alertsHtml(d.alerts);
    if (d.position?.stale) html += '<div class="alert" role="alert">⚠ Sinal do veículo perdido — posições podem estar desatualizadas.</div>';

    if (d.next_stops?.length) {
      html += '<div class="card"><strong>Próximas paradas</strong>';
      for (const s of d.next_stops) {
        html += `<div class="stop-item">
          <span>${esc(s.name)}</span>
          <span class="stop-eta" aria-label="chegada em ${esc(s.eta_text)}">${esc(s.eta_text)}</span>
        </div>`;
      }
      html += '</div>';
    } else if (d.route) {
      html += '<p class="empty">Fim do trajeto próximo.</p>';
    }
    html += `<div class="updated">Atualizado às ${new Date().toLocaleTimeString('pt-BR')}</div>`;
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
  }

  await refresh();
  return api.subscribe({ channel: `vehicle:${code}`, refresh, onEvent: () => refresh() });
}

// ================================================================ início (favoritos)
function homeView() {
  const favs = api.getFavorites();
  let html = '<h2>Seus pontos</h2>';
  if (favs.length) {
    html += '<p class="sub">Favoritos salvos neste aparelho</p>';
    for (const f of favs) {
      html += `<div class="card"><a class="link" href="?stop=${encodeURIComponent(f.code)}">📍 ${esc(f.name)}</a></div>`;
    }
  } else {
    html += `<p class="empty">Escaneie o QR Code no ponto de ônibus para ver as chegadas em tempo real.<br><br>
      Ao abrir um ponto, toque em ☆ para salvá-lo aqui.</p>`;
  }
  app.innerHTML = html;
  app.setAttribute('aria-busy', 'false');
}

// ================================================================ boot
(function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => setOffline(false));

  if (params.get('stop')) stopView(params.get('stop'));
  else if (params.get('route')) routeView(params.get('route'), params.get('from'));
  else if (params.get('vehicle')) vehicleView(params.get('vehicle'));
  else homeView();
})();
