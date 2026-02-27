import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// =============================================
// CARTE
// =============================================
const METROPOLE_BOUNDS = L.latLngBounds(
  [45.45, 4.65],  // coin sud-ouest
  [46.00, 5.25]   // coin nord-est
);

const map = L.map('map', {
  maxBounds:        METROPOLE_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom: 10,
  maxZoom: 18,
}).setView([45.757295, 4.832391], 11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const GEOSERVER_URL = "http://localhost:8081/geoserver/wms";

// =============================================
// GESTION DES COUCHES
// =============================================
const layerInstances = {};

document.querySelectorAll('.layer-checkbox').forEach(checkbox => {
  const layerName = checkbox.dataset.layer;

  if (checkbox.checked) {
    layerInstances[layerName] = createWMSLayer(layerName);
    map.addLayer(layerInstances[layerName]);
  }

  checkbox.addEventListener('change', function () {
    if (this.checked) {
      if (!layerInstances[layerName]) {
        layerInstances[layerName] = createWMSLayer(layerName);
      }
      map.addLayer(layerInstances[layerName]);
    } else {
      if (layerInstances[layerName]) {
        map.removeLayer(layerInstances[layerName]);
      }
    }
  });
});

function createWMSLayer(layerName) {
  return L.tileLayer.wms(GEOSERVER_URL, {
    layers:      layerName,
    transparent: true,
    format:      "image/png",
    opacity:     0.7
  });
}

// =============================================
// ACCORDÉON DES CATÉGORIES
// =============================================
document.querySelectorAll('.category-toggle').forEach(button => {
  button.addEventListener('click', function () {
    const targetId = this.dataset.target;
    const layersDiv = document.getElementById(targetId);
    layersDiv.classList.toggle('hidden');
    this.classList.toggle('closed');
  });
});

// =============================================
// ÉCHELLE LEAFLET
// =============================================
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

// =============================================
// POPUPS D'INFORMATION — haut à droite, sans overlay
// =============================================
const categoryInfo = {
  'cat-air': {
    titre:   "Pollution de l'air",
    icone:   "💨",
    contenu: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`
  },
  'cat-pollen': {
    titre:   "Pollen",
    icone:   "🌿",
    contenu: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`
  },
  'cat-bruit': {
    titre:   "Bruit",
    icone:   "🔊",
    contenu: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`
  }
};

// Créer le popup (sans overlay)
const popup = document.createElement('div');
popup.id = 'info-popup';
popup.innerHTML = `
  <div id="popup-box">
    <button id="popup-close">✕</button>
    <h3 id="popup-title"></h3>
    <p id="popup-content"></p>
  </div>
`;
document.body.appendChild(popup);

// Ouvrir au clic sur ℹ️
document.querySelectorAll('.category-info-btn').forEach(btn => {
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    const cat = categoryInfo[this.dataset.cat];
    document.getElementById('popup-title').textContent   = `${cat.icone} ${cat.titre}`;
    document.getElementById('popup-content').textContent = cat.contenu;
    popup.classList.add('visible');
  });
});

// Fermer uniquement avec le ✕
document.getElementById('popup-close').addEventListener('click', () => popup.classList.remove('visible'));