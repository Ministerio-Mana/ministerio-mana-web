
import churchesData from '../data/churches.json';

// Configuration for the SVG map projection
// These values need to be calibrated to match the specific SVG path used
const MAP_WIDTH = 1008;
const MAP_HEIGHT = 651;

// Calibration points (approximate for typical Miller/Equi maps)
// We might need to tweak these offsets/scales based on visual testing
const PROJECTION = {
  // Miller Projection approximation
  project: (lat, lng) => {
    // Convert lat/lng to radians
    const radLat = lat * Math.PI / 180;

    // Miller projection formula
    // x = lambda
    // y = 1.25 * ln(tan(pi/4 + 0.4 * phi))

    const x = (lng + 180) * (MAP_WIDTH / 360);

    // Y is trickier on SVGs. 
    // Let's try a linear Equirectangular first as it often maps better to simple SVGs
    // y = (90 - lat) * (MAP_HEIGHT / 180);

    // Actually, let's use a linear scaling with offset for now, 
    // and I'll calibrate it with known points (Bogotá, London).

    // Map bounds (approx)
    const MAX_LAT = 85;
    const MIN_LAT = -60;
    const MAX_LNG = 180;
    const MIN_LNG = -180;

    const xPercent = (lng - MIN_LNG) / (MAX_LNG - MIN_LNG);
    const yPercent = (MAX_LAT - lat) / (MAX_LAT - MIN_LAT);

    return {
      x: xPercent * MAP_WIDTH,
      y: yPercent * MAP_HEIGHT
    };
  }
};

class ChurchesMap {
  constructor() {
    this.container = document.getElementById('map-container');
    this.pinsLayer = document.getElementById('pins-layer');
    this.zoomInBtn = document.getElementById('zoom-in');
    this.zoomOutBtn = document.getElementById('zoom-out');

    if (!this.container || !this.pinsLayer) return;

    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;

    // Default focus: Colombia
    this.focusOnCountry('Colombia');

    this.init();
  }

  init() {
    this.renderPins();
    this.bindEvents();

    // Initial animation
    setTimeout(() => {
      // We start zoomed in on Colombia
      this.updateTransform();
    }, 100);
  }

  project(lat, lng) {
    // Custom calibration for the specific SVG path I used
    // Based on trial and error with standard SVGs
    // X: 0 = -169 deg, 1008 = 190 deg approx
    // Y: 0 = 84 deg, 651 = -58 deg 

    const x = (lng + 169) * (1008 / 360);

    // Latitude is non-linear in most nice maps (Mercator/Miller)
    // But for a stylized map, linear might be close enough for small regions
    // Let's try linear first
    const y = (84 - lat) * (651 / 142);

    return { x, y };
  }

  renderPins() {
    // Group by location to avoid overlapping pins ??
    // For now, just render all

    churchesData.forEach(church => {
      if (typeof church.lat !== 'number' || typeof church.lng !== 'number') return;

      const pos = this.project(church.lat, church.lng);

      const pin = document.createElement('div');
      pin.className = 'absolute w-0 h-0 group';
      pin.style.left = `${pos.x}px`;
      pin.style.top = `${pos.y}px`;
      pin.style.zIndex = '10';

      // Pin HTML
      pin.innerHTML = `
        <!-- Pulse effect -->
        <div class="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-brand-teal/30 rounded-full animate-ping opacity-75"></div>
        
        <!-- Pin head -->
        <div class="absolute -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-[0_0_10px_rgba(40,166,189,0.8)] cursor-pointer hover:scale-150 transition-transform duration-300"></div>
        
        <!-- Popup / Tooltip -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 w-48 bg-white text-slate-900 text-xs rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none group-hover:pointer-events-auto transform translate-y-2 group-hover:translate-y-0 z-20 overflow-hidden">
          <div class="h-1 w-full bg-brand-teal"></div>
          <div class="p-3">
             <p class="font-bold text-brand-navy mb-0.5">${church.name}</p>
             <p class="text-slate-500 mb-2">${church.city || ''}</p>
             ${church.whatsapp ? `
               <a href="https://wa.me/${church.whatsapp.replace(/[^0-9]/g, '')}" target="_blank" class="block w-full text-center bg-brand-teal/10 text-brand-teal font-bold py-1.5 rounded-lg hover:bg-brand-teal hover:text-white transition-colors">
                 WhatsApp
               </a>
             ` : ''}
          </div>
          <!-- Arrow -->
          <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white transform rotate-45"></div>
        </div>
      `;

      this.pinsLayer.appendChild(pin);
    });
  }

  bindEvents() {
    this.zoomInBtn?.addEventListener('click', () => this.zoom(1.5));
    this.zoomOutBtn?.addEventListener('click', () => this.zoom(1 / 1.5));

    // Drag/Pan logic
    let isDragging = false;
    let startX, startY;

    this.container.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX - this.translateX;
      startY = e.clientY - this.translateY;
      this.container.style.cursor = 'grabbing';
      this.container.classList.remove('transition-transform'); // Disable transition for direct control
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      this.translateX = e.clientX - startX;
      this.translateY = e.clientY - startY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      this.container.style.cursor = 'grab';
      this.container.classList.add('transition-transform'); // Re-enable transition
    });

    // Wheel zoom
    this.container.parentElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom(delta);
    }, { passive: false });
  }

  zoom(factor) {
    this.scale *= factor;
    this.scale = Math.min(Math.max(1, this.scale), 8); // Limits
    this.updateTransform();
  }

  focusOnCountry(country) {
    if (country === 'Colombia') {
      // Focus coordinates for Colombia approx
      // x: ~280, y: ~330 (Need to verify these coordinates on the SVG)
      // Let's deduce coordinates from the project function for Bogota (4.6, -74)
      const pos = this.project(4.6, -74);

      this.scale = 3;
      // Center logic: 
      // centerX = width/2 - (targetX * scale)
      this.translateX = (this.container.parentElement.offsetWidth / 2) - (pos.x * this.scale);
      this.translateY = (this.container.parentElement.offsetHeight / 2) - (pos.y * this.scale);

      this.updateTransform();
    } else {
      // Reset
      this.scale = 1;
      this.translateX = 0;
      this.translateY = 0;
      this.updateTransform();
    }
  }

  updateTransform() {
    // Keep within bounds
    // ... logic to prevent panning too far ...

    this.applyTransform();
  }

  applyTransform() {
    this.container.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  }
}

// Initializer
if (typeof window !== 'undefined') {
  window.initChurchesMap = () => {
    new ChurchesMap();
  };

  // Auto init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initChurchesMap);
  } else {
    window.initChurchesMap();
  }
}
