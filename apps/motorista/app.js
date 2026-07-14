// App do Motorista — máquina de estados: login → turno → painel (goal 02)
import * as api from './api.js';
import * as queue from './queue.js';
import { GpsSource, nextStop } from './gps.js';

const $ = (id) => document.getElementById(id);
const show = (id) => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
};

const state = {
  userId: null,
  assignment: null,   // {id, vehicle_id, trip_id}
  path: [],           // trajeto da viagem para "próxima parada"
  gps: null,
  flusher: null,
  alertsTimer: null,
  wakeLock: null,
  offline: false,     // window.__simulateOffline (teste) OU navigator.onLine
};

// exposto para testes/depuração (usado na verificação do DoD)
window.__bi = { state, queue };
Object.defineProperty(window, '__simulateOffline', {
  set(v) { state.offline = !!v; }, get() { return state.offline; },
});

// ---------------------------------------------------------------- login
$('btn-login').onclick = async () => {
  $('login-msg').textContent = '';
  const s = await api.login($('email').value.trim(), $('pin').value);
  if (!s) { $('login-msg').textContent = 'Usuário ou PIN inválidos.'; return; }
  state.userId = s.user_id;
  await enterSetup();
};

$('btn-logout').onclick = () => { api.logout(); show('screen-login'); };

// ---------------------------------------------------------------- turno
async function enterSetup() {
  // sessão longa: retoma turno ativo se existir (RF-M2)
  const active = await api.activeAssignment(state.userId);
  if (active) { state.assignment = active; return enterDashboard(); }

  const [vehicles, trips] = await Promise.all([api.listVehicles(), api.listTrips()]);
  $('sel-vehicle').innerHTML = (vehicles.data ?? [])
    .map(v => `<option value="${v.id}">${v.code} (${v.plate ?? ''})</option>`).join('');
  $('sel-trip').innerHTML = trips
    .map(t => `<option value="${t.id}">${t.route?.short_name ?? '?'} — ${t.headsign} (${t.direction})</option>`)
    .join('');
  show('screen-setup');
}

$('btn-start').onclick = async () => {
  $('setup-msg').textContent = '';
  const r = await api.startShift(state.userId, $('sel-vehicle').value, $('sel-trip').value);
  if (!r.ok) { $('setup-msg').textContent = `Falha ao iniciar turno (HTTP ${r.status}).`; return; }
  state.assignment = r.data;
  enterDashboard();
};

// ---------------------------------------------------------------- painel
async function enterDashboard() {
  show('screen-dash');
  state.path = await api.tripPath(state.assignment.trip_id);
  $('shift-info').textContent = `Turno ativo desde ${new Date(state.assignment.shift_start).toLocaleTimeString('pt-BR')}`;

  await requestWakeLock();       // mantém a tela ligada durante o turno (RF-M3)
  startGps();
  startFlusher();
  startAlerts();
  updateStatus();
}

function startGps() {
  state.gps = new GpsSource(async (sample) => {
    await queue.enqueue({
      vehicle_id: state.assignment.vehicle_id,
      trip_id: state.assignment.trip_id,
      lat: sample.lat, lng: sample.lng,
      speed: sample.speed != null ? Math.round(sample.speed) : null,
      heading: sample.heading,
      recorded_at: new Date().toISOString(),
    });
    $('speed').textContent = sample.speed != null ? Math.round(sample.speed) : '–';
    const ns = nextStop(sample, state.path);
    $('next-stop').textContent = ns?.name ?? '–';
    updateStatus();
  });
  const started = state.gps.start();
  if (!started || !navigator.geolocation) {
    offerSimulation('GPS indisponível neste dispositivo.');
    return;
  }
  // se em 20s não houver fix, oferece simulação (preview/desktop)
  setTimeout(() => { if (!state.gps.hasFix() && !state.gps.simulating) offerSimulation('Sem sinal de GPS.'); }, 20_000);
}

function offerSimulation(reason) {
  $('gps-hint').innerHTML = `${reason} <u style="cursor:pointer" id="btn-sim">Usar GPS simulado (demonstração)</u>`;
  $('btn-sim').onclick = () => {
    state.gps.startSimulation(state.path, 30);
    $('gps-hint').textContent = 'GPS SIMULADO em uso (modo demonstração).';
  };
}

// flusher: envia a fila em lote; só remove após confirmação (RF-M5)
function startFlusher() {
  state.flusher = setInterval(async () => {
    if (state.offline || !navigator.onLine) { updateStatus(); return; }
    const batch = await queue.peekBatch(100);
    if (batch.length === 0) { updateStatus(); return; }
    const rows = batch.map(({ key, ...p }) => p);
    const sent = await api.sendPositions(rows).catch(() => false);
    if (sent) await queue.removeKeys(batch.map(b => b.key));
    updateStatus();
  }, 5_000);
}

async function updateStatus() {
  const n = await queue.count();
  $('buffer').textContent = n;
  const el = $('status');
  if (state.offline || !navigator.onLine) {
    el.className = 'status-banner warn';
    el.textContent = `⚠️ Sem rede — ${n} posição(ões) no buffer`;
  } else if (state.gps?.hasFix()) {
    el.className = 'status-banner ok';
    el.textContent = '✅ Transmitindo';
  } else {
    el.className = 'status-banner warn';
    el.textContent = 'Aguardando GPS…';
  }
}
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);

// avisos da operação (RF-M7)
function startAlerts() {
  const load = async () => {
    const r = await api.listAlerts();
    $('alerts').innerHTML = (r.data ?? [])
      .map(a => `<div class="alert ${a.severity}"><b>${a.title}</b><br>${a.message ?? ''}</div>`)
      .join('');
  };
  load();
  state.alertsTimer = setInterval(load, 60_000);
}

// tela ligada durante o turno
async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && state.assignment)
        state.wakeLock = await navigator.wakeLock?.request('screen');
    });
  } catch { /* não suportado — segue sem */ }
}

// ---------------------------------------------------------------- encerrar (RF-M6)
$('btn-end').onclick = async () => {
  $('btn-end').disabled = true;
  // drena o buffer antes de encerrar, se houver rede
  if (!state.offline && navigator.onLine) {
    const rest = await queue.peekBatch(500);
    if (rest.length) {
      const sent = await api.sendPositions(rest.map(({ key, ...p }) => p)).catch(() => false);
      if (sent) await queue.removeKeys(rest.map(b => b.key));
    }
  }
  await api.endShift(state.assignment.id);
  state.gps?.stop();
  clearInterval(state.flusher);
  clearInterval(state.alertsTimer);
  state.wakeLock?.release?.();
  state.assignment = null;
  $('btn-end').disabled = false;
  enterSetup();
};

// ---------------------------------------------------------------- boot
(async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const s = api.getSession();
  if (s) {
    const token = await api.accessToken();
    if (token) { state.userId = s.user_id; return enterSetup(); }
  }
  show('screen-login');
})();
