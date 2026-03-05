import 'leaflet/dist/leaflet.css';                                           // Import du CSS de Leaflet pour le style des cartes
import L from 'leaflet';                                                     // Import de la bibliothèque Leaflet pour la gestion des cartes


// =============================================
// CARTE LEAFLET
// Centrée sur Lyon, limitée aux bounds de la
// métropole (pan + zoom bloqués hors zone).
// Fond de carte OpenStreetMap.
// =============================================

// Bounds de la métropole de Lyon — utilisées aussi pour filtrer l'autocomplétion
const METROPOLE_BOUNDS = L.latLngBounds(
  [45.45, 4.65],
  [46.00, 5.25]
);

const map = L.map('map', {
  maxBounds:          METROPOLE_BOUNDS,
  maxBoundsViscosity: 1.0,                                                   // Empêche de sortir des bounds
  minZoom:            10,
  maxZoom:            18,
}).fitBounds(METROPOLE_BOUNDS);                                      // Vue initiale centrée sur Lyon

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// =============================================
// COMMUNES UV (GeoJSON servi par Caddy)
// Endpoint : /DATA_API/communes_uv.geojson
// =============================================

const COMMUNES_UV_URL = "/DATA_API/communes_uv.geojson";

function getUvColor(uv) {

  if (uv === null || uv === undefined) return "#e0e0e0"; // gris (aucune donnée)

  if (uv < 2) return "#8bc34a";       // faible
  if (uv < 5) return "#ffeb3b";       // modéré
  if (uv < 7) return "#ff9800";       // élevé
  if (uv < 10) return "#f44336";      // très élevé
  return "#9c27b0";                   // extrême
}

function styleCommunes(feature) {

  const uv = feature.properties?.uv_max;

  return {
    fillColor: getUvColor(uv),
    weight: 1,
    opacity: 1,
    color: "#555",
    fillOpacity: 0.6
  };
}

async function loadCommunesUV() {
  try {
    const res = await fetch(COMMUNES_UV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`GeoJSON HTTP ${res.status}`);
    const geojson = await res.json();
    L.geoJSON(geojson, {
      style: styleCommunes
    }).addTo(map);
    console.log("[UV COMMUNES] couche chargée");
  } catch (err) {
    console.error("[UV COMMUNES] erreur :", err);
  }
}

loadCommunesUV();

// Barre d'échelle en bas à gauche (unités métriques uniquement)
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

// LayerGroup qui accueille les marqueurs et la polyligne de l'itinéraire.
// Effacé à chaque nouvelle recherche.
const routingLayer = L.layerGroup().addTo(map);

// =============================================
// ICÔNES MARQUEURS PERSONNALISÉES
// Les SVG sont définis dans des <template> dans
// le HTML. markerIcon() clone le contenu du template 
// et crée une icône Leaflet de type divIcon.
// iconAnchor [16,40] : pointe du pin sur le sol
// popupAnchor [0,-40] : popup au-dessus du pin
// =============================================

// Crée une icône Leaflet à partir d'un <template> HTML
function markerIcon(templateId) {
  const svg = document.getElementById(templateId).innerHTML; // Récupère le SVG du template
  return L.divIcon({
    className:   '',          // Pas de classe CSS par défaut (évite le carré blanc Leaflet)
    html:        svg,
    iconSize:    [32, 40],
    iconAnchor:  [16, 40],    // Point d'ancrage : bas centre du pin
    popupAnchor: [0, -40],    // Popup s'affiche au-dessus du pin
  });
}

const iconPoint   = markerIcon('tpl-marker-point');   // Pin bleu, point unique
const iconCompareA = markerIcon('tpl-marker-compare-a'); // Pin vert, point A comparaison
const iconCompareB = markerIcon('tpl-marker-compare-b'); // Pin rouge, point B comparaison
const iconDepart  = markerIcon('tpl-marker-depart');  // Pin vert, départ itinéraire
const iconArrivee = markerIcon('tpl-marker-arrivee'); // Pin rouge, arrivée itinéraire


