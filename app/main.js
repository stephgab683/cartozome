import 'leaflet/dist/leaflet.css';                                           // Import du CSS de Leaflet pour le style des cartes
import L from 'leaflet';                                                     // Import de la bibliothèque Leaflet pour la gestion des cartes

// =============================================
// UV (JSON servi par Caddy)
// Endpoint: /data/openmeteo_uv_meteofrance.json
// =============================================
const UV_JSON_URL = "/data/openmeteo_uv_meteofrance.json";                   // URL du fichier JSON contenant les données UV

async function fetchUvJson() {                                               // Fonction asynchrone pour récupérer le JSON des UV
  const res = await fetch(UV_JSON_URL, { cache: "no-store" });               // Récupère le JSON sans utiliser le cache
  if (!res.ok) throw new Error(`UV JSON HTTP ${res.status}`);                // Gère les erreurs HTTP
  return res.json();                                                         // Retourne le JSON parsé
}

function closestUvPoint(points, lat, lon) {                                   // Trouve le point UV le plus proche d'une coordonnée
  let best = null;                                                            // Variable pour stocker le meilleur point
  let bestD2 = Infinity;                                                      // Variable pour stocker la meilleure distance au carré
  for (const p of points) {                                                    // Parcourt tous les points
    const pLat = p?.latitude;                                                 // Récupère la latitude du point
    const pLon = p?.longitude;                                                // Récupère la longitude du point
    if (typeof pLat !== "number" || typeof pLon !== "number") continue;       // Ignore si les coordonnées ne sont pas des nombres
    const dLat = pLat - lat;                                                  // Calcule la différence de latitude
    const dLon = pLon - lon;                                                  // Calcule la différence de longitude
    const d2 = dLat * dLat + dLon * dLon;                                    // Calcule la distance au carré (euclidienne)
    if (d2 < bestD2) { bestD2 = d2; best = p; }                               // Met à jour le meilleur point si la distance est plus petite
  }
  return best;                                                                // Retourne le point le plus proche
}

function extractUvMax(point) {                                                // Extrait la valeur UV max d'un point
  const uv = point?.daily?.uv_index_max?.[0];                                 // Récupère l'indice UV max (peut être null)
  return { uv };                                                              // Retourne un objet avec la valeur UV
}

async function updateUvFromMapCenter(map) {                                   // Met à jour l'affichage des UV en fonction du centre de la carte
  try {
    const points = await fetchUvJson();                                       // Récupère les points UV
    const center = map.getCenter();                                           // Récupère le centre de la carte
    const p = closestUvPoint(points, center.lat, center.lng);                 // Trouve le point UV le plus proche

    if (!p) {                                                                 // Si aucun point trouvé
      console.warn("[UV] Aucun point UV trouvé dans le JSON.");               // Log un avertissement
      const el = document.getElementById("uv-status");                        // Récupère l'élément DOM pour afficher le statut UV
      if (el) el.textContent = "Aucune donnée UV.";                           // Met à jour le texte si l'élément existe
      return;                                                                 // Quitte la fonction
    }

    const { uv } = extractUvMax(p);                                          // Extrait la valeur UV max

    console.log("[UV] Point le plus proche du centre:", {                    // Log les infos du point UV le plus proche
      center: { lat: center.lat, lon: center.lng },
      point: { lat: p.latitude, lon: p.longitude, location_id: p.location_id ?? null },
      uv_max: uv
    });

    const el = document.getElementById("uv-status");                          // Récupère l'élément DOM pour afficher le statut UV
    if (el) {                                                                 // Si l'élément existe
      el.textContent = (uv === null || uv === undefined)                      // Met à jour le texte en fonction de la valeur UV
        ? `UV max : très faible`
        : `UV max : ${uv}`;
    }
  } catch (err) {                                                            // Gère les erreurs
    console.error("[UV] Erreur de chargement UV:", err);                     // Log l'erreur
    const el = document.getElementById("uv-status");                         // Récupère l'élément DOM pour afficher le statut UV
    if (el) el.textContent = "Erreur de chargement des UV.";                 // Met à jour le texte en cas d'erreur
  }
}

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
      .setContent(
        `<div style="font-family:'Jost',sans-serif;font-size:0.85rem;line-height:1.8;">
          <b style="color:#1A4E72;">${label}</b><br>
          ${val.toFixed(2)} ${unit}
        </div>`
      )
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

// UV
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
// ACCORDÉON COUCHES
// =============================================
document.querySelectorAll('.layer-group-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const content = btn.closest('.layer-group').querySelector('.layer-group-content');
        content.classList.toggle('hidden');
        btn.classList.toggle('closed');
    });
});

// =============================================
// ÉCHELLE LEAFLET
// =============================================
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

// =============================================
// COUCHE RÉSULTATS (marqueurs + trajet)
// =============================================
const routingLayer = L.layerGroup().addTo(map);

