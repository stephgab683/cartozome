import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

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
const categoryInfo = {
  'cat-air': {
    titre:   "Pollution de l'air",
    icone:   "💨",
    contenu: `Lorem ipsum...`
  },
  'cat-pollen': {
    titre:   "Pollen",
    icone:   "🌿",
    contenu: `Lorem ipsum...`
  },
  'cat-bruit': {
    titre:   "Bruit",
    icone:   "🔊",
    contenu: `Lorem ipsum...`
  }
};

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

document.querySelectorAll('.category-info-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const cat = categoryInfo[btn.dataset.cat];
    document.getElementById('popup-title').textContent = `${cat.icone} ${cat.titre}`;
    document.getElementById('popup-content').textContent = cat.contenu;
    popup.classList.add('visible');
  });
});

document.getElementById('popup-close').addEventListener('click', () => popup.classList.remove('visible'));