// =============================================
// EXTENSION BETTERWMS
// Extension de L.TileLayer.WMS qui ajoute le
// support du clic pour interroger GeoServer
// via GetFeatureInfo et afficher la valeur
// de la couche à l'endroit cliqué dans une popup
// =============================================
L.TileLayer.BetterWMS = L.TileLayer.WMS.extend({

  // Branche l'écouteur de clic à l'ajout de la couche
  onAdd: function (map) {
    L.TileLayer.WMS.prototype.onAdd.call(this, map);
    map.on('click', this.getFeatureInfo, this);
  },

  // Retire l'écouteur de clic à la suppression de la couche
  onRemove: function (map) {
    L.TileLayer.WMS.prototype.onRemove.call(this, map);
    map.off('click', this.getFeatureInfo, this);
  },

  // Construit l'URL GetFeatureInfo et lance la requête
  getFeatureInfo: function (evt) {
    const url  = this.getFeatureInfoUrl(evt.latlng);
    const show = this.showGetFeatureInfo.bind(this);
    fetch(url)
      .then(r => r.json())
      .then(data => show(null, evt.latlng, data))
      .catch(err => show(err));
  },

  // Construit les paramètres WMS GetFeatureInfo
  // Adapte les paramètres i/j ou x/y selon la version WMS (1.1.1 vs 1.3.0)
  getFeatureInfoUrl: function (latlng) {
    const point = this._map.latLngToContainerPoint(latlng, this._map.getZoom());
    const size  = this._map.getSize();
    const v     = this.wmsParams.version;

    const params = {
      request:       'GetFeatureInfo',
      service:       'WMS',
      srs:           'EPSG:4326',
      styles:        this.wmsParams.styles,
      transparent:   this.wmsParams.transparent,
      version:       v,
      format:        this.wmsParams.format,
      bbox:          this._map.getBounds().toBBoxString(),
      height:        size.y,
      width:         size.x,
      layers:        this.wmsParams.layers,
      query_layers:  this.wmsParams.layers,
      info_format:   'application/json',
      feature_count: 1,
    };

    params[v === '1.3.0' ? 'i' : 'x'] = Math.round(point.x);
    params[v === '1.3.0' ? 'j' : 'y'] = Math.round(point.y);

    return this._url + L.Util.getParamString(params, this._url, true);
  },

  // Affiche la valeur numérique de la couche dans une popup Leaflet
  // Utilise LAYER_LABELS et LAYER_UNITS pour formater l'affichage
  showGetFeatureInfo: function (err, latlng, data) {
    if (err) { console.error('[BetterWMS]', err); return; }

    const features = data?.features;
    if (!features || features.length === 0) return;

    const props = features[0].properties;
    const entry = Object.entries(props).find(([, v]) => typeof v === 'number');
    if (!entry) return;

    const [, val] = entry;
    const label   = LAYER_LABELS[this.wmsParams.layers] ?? this.wmsParams.layers;
    const unit    = LAYER_UNITS[this.wmsParams.layers]  ?? "";

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

// Raccourci de création pour BetterWMS
L.tileLayer.betterWms = function (url, options) {
  return new L.TileLayer.BetterWMS(url, options);
};


// =============================================
// GESTION DES COUCHES (WMS + WFS)
// Les instances sont mises en cache dans
// layerInstances pour éviter de recharger
// une couche déjà initialisée.
// Une seule couche peut être active à la fois.
// =============================================

// Noms affichés dans la popup de clic (GetFeatureInfo)
const LAYER_LABELS = {
  "cartozome:mod_aura_2024_pm10_moyan":  "PM10",
  "cartozome:mod_aura_2024_pm25_moyan":  "PM2,5",
  "cartozome:mod_aura_2024_no2_moyan":   "NO2",
  "cartozome:mod_aura_2024_o3_somo35":   "O3 SOMO35",
  "cartozome:Ambroisie_2024_AURA":       "Ambroisie",
  // Multi-taxons
  // Graminées
  // Olivier
  // Bouleau
  // Aulne
  // Armoise
  "cartozome:sous_indice_multibruit_orhane_2023":"Bruit",
};

// Unités affichées dans la popup de clic
const LAYER_UNITS = {
  "cartozome:mod_aura_2024_pm10_moyan":  "µg/m³",
  "cartozome:mod_aura_2024_pm25_moyan":  "µg/m³",
  "cartozome:mod_aura_2024_no2_moyan":   "µg/m³",
  "cartozome:mod_aura_2024_o3_somo35":   "µg/m³·j",
  "cartozome:Ambroisie_2024_AURA":       "grains/m³",
  // Multi-taxons
  // Graminées
  // Olivier
  // Bouleau
  // Aulne
  // Armoise
  "cartozome:sous_indice_multibruit_orhane_2023":"dB(A)",

};

// URLs GeoServer local (WMS pour les rasters, WFS pour le bruit aérien)
const GEOSERVER_URL = "http://localhost:8081/geoserver/wms";
const GEOSERVER_WFS = "http://localhost:8081/geoserver/wfs";

const layerInstances = {};                                                   // Cache des instances de couches déjà chargées

// Crée une couche WMS avec support GetFeatureInfo (BetterWMS)
function createWMSLayer(layerName) {
  return L.tileLayer.betterWms(GEOSERVER_URL, {
    layers:      layerName,
    transparent: true,
    format:      "image/png",
    opacity:     0.7,
    version:     "1.1.1",
  });
}

// Récupère les features WFS depuis GeoServer et crée un layer GeoJSON
// Utilisé uniquement pour les couches bruit aérien (data-type="wfs")
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

// Sélectionne WMS ou WFS selon le type de la couche
async function initLayer(layerName, isWFS) {
  return isWFS ? await createWFSLayer(layerName) : createWMSLayer(layerName);
}

// Écoute les changements sur les checkboxes de couches.
// Au cochage : retire toutes les autres couches, ajoute la nouvelle.
// Au décochage : retire la couche de la carte.
document.querySelectorAll('.layer-checkbox').forEach(checkbox => {
  const layerName = checkbox.dataset.layer;
  const isWFS     = checkbox.dataset.type === "wfs";

  checkbox.addEventListener('change', async function () {
    if (this.checked) {
      // Décoche et retire toutes les autres couches actives
      document.querySelectorAll('.layer-checkbox').forEach(other => {
        if (other !== this && other.checked) {
          other.checked = false;
          if (layerInstances[other.dataset.layer]) {
            map.removeLayer(layerInstances[other.dataset.layer]);
          }
        }
      });
      // Initialise la couche si pas encore en cache, puis l'ajoute
      if (!layerInstances[layerName]) layerInstances[layerName] = await initLayer(layerName, isWFS);
      map.addLayer(layerInstances[layerName]);
    } else {
      if (layerInstances[layerName]) map.removeLayer(layerInstances[layerName]);
    }
  });
});

// Accordéon : un seul groupe ouvert à la fois.
// Cliquer sur un groupe ouvert le referme.
document.querySelectorAll('.layer-group-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const clickedGroup   = btn.closest('.layer-group');
    const clickedContent = clickedGroup.querySelector('.layer-group-content');
    const isOpen         = !clickedContent.classList.contains('hidden');

    // Ferme tous les groupes
    document.querySelectorAll('.layer-group').forEach(group => {
      group.querySelector('.layer-group-content').classList.add('hidden');
      group.querySelector('.layer-group-toggle').classList.add('closed');
    });

    // Si le groupe cliqué était fermé, on l'ouvre
    if (isOpen) return;
    clickedContent.classList.remove('hidden');
    btn.classList.remove('closed');
  });
});

