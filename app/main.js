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