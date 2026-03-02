import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

console.log("[MAIN] main.js chargé - build marker 2026-03-02TXX:YY"); /**Prouver que le main.js exécuté est bien celui qu'on édite.*/

// =============================================
// UV (JSON servi par Caddy)
// Endpoint: /data/openmeteo_uv_meteofrance.json
// =============================================
const UV_JSON_URL = "/data/openmeteo_uv_meteofrance.json";

async function fetchUvJson() {
  const res = await fetch(UV_JSON_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`UV JSON HTTP ${res.status}`);
  return res.json(); // tableau d'objets
}

/**
 * Retourne le point UV le plus proche d'une coordonnée (lat/lon).
 * On fait simple (distance euclidienne sur lat/lon), suffisant à l'échelle de la métropole.
 */
function closestUvPoint(points, lat, lon) {
  let best = null;
  let bestD2 = Infinity;
  for (const p of points) {
    const pLat = p?.latitude;
    const pLon = p?.longitude;
    if (typeof pLat !== "number" || typeof pLon !== "number") continue;
    const dLat = pLat - lat;
    const dLon = pLon - lon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  return best;
}

/**
 * Extrait une valeur UV max (si dispo) et une date à partir d'un objet point.
 */
function extractUvMax(point) {
  const uv = point?.daily?.uv_index_max?.[0]; // souvent null pour l'instant
  return { uv };
}

/**
 * Debug/affichage : log la valeur UV la plus proche du centre de carte.
 * Si un élément #uv-status existe, écrit dedans (sinon, console seulement).
 */
async function updateUvFromMapCenter(map) {
  try {
    const points = await fetchUvJson();
    const center = map.getCenter();
    const p = closestUvPoint(points, center.lat, center.lng);

    if (!p) {
      console.warn("[UV] Aucun point UV trouvé dans le JSON.");
      const el = document.getElementById("uv-status");
      if (el) el.textContent = "Aucune donnée UV.";
      return;
    }

    const { uv } = extractUvMax(p);

    console.log("[UV] Point le plus proche du centre:", {
      center: { lat: center.lat, lon: center.lng },
      point: { lat: p.latitude, lon: p.longitude, location_id: p.location_id ?? null },
      uv_max: uv
    });

    const el = document.getElementById("uv-status");
    if (el) {
      el.textContent = (uv === null || uv === undefined)
        ? `UV max : très faible`
        : `UV max : ${uv}`;
    }
  } catch (err) {
    console.error("[UV] Erreur de chargement UV:", err);
    const el = document.getElementById("uv-status");
    if (el) el.textContent = "Erreur de chargement des UV.";
  }
}

// =============================================
// POP-UP DE BIENVENUE
// =============================================
window.addEventListener('load', () => {
  const overlay = document.getElementById('welcome-overlay');
  const closeBtn = document.getElementById('welcome-close');

  overlay.style.display = 'flex';

  closeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
  });
});

// =============================================
// EXTENSION BETTERWMS
// =============================================
L.TileLayer.BetterWMS = L.TileLayer.WMS.extend({

  onAdd: function (map) {
    L.TileLayer.WMS.prototype.onAdd.call(this, map);
    map.on('click', this.getFeatureInfo, this);
  },

  onRemove: function (map) {
    L.TileLayer.WMS.prototype.onRemove.call(this, map);
    map.off('click', this.getFeatureInfo, this);
  },

  getFeatureInfo: function (evt) {
    const url  = this.getFeatureInfoUrl(evt.latlng);
    const show = this.showGetFeatureInfo.bind(this);

    fetch(url)
      .then(r => r.json())
      .then(data => show(null, evt.latlng, data))
      .catch(err => show(err));
  },

  getFeatureInfoUrl: function (latlng) {
    const point = this._map.latLngToContainerPoint(latlng, this._map.getZoom());
    const size  = this._map.getSize();
    const v     = this.wmsParams.version;

    const params = {
      request:      'GetFeatureInfo',
      service:      'WMS',
      srs:          'EPSG:4326',
      styles:       this.wmsParams.styles,
      transparent:  this.wmsParams.transparent,
      version:      v,
      format:       this.wmsParams.format,
      bbox:         this._map.getBounds().toBBoxString(),
      height:       size.y,
      width:        size.x,
      layers:       this.wmsParams.layers,
      query_layers: this.wmsParams.layers,
      info_format:  'application/json',
      feature_count: 1,
    };

    params[v === '1.3.0' ? 'i' : 'x'] = Math.round(point.x);
    params[v === '1.3.0' ? 'j' : 'y'] = Math.round(point.y);

    return this._url + L.Util.getParamString(params, this._url, true);
  },

  showGetFeatureInfo: function (err, latlng, data) {
    if (err) { console.error('[BetterWMS]', err); return; }

    const features = data?.features;
    if (!features || features.length === 0) return;

    const props = features[0].properties;
    const entry = Object.entries(props).find(([, v]) => typeof v === 'number');
    if (!entry) return;

    const [key, val] = entry;
    const label = LAYER_LABELS[this.wmsParams.layers] ?? this.wmsParams.layers;
    const unit  = LAYER_UNITS[this.wmsParams.layers]  ?? "";

    L.popup({ maxWidth: 300 })
      .setLatLng(latlng)
      .setContent(`
        <div style="font-family:'Jost',sans-serif;font-size:0.85rem;line-height:1.8;">
          <b style="color:#1A4E72;">${label}</b><br>
          ${val.toFixed(2)} ${unit}
        </div>
      `)
      .openOn(this._map);
  }
});