// Ouvre/ferme le panneau latéral droit au clic sur le bouton couches
document.getElementById("layers-toggle").addEventListener("click", () => {
  document.getElementById("layers-panel").classList.toggle("hidden");
});


// =============================================
// DONNÉES UV
// Récupère chaque jour l'indice UV max depuis
// un fichier JSON servi par Caddy.
// Endpoint : /data/openmeteo_uv_meteofrance.json
// Source : Météo-France via Open-Meteo
// =============================================

const UV_JSON_URL = "/data/openmeteo_uv_meteofrance.json";                   // URL du fichier JSON contenant les données UV

// Récupère le JSON UV sans cache (données fraîches à chaque appel)
async function fetchUvJson() {
  const res = await fetch(UV_JSON_URL, { cache: "no-store" });               // Récupère le JSON sans utiliser le cache
  if (!res.ok) throw new Error(`UV JSON HTTP ${res.status}`);                // Gère les erreurs HTTP
  return res.json();                                                         // Retourne le JSON parsé
}

// Retourne le point UV le plus proche d'une coordonnée (distance euclidienne)
function closestUvPoint(points, lat, lon) {
  let best   = null;                                                         // Variable pour stocker le meilleur point
  let bestD2 = Infinity;                                                     // Variable pour stocker la meilleure distance au carré
  for (const p of points) {
    const pLat = p?.latitude;                                                // Récupère la latitude du point
    const pLon = p?.longitude;                                               // Récupère la longitude du point
    if (typeof pLat !== "number" || typeof pLon !== "number") continue;      // Ignore si les coordonnées ne sont pas des nombres
    const dLat = pLat - lat;                                                 // Calcule la différence de latitude
    const dLon = pLon - lon;                                                 // Calcule la différence de longitude
    const d2   = dLat * dLat + dLon * dLon;                                 // Calcule la distance au carré (euclidienne)
    if (d2 < bestD2) { bestD2 = d2; best = p; }                             // Met à jour le meilleur point si distance plus petite
  }
  return best;                                                               // Retourne le point le plus proche
}

