// Painel de Gestão — abas: Mapa (RF-G1/G5), Escala (RF-G3), Alertas (RF-G4),
// KPIs (RF-G6), Replay (RF-G7). CRUD base (RF-G2) usa a UI do próprio Directus.
/* global L */
import * as api from './api.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_LABEL = { moving: 'em rota', stopped: 'parado', stale: 'sinal fraco', no_signal: 'sem sinal' };

let currentTab = 'mapa';
const cleanups = {};   // por aba: função de teardown (timers/mapas)

// ================================================================ shell
async function boot() {
  const token = await api.accessToken();
  if (token) enter();
  $('login-box').onsubmit = async (e) => {
    e.preventDefault();
    $('login-msg').textContent = '';
    const s = await api.login($('email').value.trim(), $('senha').value);
    if (!s) { $('login-msg').textContent = 'Credenciais inválidas.'; return; }
    enter();
  };
  $('logout').onclick = () => { api.logout(); location.reload(); };
  $('tabs').querySelectorAll('button').forEach(b => {
    b.onclick = () => switchTab(b.dataset.tab);
  });
}

function enter() {
  $('login-box').style.display = 'none';
  $('tabs').style.display = 'flex';
  $('logout').style.display = 'block';
  switchTab('mapa');
}

function switchTab(tab) {
  cleanups[currentTab]?.();
  cleanups[currentTab] = null;
  currentTab = tab;
  document.querySelectorAll('nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  ({ mapa: mapaView, escala: escalaView, alertas: alertasView, kpis: kpisView, replay: replayView }[tab])();
}

// ================================================================ Mapa da frota
async function mapaView() {
  const el = $('tab-mapa');
  el.innerHTML = `<h2>Frota ao vivo</h2><div id="map" role="application" aria-label="Mapa da frota"></div>
    <table><thead><tr><th>Veículo</th><th>Linha</th><th>Status</th><th>Velocidade</th><th>Última posição</th></tr></thead>
    <tbody id="fleet-rows"></tbody></table>`;

  const map = L.map($('map')).setView([-10.9472, -37.0731], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const markers = new Map();

  const markerIcon = (color, status, heading) => L.divIcon({
    className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<div style="transform:rotate(${heading ?? 0}deg)">
      <svg width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="11" fill="${status === 'moving' || status === 'stopped' ? color : '#8d99ae'}"
          stroke="${status === 'no_signal' || status === 'stale' ? '#ff6b6b' : '#fff'}" stroke-width="3"/>
        <path d="M15 6 L18.5 12 L11.5 12 Z" fill="#fff"/></svg></div>` });

  async function refresh() {
    const r = await api.jfetch('/live/fleet', { auth: false });
    if (!r.ok) return;
    const rows = [];
    let bounds = [];
    for (const v of r.data.vehicles) {
      const color = v.route?.color ?? '#4ea8de';
      if (v.position) {
        bounds.push([v.position.lat, v.position.lng]);
        const ic = markerIcon(color, v.status, v.position.heading);
        if (markers.has(v.vehicle.code)) {
          markers.get(v.vehicle.code).setLatLng([v.position.lat, v.position.lng]).setIcon(ic);
        } else {
          markers.set(v.vehicle.code, L.marker([v.position.lat, v.position.lng],
            { icon: ic, alt: `Veículo ${v.vehicle.code}` }).addTo(map)
            .bindPopup(`<b>${esc(v.vehicle.code)}</b><br>${STATUS_LABEL[v.status]}`));
        }
      }
      rows.push(`<tr>
        <td><b>${esc(v.vehicle.code)}</b></td>
        <td>${v.route ? `<span class="badge" style="background:${esc(v.route.color)}">${esc(v.route.short_name)}</span> → ${esc(v.trip?.headsign ?? '')}` : '<span class="muted">—</span>'}</td>
        <td><span class="chip ${v.status}">${STATUS_LABEL[v.status]}</span></td>
        <td>${v.position?.speed != null ? Math.round(v.position.speed) + ' km/h' : '—'}</td>
        <td>${v.age_seconds != null ? (v.age_seconds < 90 ? 'agora' : Math.round(v.age_seconds / 60) + ' min atrás') : 'nunca'}</td>
      </tr>`);
    }
    $('fleet-rows').innerHTML = rows.join('');
    if (bounds.length && !map._fitted) { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 }); map._fitted = true; }
  }

  await refresh();
  const timer = setInterval(refresh, 10_000);

  // tempo real por WS em todos os canais de linha
  let sockets = [];
  const routes = await api.jfetch('/dx/items/routes?fields=id', { auth: false });
  for (const rt of routes.data ?? []) {
    const ws = new WebSocket((location.origin).replace(/^http/, 'ws') + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', channel: `route:${rt.id}` }));
    ws.onmessage = () => refresh();   // evento → atualiza frota (com cache 5s do backend)
    sockets.push(ws);
  }

  cleanups.mapa = () => { clearInterval(timer); sockets.forEach(w => w.close()); map.remove(); };
}

// ================================================================ Escala
async function escalaView() {
  const el = $('tab-escala');
  el.innerHTML = '<h2>Escala motorista ↔ veículo ↔ viagem</h2><div id="escala-form"></div><div id="escala-list"></div>';

  const [me, driversRes, vehicles, trips, routes] = await Promise.all([
    api.jfetch('/dx/users/me?fields=id'),
    api.jfetch('/dx/users?fields=id,first_name,last_name,email&limit=100'),
    api.jfetch('/dx/items/vehicles?fields=id,code&limit=-1'),
    api.jfetch('/dx/items/trips?fields=id,route_id,headsign,direction&limit=-1'),
    api.jfetch('/dx/items/routes?fields=id,short_name&limit=-1'),
  ]);
  // a permissão limita a role Driver, mas o self-read do Directus inclui o
  // próprio operador — remove-o da lista
  const drivers = { data: (driversRes.data ?? []).filter(d => d.id !== me.data?.id) };
  const routeById = new Map((routes.data ?? []).map(r => [r.id, r]));

  $('escala-form').innerHTML = `<form id="f-escala">
    <div><label>Motorista</label><select id="e-driver">${(drivers.data ?? []).map(d =>
      `<option value="${d.id}">${esc(d.first_name)} ${esc(d.last_name ?? '')} (${esc(d.email)})</option>`).join('')}</select></div>
    <div><label>Veículo</label><select id="e-vehicle">${(vehicles.data ?? []).map(v =>
      `<option value="${v.id}">${esc(v.code)}</option>`).join('')}</select></div>
    <div><label>Viagem</label><select id="e-trip">${(trips.data ?? []).map(t =>
      `<option value="${t.id}">${esc(routeById.get(t.route_id)?.short_name ?? '?')} — ${esc(t.headsign)} (${esc(t.direction)})</option>`).join('')}</select></div>
    <div><label>Início do turno</label><input id="e-start" type="datetime-local"></div>
    <div class="full"><button class="primary" type="submit">CRIAR ESCALA</button>
      <span id="e-msg" class="msg"></span></div>
  </form>`;

  async function loadList() {
    const r = await api.jfetch('/dx/items/driver_assignments?sort=-shift_start&limit=15&fields=id,status,shift_start,shift_end,driver_id,vehicle_id,trip_id');
    const vById = new Map((vehicles.data ?? []).map(v => [v.id, v.code]));
    const dById = new Map((drivers.data ?? []).map(d => [d.id, `${d.first_name} ${d.last_name ?? ''}`]));
    $('escala-list').innerHTML = `<table><thead><tr><th>Motorista</th><th>Veículo</th><th>Início</th><th>Status</th><th></th></tr></thead><tbody>${
      (r.data ?? []).map(a => `<tr>
        <td>${esc(dById.get(a.driver_id) ?? a.driver_id?.slice(0, 8) ?? '—')}</td>
        <td>${esc(vById.get(a.vehicle_id) ?? '—')}</td>
        <td>${a.shift_start ? new Date(a.shift_start).toLocaleString('pt-BR') : '—'}</td>
        <td><span class="chip ${a.status === 'active' ? 'moving' : 'stopped'}">${esc(a.status)}</span></td>
        <td>${a.status === 'active' ? `<button class="danger-sm" data-end="${a.id}">encerrar</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`;
    $('escala-list').querySelectorAll('[data-end]').forEach(b => {
      b.onclick = async () => {
        await api.jfetch(`/dx/items/driver_assignments/${b.dataset.end}`, {
          method: 'PATCH', body: { status: 'finished', shift_end: new Date().toISOString() } });
        loadList();
      };
    });
  }

  $('f-escala').onsubmit = async (e) => {
    e.preventDefault();
    const r = await api.jfetch('/dx/items/driver_assignments', { method: 'POST', body: {
      driver_id: $('e-driver').value, vehicle_id: $('e-vehicle').value, trip_id: $('e-trip').value,
      shift_start: $('e-start').value ? new Date($('e-start').value).toISOString() : new Date().toISOString(),
      status: 'scheduled' } });
    $('e-msg').textContent = r.ok ? '' : `Falha (HTTP ${r.status})`;
    if (r.ok) loadList();
  };

  loadList();
}

// ================================================================ Alertas
async function alertasView() {
  const el = $('tab-alertas');
  el.innerHTML = '<h2>Avisos ao passageiro e motoristas</h2><div id="al-form"></div><div id="al-list"></div>';

  const [routes, stops] = await Promise.all([
    api.jfetch('/dx/items/routes?fields=id,short_name&limit=-1', { auth: false }),
    api.jfetch('/dx/items/stops?fields=id,code,name&limit=-1', { auth: false }),
  ]);

  $('al-form').innerHTML = `<form id="f-alerta">
    <div><label>Escopo</label><select id="a-scope">
      <option value="system">Sistema (todos)</option>
      <option value="route">Linha</option>
      <option value="stop">Ponto</option></select></div>
    <div><label>Linha</label><select id="a-route" disabled>${(routes.data ?? []).map(r =>
      `<option value="${r.id}">${esc(r.short_name)}</option>`).join('')}</select></div>
    <div><label>Ponto</label><select id="a-stop" disabled>${(stops.data ?? []).map(s =>
      `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div><label>Severidade</label><select id="a-sev">
      <option value="info">info</option><option value="warning">warning</option>
      <option value="critical">critical</option></select></div>
    <div class="full"><label>Título</label><input id="a-title" required maxlength="120"></div>
    <div class="full"><label>Mensagem</label><textarea id="a-msg-text" rows="2"></textarea></div>
    <div class="full"><button class="primary" type="submit">PUBLICAR AVISO</button>
      <span id="a-msg" class="msg"></span></div>
  </form>`;

  $('a-scope').onchange = () => {
    $('a-route').disabled = $('a-scope').value !== 'route';
    $('a-stop').disabled = $('a-scope').value !== 'stop';
  };

  async function loadList() {
    const r = await api.jfetch(`/dx/items/service_alerts?sort=-active_from&limit=20&fields=id,scope,title,severity,active_from,active_to`);
    const now = Date.now();
    $('al-list').innerHTML = `<table><thead><tr><th>Título</th><th>Escopo</th><th>Severidade</th><th>Vigência</th><th></th></tr></thead><tbody>${
      (r.data ?? []).map(a => {
        const active = new Date(a.active_from) <= now && (!a.active_to || new Date(a.active_to) >= now);
        return `<tr>
          <td>${esc(a.title)}</td><td>${esc(a.scope)}</td><td>${esc(a.severity)}</td>
          <td><span class="chip ${active ? 'moving' : 'stopped'}">${active ? 'ativo' : 'encerrado'}</span></td>
          <td>${active ? `<button class="danger-sm" data-off="${a.id}">encerrar</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>`;
    $('al-list').querySelectorAll('[data-off]').forEach(b => {
      b.onclick = async () => {
        await api.jfetch(`/dx/items/service_alerts/${b.dataset.off}`, {
          method: 'PATCH', body: { active_to: new Date().toISOString() } });
        loadList();
      };
    });
  }

  $('f-alerta').onsubmit = async (e) => {
    e.preventDefault();
    const scope = $('a-scope').value;
    const r = await api.jfetch('/dx/items/service_alerts', { method: 'POST', body: {
      scope,
      route_id: scope === 'route' ? $('a-route').value : null,
      stop_id: scope === 'stop' ? $('a-stop').value : null,
      title: $('a-title').value, message: $('a-msg-text').value,
      severity: $('a-sev').value, active_from: new Date().toISOString() } });
    $('a-msg').textContent = r.ok ? '' : `Falha (HTTP ${r.status})`;
    if (r.ok) { $('a-title').value = ''; $('a-msg-text').value = ''; loadList(); }
  };

  loadList();
}

// ================================================================ KPIs
async function kpisView() {
  const el = $('tab-kpis');
  el.innerHTML = '<h2>Indicadores</h2><div class="grid" id="kpi-tiles"></div><div id="kpi-scans"></div>';

  const [fleet, alerts, qrs, positions] = await Promise.all([
    api.jfetch('/live/fleet', { auth: false }),
    api.jfetch(`/dx/items/service_alerts?filter=${api.filt({ _and: [
      { active_from: { _lte: '$NOW' } },
      { _or: [{ active_to: { _null: true } }, { active_to: { _gte: '$NOW' } }] }] })}&fields=id`, { auth: false }),
    api.jfetch('/dx/items/qr_codes?sort=-scans&limit=50&fields=public_code,target_type,scans', { auth: false }),
    api.jfetch(`/dx/items/vehicle_positions?filter=${api.filt({ recorded_at: { _gte: '$NOW(-1 days)' } })}&aggregate[count]=id`, { auth: false }),
  ]);

  const vs = fleet.data?.vehicles ?? [];
  const withSignal = vs.filter(v => v.status === 'moving' || v.status === 'stopped').length;
  const noSignal = vs.filter(v => v.status === 'no_signal' || v.status === 'stale').length;
  const totalScans = (qrs.data ?? []).reduce((s, q) => s + (q.scans ?? 0), 0);
  const pos24 = positions.data?.[0]?.count?.id ?? positions.data?.[0]?.count ?? '—';

  $('kpi-tiles').innerHTML = `
    <div class="tile"><div class="v" style="color:var(--ok)">${withSignal}</div><div class="k">veículos transmitindo</div></div>
    <div class="tile"><div class="v" style="color:var(--err)">${noSignal}</div><div class="k">sem sinal / sinal fraco</div></div>
    <div class="tile"><div class="v">${(alerts.data ?? []).length}</div><div class="k">avisos ativos</div></div>
    <div class="tile"><div class="v">${totalScans}</div><div class="k">scans de QR (total)</div></div>
    <div class="tile"><div class="v">${pos24}</div><div class="k">posições nas últimas 24h</div></div>`;

  $('kpi-scans').innerHTML = `<table><thead><tr><th>QR</th><th>Tipo</th><th>Scans</th></tr></thead><tbody>${
    (qrs.data ?? []).slice(0, 8).map(q => `<tr><td><b>${esc(q.public_code)}</b></td>
      <td>${q.target_type === 'stop' ? 'ponto' : 'veículo'}</td><td>${q.scans ?? 0}</td></tr>`).join('')}</tbody></table>
    <p class="muted" style="margin-top:10px">Atraso médio e cumprimento de horário chegam com o ETA v2 (goal 06).</p>`;
}

// ================================================================ Replay
async function replayView() {
  const el = $('tab-replay');
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600_000);
  const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const vehicles = await api.jfetch('/dx/items/vehicles?fields=id,code&limit=-1', { auth: false });
  el.innerHTML = `<h2>Replay de trajeto</h2>
    <div class="replay-controls">
      <select id="r-vehicle">${(vehicles.data ?? []).map(v => `<option value="${v.id}">${esc(v.code)}</option>`).join('')}</select>
      <input id="r-from" type="datetime-local" value="${toLocal(hourAgo)}">
      <input id="r-to" type="datetime-local" value="${toLocal(now)}">
      <button class="primary" id="r-load">CARREGAR</button>
      <button class="primary" id="r-play" disabled>▶ REPRODUZIR</button>
      <span id="r-info" class="muted"></span>
    </div>
    <div id="replay-map"></div>`;

  const map = L.map($('replay-map')).setView([-10.9472, -37.0731], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  let layer = null, marker = null, playTimer = null, track = [];

  $('r-load').onclick = async () => {
    const from = new Date($('r-from').value).toISOString();
    const to = new Date($('r-to').value).toISOString();
    const r = await api.jfetch(`/dx/items/vehicle_positions?limit=-1&sort=recorded_at&fields=lat,lng,speed,recorded_at&filter=${api.filt({ _and: [
      { vehicle_id: { _eq: $('r-vehicle').value } },
      { recorded_at: { _between: [from, to] } }] })}`);
    track = (r.data ?? []).map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));
    layer?.remove(); marker?.remove(); clearInterval(playTimer);
    $('r-info').textContent = `${track.length} posição(ões) na janela`;
    $('r-play').disabled = track.length < 2;
    if (track.length) {
      layer = L.polyline(track.map(p => [p.lat, p.lng]), { color: '#4ea8de', weight: 4 }).addTo(map);
      map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    }
  };

  $('r-play').onclick = () => {
    clearInterval(playTimer);
    marker?.remove();
    marker = L.circleMarker([track[0].lat, track[0].lng],
      { radius: 9, color: '#fff', fillColor: '#ffbf47', fillOpacity: 1 }).addTo(map);
    let i = 0;
    playTimer = setInterval(() => {
      i++;
      if (i >= track.length) { clearInterval(playTimer); $('r-info').textContent += ' · fim'; return; }
      marker.setLatLng([track[i].lat, track[i].lng]);
      $('r-info').textContent = `${i + 1}/${track.length} · ${new Date(track[i].recorded_at).toLocaleTimeString('pt-BR')}`;
    }, 120); // ~8 posições/s
  };

  cleanups.replay = () => { clearInterval(playTimer); map.remove(); };
}

boot();
