// Mapa ao vivo (Leaflet + tiles OSM). Marcadores de veículo com rotação por
// heading; marcadores de ponto; trajeto como polyline.
/* global L */

export function createMap(el) {
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

export function stopMarker(map, stop, { highlight = false } = {}) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${highlight ? 18 : 12}px;height:${highlight ? 18 : 12}px;border-radius:50%;
      background:${highlight ? '#0b4f9e' : '#ffffff'};border:3px solid #0b4f9e;
      box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [highlight ? 24 : 18, highlight ? 24 : 18],
    iconAnchor: [highlight ? 12 : 9, highlight ? 12 : 9],
  });
  return L.marker([stop.lat, stop.lng], { icon, alt: `Ponto ${stop.name}` })
    .addTo(map).bindPopup(`<b>${stop.name}</b>`);
}

export function vehicleMarker(map, color = '#0b4f9e') {
  const html = (heading, stale) => `
    <div role="img" aria-label="Ônibus" style="transform:rotate(${heading ?? 0}deg);width:34px;height:34px;
      display:flex;align-items:center;justify-content:center;">
      <svg width="34" height="34" viewBox="0 0 34 34">
        <circle cx="17" cy="17" r="13" fill="${stale ? '#8d99ae' : color}" stroke="#fff" stroke-width="3"/>
        <path d="M17 6 L21 13 L13 13 Z" fill="#fff"/>
        <rect x="13" y="15" width="8" height="7" rx="1.5" fill="#fff"/>
      </svg>
    </div>`;
  const icon = (heading, stale) => L.divIcon({
    className: '', html: html(heading, stale), iconSize: [34, 34], iconAnchor: [17, 17] });

  let marker = null;
  return {
    update(position) {
      const ic = icon(position.heading, position.stale);
      if (!marker) {
        marker = L.marker([position.lat, position.lng], { icon: ic, alt: 'Ônibus' }).addTo(map);
      } else {
        marker.setLatLng([position.lat, position.lng]);
        marker.setIcon(ic);
      }
      return marker;
    },
    remove() { marker?.remove(); marker = null; },
  };
}

export function drawTrajectory(map, stops, color = '#0b4f9e') {
  return L.polyline(stops.map(s => [s.lat, s.lng]),
    { color, weight: 4, opacity: 0.7 }).addTo(map);
}