// Extrait l'indice UV max du jour depuis la structure Open-Meteo
function extractUvMax(point) {
  const uv = point?.daily?.uv_index_max?.[0];                               // Récupère l'indice UV max (peut être null)
  return { uv };
}

// Met à jour l'élément #uv-status avec l'indice UV du point
// le plus proche du centre visible de la carte
async function updateUvFromMapCenter(map) {
  try {
    const points = await fetchUvJson();                                      // Récupère les points UV
    const center = map.getCenter();                                          // Récupère le centre de la carte
    const p      = closestUvPoint(points, center.lat, center.lng);          // Trouve le point UV le plus proche

    if (!p) {                                                                // Si aucun point trouvé
      console.warn("[UV] Aucun point UV trouvé dans le JSON.");
      const el = document.getElementById("uv-status");
      if (el) el.textContent = "Aucune donnée UV.";
      return;
    }

    const { uv } = extractUvMax(p);                                         // Extrait la valeur UV max

    console.log("[UV] Point le plus proche du centre:", {                   // Log les infos du point UV le plus proche
      center: { lat: center.lat, lon: center.lng },
      point:  { lat: p.latitude, lon: p.longitude, location_id: p.location_id ?? null },
      uv_max: uv
    });

    const el = document.getElementById("uv-status");                        // Récupère l'élément DOM pour afficher le statut UV
    if (el) {
      el.textContent = (uv === null || uv === undefined)                    // Met à jour le texte en fonction de la valeur UV
        ? `UV max : très faible`
        : `UV max : ${uv}`;
    }
  } catch (err) {
    console.error("[UV] Erreur de chargement UV:", err);                    // Log l'erreur
    const el = document.getElementById("uv-status");
    if (el) el.textContent = "Erreur de chargement des UV.";
  }
}

// Charge les UV au démarrage puis à chaque déplacement de la carte
updateUvFromMapCenter(map);
map.on("moveend", () => updateUvFromMapCenter(map));


// =============================================
// APIs GOUVERNEMENTALES
// Géocodage, reverse géocodage et calcul
// d'itinéraire via data.geopf.fr
// =============================================

// Convertit une adresse texte en coordonnées [lon, lat]
async function geocodeAddress(query) {
  try {
    const res  = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=1`);
    const data = await res.json();
    if (!data.features || data.features.length === 0) return null;
    return data.features[0].geometry.coordinates;                            // Retourne [lon, lat]
  } catch (err) {
    console.error("[GEOCODE ERROR]", err);
    return null;
  }
}

// Convertit des coordonnées GPS en adresse lisible
// Utilisé par les boutons de géolocalisation
async function reverseGeocode(lat, lon) {
  try {
    const res  = await fetch(`https://data.geopf.fr/geocodage/reverse?lat=${lat}&lon=${lon}&limit=1`);
    const data = await res.json();
    if (!data.features || data.features.length === 0) return null;
    return data.features[0].properties.label;                               // Retourne l'adresse formatée
  } catch (err) {
    console.error("[REVERSE GEOCODE ERROR]", err);
    return null;
  }
}

// Calcule un itinéraire piéton entre deux points via bdtopo-osrm
// Retourne un tableau de coordonnées [lon, lat]
async function getRoute(start, end) {
  const url =
    `https://data.geopf.fr/navigation/itineraire?resource=bdtopo-osrm` +
    `&start=${start.join(',')}` +
    `&end=${end.join(',')}` +
    `&profile=pedestrian` +
    `&crs=EPSG:4326`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    return data.geometry?.coordinates ?? null;
  } catch (err) {
    console.error("[ROUTING ERROR]", err);
    return null;
  }
}

// =============================================
// PANEL DE RÉSULTATS
// S'affiche après validation d'une recherche
// (point, comparaison, itinéraire).
// Positionné dynamiquement sous le search-panel.
// Fermé au clic sur la croix ou au changement
// de mode.
// =============================================
const resultsPanel = document.getElementById("results-panel");

// Positionne et affiche le panel sous le search-panel
function openResultsPanel() {
  const container   = document.getElementById("main-container");
  const panel       = document.getElementById("search-panel");
  const panelRect   = panel.getBoundingClientRect();
  const contRect    = container.getBoundingClientRect();
  resultsPanel.style.top = `${panelRect.bottom - contRect.top + 10}px`;
  resultsPanel.classList.remove("hidden");
}

