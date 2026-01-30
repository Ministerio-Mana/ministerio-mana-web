import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import churchesData from '../data/churches.json';

/** @type {{name: string, city?: string, lat?: number, lng?: number}[]} */
const churches = churchesData;

function initMap() {
  const container = document.getElementById('churches-map');
  if (!container) return;

  const withCoords = churches.filter(
    (c) => typeof c.lat === 'number' && typeof c.lng === 'number',
  );

  // Centro del mapa: promedio de los puntos o Colombia por defecto
  const center: [number, number] =
    withCoords.length > 0
      ? [
          withCoords.reduce((sum, c) => sum + (c.lat ?? 0), 0) / withCoords.length,
          withCoords.reduce((sum, c) => sum + (c.lng ?? 0), 0) / withCoords.length,
        ]
      : [4.65, -74.06]; // lat, lng Bogotá aprox

  const map = L.map(container).setView(center, 6);

  // Teselas de OpenStreetMap (mapa de calles “normal”)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> colaboradores',
    maxZoom: 18,
  }).addTo(map);

  withCoords.forEach((church) => {
    const popupHtml = `
      <div style="font-size:12px; line-height:1.4">
        <strong>${church.name}</strong><br/>
        ${church.city ?? ''}
      </div>
    `;

    L.marker([church.lat!, church.lng!]).addTo(map).bindPopup(popupHtml);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMap);
} else {
  initMap();
}