L.tileLayer.betterWms = function (url, options) {
  return new L.TileLayer.BetterWMS(url, options);
};

// =============================================
// MÉTADONNÉES DES COUCHES
// =============================================
const LAYER_LABELS = {
  "cartozome:mod_aura_2024_pm10_moyan":  "PM10",
  "cartozome:mod_aura_2024_pm25_moyan":  "PM2,5",
  "cartozome:mod_aura_2024_no2_moyan":   "NO2",
  "cartozome:mod_aura_2024_o3_somo35":   "O3 SOMO35",
  "cartozome:Ambroisie_2024_AURA":       "Ambroisie",
  "cartozome:GL_Fer_Lden":              "Bruit ferroviaire LDEN",
  "cartozome:GL_Fer_Ln":               "Bruit ferroviaire LN",
  "cartozome:GL_Rte_Lden":             "Bruit routier LDEN",
  "cartozome:GL_Rte_Ln":               "Bruit routier LN",
  "cartozome:Indus_GL_E4_Lden":        "Bruit industriel LDEN",
};

const LAYER_UNITS = {
  "cartozome:mod_aura_2024_pm10_moyan":  "µg/m³",
  "cartozome:mod_aura_2024_pm25_moyan":  "µg/m³",
  "cartozome:mod_aura_2024_no2_moyan":   "µg/m³",
  "cartozome:mod_aura_2024_o3_somo35":   "µg/m³·j",
  "cartozome:Ambroisie_2024_AURA":       "grains/m³",
  "cartozome:GL_Fer_Lden":              "dB(A)",
  "cartozome:GL_Fer_Ln":               "dB(A)",
  "cartozome:GL_Rte_Lden":             "dB(A)",
  "cartozome:GL_Rte_Ln":               "dB(A)",
  "cartozome:Indus_GL_E4_Lden":        "dB(A)",
};

// =============================================
// CARTE
// =============================================
const METROPOLE_BOUNDS = L.latLngBounds(
  [45.45, 4.65],
  [46.00, 5.25]
);

const map = L.map('map', {
  maxBounds:          METROPOLE_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom:            10,
  maxZoom:            18,
}).setView([45.757295, 4.832391], 11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// --- UV : charge une première fois, puis met à jour quand la carte bouge
updateUvFromMapCenter(map);
map.on("moveend", () => updateUvFromMapCenter(map));

const GEOSERVER_URL = "http://localhost:8081/geoserver/wms";
const GEOSERVER_WFS = "http://localhost:8081/geoserver/wfs";

// =============================================
// GESTION DES COUCHES (WMS + WFS)
// =============================================
const layerInstances = {};

function createWMSLayer(layerName) {
  return L.tileLayer.betterWms(GEOSERVER_URL, {
    layers:      layerName,
    transparent: true,
    format:      "image/png",
    opacity:     0.7,
    version:     "1.1.1",
  });
}

async function createWFSLayer(layerName) {
  const params = new URLSearchParams({
    service:      "WFS",
    version:      "2.0.0",
    request:      "GetFeature",
    typeNames:    layerName,
    outputFormat: "application/json",
    srsName:      "EPSG:4326"
  });

  const url = `${GEOSERVER_WFS}?${params}`;
  console.log(`[WFS] Requête : ${url}`);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`[WFS] Erreur HTTP ${response.status} pour ${layerName}`);

  const geojson = await response.json();
  if (!geojson.features || geojson.features.length === 0) return L.geoJSON();

  return L.geoJSON(geojson, {
    style: { color: "#5b6eae", weight: 1.5, opacity: 0.9, fillColor: "#7f8c8d", fillOpacity: 0.4 }
  });
}

async function initLayer(layerName, isWFS) {
  return isWFS ? await createWFSLayer(layerName) : createWMSLayer(layerName);
}

document.querySelectorAll('.layer-checkbox').forEach(checkbox => {
  const layerName = checkbox.dataset.layer;
  const isWFS = checkbox.dataset.type === "wfs";

  if (checkbox.checked) {
    initLayer(layerName, isWFS).then(layer => {
      layerInstances[layerName] = layer;
      map.addLayer(layer);
    }).catch(err => console.error(err));
  }

  checkbox.addEventListener('change', async function () {
    if (this.checked) {
      if (!layerInstances[layerName]) layerInstances[layerName] = await initLayer(layerName, isWFS);
      map.addLayer(layerInstances[layerName]);
    } else {
      if (layerInstances[layerName]) map.removeLayer(layerInstances[layerName]);
    }
  });
});