// Ferme le panel au clic sur la croix
document.getElementById("results-close").addEventListener("click", () => {
  resultsPanel.classList.add("hidden");
});

// =============================================
// RECHERCHE : ADRESSE / COMPARAISON / ITINÉRAIRE
// Trois modes gérés par toggle de classes .hidden
// sur les panels définis dans le HTML.
// Comprend : affichage des panels, géolocalisation,
// autocomplétion et validation des formulaires.
// setAddressMode / setCompareMode / setRouteMode
// =============================================

const btnAddress  = document.getElementById("btn-address");
const btnCompare = document.getElementById("btn-compare");
const btnRoute = document.getElementById("btn-route");
const searchPanel = document.getElementById("search-panel");

// Affiche le panel adresse, cache les autres
function setAddressMode() {
  document.getElementById('panel-address').classList.remove('hidden');
  document.getElementById('panel-compare').classList.add('hidden');
  document.getElementById('panel-route').classList.add('hidden');
  searchPanel.classList.remove('hidden');
  btnAddress.classList.add('active');
  btnCompare.classList.remove('active');
  btnRoute.classList.remove('active');
  resultsPanel.classList.add("hidden");
}

// Affiche le panel comparaison, cache les autres
function setCompareMode() {
  document.getElementById('panel-compare').classList.remove('hidden');
  document.getElementById('panel-address').classList.add('hidden');
  document.getElementById('panel-route').classList.add('hidden');
  searchPanel.classList.remove('hidden');
  btnCompare.classList.add('active');
  btnAddress.classList.remove('active');
  btnRoute.classList.remove('active');
  resultsPanel.classList.add("hidden");
}

// Affiche le panel itinéraire, cache les autres
function setRouteMode() {
  document.getElementById('panel-route').classList.remove('hidden');
  document.getElementById('panel-address').classList.add('hidden');
  document.getElementById('panel-compare').classList.add('hidden');
  searchPanel.classList.remove('hidden');
  btnRoute.classList.add('active');
  btnAddress.classList.remove('active');
  btnCompare.classList.remove('active');
  resultsPanel.classList.add("hidden");
}