// =============================================
// GÉOCODAGE
// =============================================
async function geocodeAddress(query) {
  try {
    const res = await fetch(
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=1`
    );
    const data = await res.json();
    if (!data.features || data.features.length === 0) return null;
    return data.features[0].geometry.coordinates;                             // [lon, lat]
  } catch (err) {
    console.error("[GEOCODE ERROR]", err);
    return null;
  }
}

// =============================================
// REVERSE GÉOCODAGE
// =============================================
async function reverseGeocode(lat, lon) {
  try {
    const url =
      `https://data.geopf.fr/geocodage/reverse` +
      `?lat=${lat}&lon=${lon}` +
      `&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.features || data.features.length === 0) return null;
    return data.features[0].properties.label;
  } catch (err) {
    console.error("[REVERSE GEOCODE ERROR]", err);
    return null;
  }
}

// =============================================
// ROUTING
// =============================================
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
// ADRESSE / ITINÉRAIRE
// =============================================
const btnAddress  = document.getElementById("btn-address");
const btnRoute    = document.getElementById("btn-route");
const searchPanel = document.getElementById("search-panel");

function attachGeolocate() {
    const geoButtons = [
        { btn: "geolocate-point", input: "point-start" },
        { btn: "geolocate-start", input: "route-start" },
        { btn: "geolocate-end",   input: "route-end"   }
    ];

    geoButtons.forEach(({ btn, input }) => {
        const buttonEl = document.getElementById(btn);
        const inputEl  = document.getElementById(input);
        if (!buttonEl || !inputEl) return;

        buttonEl.addEventListener("click", async () => {
            if (!navigator.geolocation) {
                alert("La géolocalisation n'est pas supportée par ce navigateur.");
                return;
            }
            navigator.geolocation.getCurrentPosition(async pos => {
                const { latitude, longitude } = pos.coords;
                inputEl.value = "Recherche de l'adresse...";
                const address = await reverseGeocode(latitude, longitude);
                if (!address) {
                    alert("Impossible de récupérer l'adresse.");
                    inputEl.value = "";
                    return;
                }
                inputEl.value = address;
            }, err => {
                alert("Impossible de récupérer la position : " + err.message);
            });
        });
    });
}

function attachExposomeBtn() {
    const exposomeBtn = document.getElementById("calc-exposome-btn");
    if (!exposomeBtn) return;

    exposomeBtn.addEventListener("click", async () => {
        console.log("Calcul exposome lancé ✅");
        routingLayer.clearLayers();

        const pointInput = document.getElementById("point-start")?.value.trim();
        const routeStart = document.getElementById("route-start")?.value.trim();
        const routeEnd   = document.getElementById("route-end")?.value.trim();

        // CAS 1 : POINT UNIQUE
        if (pointInput) {
            const coords = await geocodeAddress(pointInput);
            if (!coords) { alert("Adresse introuvable"); return; }
            const latLng = L.latLng(coords[1], coords[0]);
            L.marker(latLng).addTo(routingLayer).bindPopup("Point sélectionné").openPopup();
            map.setView(latLng, 16);
            return;
        }

        // CAS 2 : ITINÉRAIRE
        if (!routeStart) { alert("Veuillez saisir une adresse de départ"); return; }

        const startCoords = await geocodeAddress(routeStart);
        if (!startCoords) { alert("Adresse de départ introuvable"); return; }
        const startLatLng = L.latLng(startCoords[1], startCoords[0]);
        L.marker(startLatLng).addTo(routingLayer).bindPopup("Départ").openPopup();

        if (!routeEnd) { map.setView(startLatLng, 16); return; }

        const endCoords = await geocodeAddress(routeEnd);
        if (!endCoords) { alert("Adresse d'arrivée introuvable"); return; }
        const endLatLng = L.latLng(endCoords[1], endCoords[0]);
        L.marker(endLatLng).addTo(routingLayer).bindPopup("Arrivée");

        const routeCoords = await getRoute(startCoords, endCoords);
        if (!routeCoords) { alert("Impossible de calculer l'itinéraire"); return; }

        const latLngs = routeCoords.map(coord => [coord[1], coord[0]]);
        const routeLine = L.polyline(latLngs, { color: "red", weight: 4 }).addTo(routingLayer);
        map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    });
}

function setAddressMode() {
    searchPanel.innerHTML = `
        <div class="search-row">
            <input type="text" id="point-start" placeholder="Entrer une adresse">
            <button class="geolocate-btn" id="geolocate-point">📍</button>
        </div>
        <button id="calc-exposome-btn">Valider</button>
    `;
    searchPanel.classList.remove("hidden");
    btnAddress.classList.add("active");
    btnRoute.classList.remove("active");
    attachGeolocate();
    attachExposomeBtn();
}

function setRouteMode() {
    searchPanel.innerHTML = `
        <div class="search-row">
            <input type="text" id="route-start" placeholder="Départ">
            <button class="geolocate-btn" id="geolocate-start">📍</button>
        </div>
        <div class="search-row">
            <input type="text" id="route-end" placeholder="Arrivée">
            <button class="geolocate-btn" id="geolocate-end">📍</button>
        </div>
        <button id="calc-exposome-btn">Valider</button>
    `;
    searchPanel.classList.remove("hidden");
    btnRoute.classList.add("active");
    btnAddress.classList.remove("active");
    attachGeolocate();
    attachExposomeBtn();
}

// Mode adresse sélectionné par défaut au chargement
setAddressMode();

btnAddress.addEventListener("click", setAddressMode);
btnRoute.addEventListener("click", setRouteMode);

// =============================================
// TOGGLE LAYERS PANEL
// =============================================
document.getElementById("layers-toggle")
    .addEventListener("click", () => {
        document.getElementById("layers-panel")
        .classList.toggle("hidden");
    });