// =============================================
// ACCORDÉON CATEGORIES
// =============================================
document.querySelectorAll('.category-toggle').forEach(btn => {
  btn.addEventListener('click', function () {
    const layersDiv = document.getElementById(this.dataset.target);
    layersDiv.classList.toggle('hidden');
    this.classList.toggle('closed');
  });
});

// =============================================
// ACCORDÉON SOUS-CATÉGORIES
// =============================================
document.querySelectorAll('.subcategory-toggle').forEach(btn => {
  btn.addEventListener('click', function () {
    const layersDiv = document.getElementById(this.dataset.target);
    layersDiv.classList.toggle('hidden');
    this.classList.toggle('closed');
  });
});

// =============================================
// GÉOLOCALISATION
// =============================================
const geoButtons = [
  {btn: "geolocate-point", input: "point-start"},
  {btn: "geolocate-start", input: "route-start"},
  {btn: "geolocate-end", input: "route-end"}
];

geoButtons.forEach(({btn, input}) => {
  document.getElementById(btn).addEventListener("click", () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        document.getElementById(input).value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      }, err => alert("Impossible de récupérer la position : " + err.message));
    } else {
      alert("La géolocalisation n'est pas supportée par ce navigateur.");
    }
  });
});

// =============================================
// ÉCHELLE LEAFLET
// =============================================
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

// =============================================
// POPUPS D'INFORMATION
// =============================================
const popup = document.createElement('div');
popup.id = 'info-popup';
popup.innerHTML = `
  <div id="popup-box">
    <button id="popup-close">✕</button>
    <div id="popup-content"></div>
  </div>
`;
document.body.appendChild(popup);

document.querySelectorAll('.category-info-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();

    const catId = btn.dataset.cat;
    const content = document.getElementById(`info-${catId}`).innerHTML;

    document.getElementById('popup-content').innerHTML = content;
    popup.classList.add('visible');
  });
});

document.getElementById('popup-close').addEventListener('click', () => {
  popup.classList.remove('visible');
});
document.getElementById('popup-close').addEventListener('click', () => popup.classList.remove('visible'));

// =============================================
// CALCUL EXPOSOME (GÉOCODAGE + ITINÉRAIRE GEOF)
// =============================================

// Couche dédiée aux résultats (marqueurs + trajet)
const routingLayer = L.layerGroup().addTo(map);

// --- GÉOCODAGE ---
async function geocodeAddress(query) {
  try {
    const res = await fetch(
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=1`
    );
    const data = await res.json();

    if (!data.features || data.features.length === 0) return null;

    return data.features[0].geometry.coordinates; // [lon, lat]
  } catch (err) {
    console.error("[GEOCODE ERROR]", err);
    return null;
  }
}

// --- ROUTING ---
async function getRoute(start, end) {
  const url =
    `https://data.geopf.fr/navigation/itineraire?resource=bdtopo-osrm` +
    `&start=${start.join(',')}` +
    `&end=${end.join(',')}` +
    `&profile=pedestrian` +
    `&crs=EPSG:4326`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.geometry?.coordinates ?? null;
  } catch (err) {
    console.error("[ROUTING ERROR]", err);
    return null;
  }
}

// =============================================
// BOUTON "CALCULER L'EXPOSOME"
// =============================================
document.addEventListener("DOMContentLoaded", () => {

  const exposomeBtn = document.getElementById("calc-exposome-btn");

  if (!exposomeBtn) {
    console.error("Bouton calc-exposome-btn introuvable !");
    return;
  }

  exposomeBtn.addEventListener("click", async () => {

    console.log("Calcul exposome lancé ✅");

    routingLayer.clearLayers();

    const startInput = document.getElementById("address-start").value.trim();
    const endInput   = document.getElementById("address-end").value.trim();

    if (!startInput) {
      alert("Veuillez saisir une adresse de départ");
      return;
    }

    // --- Départ ---
    const startCoords = await geocodeAddress(startInput);

    if (!startCoords) {
      alert("Adresse de départ introuvable");
      return;
    }

    const startLatLng = L.latLng(startCoords[1], startCoords[0]);

    L.marker(startLatLng)
      .addTo(routingLayer)
      .bindPopup("Départ")
      .openPopup();

    // --- Si pas d'arrivée : juste zoom ---
    if (!endInput) {
      map.setView(startLatLng, 16);
      return;
    }

    // --- Arrivée ---
    const endCoords = await geocodeAddress(endInput);

    if (!endCoords) {
      alert("Adresse d'arrivée introuvable");
      return;
    }

    const endLatLng = L.latLng(endCoords[1], endCoords[0]);

    L.marker(endLatLng)
      .addTo(routingLayer)
      .bindPopup("Arrivée");

    // --- Calcul itinéraire ---
    const routeCoords = await getRoute(startCoords, endCoords);

    if (!routeCoords) {
      alert("Impossible de calculer l'itinéraire");
      return;
    }

    const latLngs = routeCoords.map(coord => [coord[1], coord[0]]);

    const routeLine = L.polyline(latLngs, {
      color: "red",
      weight: 4
    }).addTo(routingLayer);

    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

  });

});