// Branche les boutons de géolocalisation sur chaque champ.
// Au clic : récupère la position GPS et remplit le champ via reverse géocodage
function attachGeolocate() {
  const geoButtons = [
    { btn: "geolocate-point", input: "point-start" },
    { btn: "geolocate-compare-a", input: "compare-a" },
    { btn: "geolocate-compare-b", input: "compare-b" },
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

// Validation point unique : géocode l'adresse, place un marqueur, centre la vue.
// TODO : interroger les couches actives pour ce point et afficher les valeurs d'exposition
document.getElementById("calc-point-btn").addEventListener("click", async () => {
  routingLayer.clearLayers();

  const pointInput = document.getElementById("point-start").value.trim();
  if (!pointInput) { alert("Veuillez saisir une adresse"); return; }

  const coords = await geocodeAddress(pointInput);
  if (!coords) { alert("Adresse introuvable"); return; }

  const latLng = L.latLng(coords[1], coords[0]);
  L.marker(latLng, { icon: iconPoint }).addTo(routingLayer).bindPopup("Point sélectionné").openPopup();
  map.setView(latLng, 16);

  console.log("[POINT] Coordonnées :", { lat: coords[1], lon: coords[0] });
  openResultsPanel();
});

// Validation comparaison : géocode les deux points et place deux marqueurs.
// TODO : interroger les couches actives pour chaque point et afficher
// les valeurs d'exposition en comparaison dans le panel de résultats
document.getElementById("calc-compare-btn").addEventListener("click", async () => {
  routingLayer.clearLayers();

  const inputA = document.getElementById("compare-a").value.trim();
  const inputB = document.getElementById("compare-b").value.trim();
  if (!inputA) { alert("Veuillez saisir le Point A"); return; }
  if (!inputB) { alert("Veuillez saisir le Point B"); return; }

  const coordsA = await geocodeAddress(inputA);
  if (!coordsA) { alert("Point A introuvable"); return; }

  const coordsB = await geocodeAddress(inputB);
  if (!coordsB) { alert("Point B introuvable"); return; }

  const latLngA = L.latLng(coordsA[1], coordsA[0]);
  const latLngB = L.latLng(coordsB[1], coordsB[0]);

  L.marker(latLngA, { icon: iconCompareA }).addTo(routingLayer).bindPopup("Point A").openPopup();
  L.marker(latLngB, { icon: iconCompareB }).addTo(routingLayer).bindPopup("Point B");

  // Centre la vue pour afficher les deux points
  const bounds = L.latLngBounds([latLngA, latLngB]);
  map.fitBounds(bounds, { padding: [80, 80] });

  console.log("[COMPARAISON] Point A :", { lat: coordsA[1], lon: coordsA[0] });
  console.log("[COMPARAISON] Point B :", { lat: coordsB[1], lon: coordsB[0] });
  openResultsPanel();
});

// Validation itinéraire : géocode départ et arrivée, trace la route piétonne.
// TODO : échantillonner des points le long de la polyligne et interroger les
// couches actives pour calculer l'exposition moyenne sur le trajet
document.getElementById("calc-route-btn").addEventListener("click", async () => {
  routingLayer.clearLayers();

  const routeStart = document.getElementById("route-start").value.trim();
  const routeEnd   = document.getElementById("route-end").value.trim();
  if (!routeStart) { alert("Veuillez saisir une adresse de départ"); return; }

  const startCoords = await geocodeAddress(routeStart);
  if (!startCoords) { alert("Adresse de départ introuvable"); return; }
  const startLatLng = L.latLng(startCoords[1], startCoords[0]);
  L.marker(startLatLng, { icon: iconDepart }).addTo(routingLayer).bindPopup("Départ").openPopup();

  if (!routeEnd) { map.setView(startLatLng, 16); return; }

  const endCoords = await geocodeAddress(routeEnd);
  if (!endCoords) { alert("Adresse d'arrivée introuvable"); return; }
  const endLatLng = L.latLng(endCoords[1], endCoords[0]);
  L.marker(endLatLng, { icon: iconArrivee }).addTo(routingLayer).bindPopup("Arrivée");

  const routeCoords = await getRoute(startCoords, endCoords);
  if (!routeCoords) { alert("Impossible de calculer l'itinéraire"); return; }

  const latLngs   = routeCoords.map(c => [c[1], c[0]]);
  const routeLine = L.polyline(latLngs, { color: "#1A4E72", weight: 4, opacity: 1 }).addTo(routingLayer);
  map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

  console.log("[ITINÉRAIRE] Coordonnées :", routeCoords);
  openResultsPanel();
});

// Autocomplétion : affiche des suggestions pendant la frappe (délai 250ms).
// Appelle l'API géocodage avec limit=50, filtre côté client sur les bounds métropole.
function attachAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Crée la liste de suggestions et l'accroche au parent du champ
  const list = document.createElement('ul');
  list.className = 'autocomplete-list hidden';
  input.parentNode.style.position = 'relative';
  input.parentNode.appendChild(list);

  let debounceTimer;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();

    if (query.length < 3) { list.classList.add('hidden'); return; }          // Pas de recherche sous 3 caractères

    debounceTimer = setTimeout(async () => {                                  // Délai anti-spam avant d'appeler l'API
      const res  = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=50`);
      const data = await res.json();

      list.innerHTML = '';
      if (!data.features || data.features.length === 0) { list.classList.add('hidden'); return; }

      // Filtre les résultats hors bounds de la métropole de Lyon
      const filtered = data.features.filter(f => {
        const [lon, lat] = f.geometry.coordinates;
        return lat >= 45.45 && lat <= 46.00 && lon >= 4.65 && lon <= 5.25;
      });

      if (filtered.length === 0) { list.classList.add('hidden'); return; }

      filtered.forEach(f => {                                                 // Crée un <li> par suggestion
        const li = document.createElement('li');
        li.textContent = f.properties.label;
        li.addEventListener('mousedown', () => {                              // mousedown avant blur pour que le clic se déclenche
          input.value = f.properties.label;
          list.classList.add('hidden');
        });
        list.appendChild(li);
      });

      list.classList.remove('hidden');
    }, 250);
  });

  // Délai de 150ms pour laisser le mousedown se déclencher avant de cacher
  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.add('hidden'), 150);
  });
}

// Initialisation au chargement
setAddressMode();
attachGeolocate();
attachAutocomplete('point-start');
attachAutocomplete('compare-a');
attachAutocomplete('compare-b');
attachAutocomplete('route-start');
attachAutocomplete('route-end');

btnAddress.addEventListener("click", setAddressMode);
btnCompare.addEventListener("click", setCompareMode);
btnRoute.addEventListener("click", setRouteMode);

