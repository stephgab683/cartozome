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

// Retourne le point UV le plus proche d'une coordonnée (lat/lon).
// On fait simple (distance euclidienne sur lat/lon), suffisant à l'échelle de la métropole.

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

// Extrait une valeur UV max (si dispo) et une date à partir d'un objet point.
function extractUvMax(point) {                                                // Extrait la valeur UV max d'un point
  const uv = point?.daily?.uv_index_max?.[0];                                 // Récupère l'indice UV max (peut être null)
  return { uv };                                                              // Retourne un objet avec la valeur UV
}

// Debug/affichage : log la valeur UV la plus proche du centre de carte.
// Si un élément #uv-status existe, écrit dedans (sinon, console seulement).

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
L.TileLayer.BetterWMS = L.TileLayer.WMS.extend({                              // Extension de la classe WMS de Leaflet

  onAdd: function (map) {                                                     // Méthode appelée quand la couche est ajoutée à la carte
    L.TileLayer.WMS.prototype.onAdd.call(this, map);                          // Appelle la méthode parent
    map.on('click', this.getFeatureInfo, this);                               // Ajoute un écouteur de clic pour récupérer les infos
  },

  onRemove: function (map) {                                                  // Méthode appelée quand la couche est retirée de la carte
    L.TileLayer.WMS.prototype.onRemove.call(this, map);                       // Appelle la méthode parent
    map.off('click', this.getFeatureInfo, this);                              // Retire l'écouteur de clic
  },

  getFeatureInfo: function (evt) {                                            // Récupère les infos d'une feature après un clic
    const url  = this.getFeatureInfoUrl(evt.latlng);                          // Génère l'URL pour récupérer les infos
    const show = this.showGetFeatureInfo.bind(this);                          // Lie la méthode d'affichage au contexte

    fetch(url)                                                                // Récupère les données
      .then(r => r.json())                                                    // Parse la réponse en JSON
      .then(data => show(null, evt.latlng, data))                             // Affiche les données
      .catch(err => show(err));                                               // Gère les erreurs
  },

  getFeatureInfoUrl: function (latlng) {                                          // Génère l'URL pour récupérer les infos d'une feature
    const point = this._map.latLngToContainerPoint(latlng, this._map.getZoom());  // Convertit les coordonnées en point écran
    const size  = this._map.getSize();                                            // Récupère la taille de la carte
    const v     = this.wmsParams.version;                                         // Récupère la version WMS

    const params = {                                                              // Paramètres de la requête WMS
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

    params[v === '1.3.0' ? 'i' : 'x'] = Math.round(point.x);                // Ajoute la coordonnée X selon la version WMS
    params[v === '1.3.0' ? 'j' : 'y'] = Math.round(point.y);                // Ajoute la coordonnée Y selon la version WMS

    return this._url + L.Util.getParamString(params, this._url, true);       // Retourne l'URL complète
  },

  showGetFeatureInfo: function (err, latlng, data) {                         // Affiche les infos d'une feature
    if (err) { console.error('[BetterWMS]', err); return; }                  // Log l'erreur et quitte si erreur

    const features = data?.features;                                         // Récupère les features
    if (!features || features.length === 0) return;                          // Quitte si pas de features

    const props = features[0].properties;                                         // Récupère les propriétés de la première feature
    const entry = Object.entries(props).find(([, v]) => typeof v === 'number');   // Trouve la première propriété numérique
    if (!entry) return;                                                           

    const [key, val] = entry;                                                     // Déstructure la clé et la valeur
    const label = LAYER_LABELS[this.wmsParams.layers] ?? this.wmsParams.layers;   // Récupère le label de la couche
    const unit  = LAYER_UNITS[this.wmsParams.layers]  ?? "";                      // Récupère l'unité de la couche

    L.popup({ maxWidth: 300 })                                                    // Crée une popup
      .setLatLng(latlng)                                                          // Définit la position de la popup
      .setContent(                                                                // Définit le contenu de la popup
        `<div style="font-family:'Jost',sans-serif;font-size:0.85rem;line-height:1.8;">
          <b style="color:#1A4E72;">${label}</b><br>
          ${val.toFixed(2)} ${unit}
        </div>`
      )
      .openOn(this._map);                                                         // Ouvre la popup sur la carte
  }
});

L.tileLayer.betterWms = function (url, options) {                                 // Méthode utilitaire pour créer une couche BetterWMS
  return new L.TileLayer.BetterWMS(url, options);                                 // Retourne une nouvelle instance de BetterWMS
};

// =============================================
// MÉTADONNÉES DES COUCHES
// =============================================
const LAYER_LABELS = {                                                            // Objet associant les noms des couches à leurs labels
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

const LAYER_UNITS = {                                                           // Objet associant les noms des couches à leurs unités
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
const METROPOLE_BOUNDS = L.latLngBounds(                                      // Définit les limites géographiques de la métropole
  [45.45, 4.65],
  [46.00, 5.25]
);

const map = L.map('map', {                                                    // Crée une nouvelle carte Leaflet
  maxBounds:          METROPOLE_BOUNDS,                                       // Définit les limites maximales de la carte
  maxBoundsViscosity: 1.0,                                                    // Empêche le dépassement des limites
  minZoom:            10,                                                     // Zoom minimal
  maxZoom:            18,                                                     // Zoom maximal
}).setView([45.757295, 4.832391], 11);                                        // Centre la carte sur Lyon avec un zoom de 11

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {          // Ajoute une couche de tuiles OpenStreetMap
  attribution: '&copy; OpenStreetMap contributors'                           // Attribution des crédits
}).addTo(map);

// --- UV : charge une première fois, puis met à jour quand la carte bouge
updateUvFromMapCenter(map);                                                   // Met à jour les UV au chargement
map.on("moveend", () => updateUvFromMapCenter(map));                          // Met à jour les UV quand la carte bouge

const GEOSERVER_URL = "http://localhost:8081/geoserver/wms";                  // URL du serveur GeoServer WMS
const GEOSERVER_WFS = "http://localhost:8081/geoserver/wfs";                  // URL du serveur GeoServer WFS

// =============================================
// GESTION DES COUCHES (WMS + WFS)
// =============================================
const layerInstances = {};                                                    // Objet pour stocker les instances des couches

function createWMSLayer(layerName) {                                          // Fonction d'ajout couche WMS
  return L.tileLayer.betterWms(GEOSERVER_URL, {                               // Utilise BetterWMS
    layers:      layerName,                                                   // Nom de la couche
    transparent: true,                                                        // Fond transparent
    format:      "image/png",                                                 // Format PNG
    opacity:     0.7,                                                         // Opacité à 70%
    version:     "1.1.1",                                                     // Version WMS
  });
}

async function createWFSLayer(layerName) {                                    // Fonction d'ajout couche WFS
  const params = new URLSearchParams({                                        // Crée les paramètres de la requête
    service:      "WFS",
    version:      "2.0.0",
    request:      "GetFeature",
    typeNames:    layerName,
    outputFormat: "application/json",
    srsName:      "EPSG:4326"
  });

  const url = `${GEOSERVER_WFS}?${params}`;                                  // Construit l'URL
  console.log(`[WFS] Requête : ${url}`);                                     // Log l'URL de la requête

  const response = await fetch(url);                                          // Effectue la requête
  if (!response.ok) throw new Error(`[WFS] Erreur HTTP ${response.status} pour ${layerName}`); // Gère les erreurs HTTP

  const geojson = await response.json();                                      // Parse la réponse en JSON
  if (!geojson.features || geojson.features.length === 0) return L.geoJSON(); // Retourne une couche GeoJSON vide si pas de features

  return L.geoJSON(geojson, {                                                 // Crée une couche GeoJSON
    style: { color: "#5b6eae", weight: 1.5, opacity: 0.9, fillColor: "#7f8c8d", fillOpacity: 0.4 } // Style des features
  });
}

async function initLayer(layerName, isWFS) {                                  // Initialise une couche (WMS ou WFS)
  return isWFS ? await createWFSLayer(layerName) : createWMSLayer(layerName); // Crée la couche en fonction du type
}

document.querySelectorAll('.layer-checkbox').forEach(checkbox => {           // Pour chaque checkbox de couche
  const layerName = checkbox.dataset.layer;                                  // Récupère le nom de la couche
  const isWFS = checkbox.dataset.type === "wfs";                             // Vérifie si c'est une couche WFS

  if (checkbox.checked) {                                                    // Si la checkbox est cochée
    initLayer(layerName, isWFS).then(layer => {                              // Initialise la couche
      layerInstances[layerName] = layer;                                     // Stocke l'instance de la couche
      map.addLayer(layer);                                                   // Ajoute la couche à la carte
    }).catch(err => console.error(err));                                     // Gère les erreurs
  }

  checkbox.addEventListener('change', async function () {                     // Écouteur pour le changement d'état de la checkbox
    if (this.checked) {                                                       // Si cochée
      if (!layerInstances[layerName]) layerInstances[layerName] = await initLayer(layerName, isWFS); // Initialise si pas déjà fait
      map.addLayer(layerInstances[layerName]);                                // Ajoute la couche à la carte
    } else {                                                                  // Si décochée
      if (layerInstances[layerName]) map.removeLayer(layerInstances[layerName]); // Retire la couche de la carte
    }
  });
});

// =============================================
// ACCORDÉON CATEGORIES
// =============================================
document.querySelectorAll('.category-toggle').forEach(btn => {               // Pour chaque bouton de catégorie
  btn.addEventListener('click', function () {                                // Écouteur de clic
    const layersDiv = document.getElementById(this.dataset.target);          // Récupère la div cible
    layersDiv.classList.toggle('hidden');                                    // Bascule la classe 'hidden'
    this.classList.toggle('closed');                                         // Bascule la classe 'closed' sur le bouton
  });
});

// =============================================
// ACCORDÉON SOUS-CATÉGORIES
// =============================================
document.querySelectorAll('.subcategory-toggle').forEach(btn => {            // Pour chaque bouton de sous-catégorie
  btn.addEventListener('click', function () {                                // Écouteur de clic
    const layersDiv = document.getElementById(this.dataset.target);          // Récupère la div cible
    layersDiv.classList.toggle('hidden');                                    // Bascule la classe 'hidden'
    this.classList.toggle('closed');                                         // Bascule la classe 'closed' sur le bouton
  });
});

// =============================================
// GÉOLOCALISATION (avec reverse geocoding GéoPF)
// =============================================

async function reverseGeocode(lat, lon) {                                     // Effectue un reverse geocoding
  try {
    const url =                                                               // Construit l'URL de la requête API 
      `https://data.geopf.fr/geocodage/reverse` +
      `?lat=${lat}&lon=${lon}` +
      `&limit=1`;

    const res = await fetch(url);                                             // Effectue la requête
    const data = await res.json();                                            // Parse la réponse

    if (!data.features || data.features.length === 0) return null;            // Retourne null si pas de résultat

    return data.features[0].properties.label;                                // Retourne le label de l'adresse
  } catch (err) {                                                            // Gère les erreurs
    console.error("[REVERSE GEOCODE ERROR]", err);                           // Log l'erreur
    return null;                                                             // Retourne null en cas d'erreur
  }
}

const geoButtons = [                                                         // Liste des boutons de géolocalisation
  {btn: "geolocate-point", input: "point-start"},
  {btn: "geolocate-start", input: "route-start"},
  {btn: "geolocate-end", input: "route-end"}
];

geoButtons.forEach(({btn, input}) => {                                       // Pour chaque bouton

  const buttonEl = document.getElementById(btn);                             // Récupère le bouton
  const inputEl  = document.getElementById(input);                           // Récupère l'input associé

  if (!buttonEl || !inputEl) return;                                         // Quitte si un élément est manquant

  buttonEl.addEventListener("click", async () => {                           // Écouteur de clic

    if (!navigator.geolocation) {                                            // Vérifie la disponibilité de la géolocalisation
      alert("La géolocalisation n'est pas supportée par ce navigateur.");
      return;
    }

    navigator.geolocation.getCurrentPosition(async pos => {                  // Récupère la position actuelle

      const { latitude, longitude } = pos.coords;                            // Récupère les coordonnées

      inputEl.value = "Recherche de l'adresse...";                           // Met à jour l'input pendant la recherche

      const address = await reverseGeocode(latitude, longitude);             // Effectue le reverse geocoding

      if (!address) {                                                        // Si pas d'adresse trouvée
        alert("Impossible de récupérer l'adresse.");
        inputEl.value = "";                                                  // Réinitialise l'input
        return;
      }

      inputEl.value = address;                                               // Met à jour l'input avec l'adresse

    }, err => {                                                              // Gère les erreurs de géolocalisation
      alert("Impossible de récupérer la position : " + err.message);
    });

  });

});

// =============================================
// ÉCHELLE LEAFLET
// =============================================
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);     // Ajoute une échelle de distance en bas à gauche

// =============================================
// CALCUL EXPOSOME (GÉOCODAGE + ITINÉRAIRE GEOF)
// =============================================

// Couche dédiée aux résultats (marqueurs + trajet)
const routingLayer = L.layerGroup().addTo(map);                               // Crée une couche de groupe pour les résultats

// --- GÉOCODAGE ---
async function geocodeAddress(query) {                                       // Géocode une adresse
  try {
    const res = await fetch(                                                  // Effectue la requête de géocodage
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=1`
    );
    const data = await res.json();                                            // Parse la réponse

    if (!data.features || data.features.length === 0) return null;            // Retourne null si pas de résultat

    return data.features[0].geometry.coordinates;                             // Retourne les coordonnées [lon, lat]
  } catch (err) {                                                             // Gère les erreurs
    console.error("[GEOCODE ERROR]", err);                                    // Log l'erreur
    return null;                                                              // Retourne null en cas d'erreur
  }
}

// --- ROUTING ---
async function getRoute(start, end) {                                          // Calcule un itinéraire entre deux points
  const url =                                                                  // Construit l'URL de la requête
    `https://data.geopf.fr/navigation/itineraire?resource=bdtopo-osrm` +
    `&start=${start.join(',')}` +
    `&end=${end.join(',')}` +
    `&profile=pedestrian` +
    `&crs=EPSG:4326`;

  try {
    const res = await fetch(url);                                               // Effectue la requête
    const data = await res.json();                                              // Parse la réponse
    return data.geometry?.coordinates ?? null;                                  // Retourne les coordonnées de l'itinéraire ou null
  } catch (err) {                                                               // Gère les erreurs
    console.error("[ROUTING ERROR]", err);                                      // Log l'erreur
    return null;                                                                // Retourne null en cas d'erreur
  }
}

// =============================================
// BOUTON "CALCULER L'EXPOSOME"
// =============================================
document.addEventListener("DOMContentLoaded", () => {                         // Écouteur pour le chargement du DOM

  const exposomeBtn = document.getElementById("calc-exposome-btn");           // Récupère le bouton de calcul de l'exposome

  if (!exposomeBtn) {                                                         // Si le bouton n'existe pas
    console.error("Bouton calc-exposome-btn introuvable !");                  // Log une erreur
    return;                                                                   // Quitte la fonction
  }

  exposomeBtn.addEventListener("click", async () => {                         // Écouteur de clic sur le bouton

    console.log("Calcul exposome lancé ✅");                                 // Log le début du calcul
    routingLayer.clearLayers();                                               // Efface les couches précédentes

    const pointInput  = document.getElementById("point-start")?.value.trim(); // Récupère la valeur du point unique
    const routeStart  = document.getElementById("route-start")?.value.trim(); // Récupère la valeur du départ de l'itinéraire
    const routeEnd    = document.getElementById("route-end")?.value.trim();   // Récupère la valeur de l'arrivée de l'itinéraire

    // ==============================
    // CAS 1 : POINT UNIQUE
    // ==============================
    if (pointInput) {                                                         // Si un point unique est saisi

      const coords = await geocodeAddress(pointInput);                        // Géocode l'adresse

      if (!coords) {                                                          // Si pas de coordonnées trouvées
        alert("Adresse introuvable");                                         // Affiche une alerte
        return;                                                               // Quitte la fonction
      }

      const latLng = L.latLng(coords[1], coords[0]);                          // Crée un objet LatLng

      L.marker(latLng)                                                        // Crée un marqueur
        .addTo(routingLayer)                                                  // Ajoute le marqueur à la couche
        .bindPopup("Point sélectionné")                                       // Ajoute une popup
        .openPopup();                                                         // Ouvre la popup

      map.setView(latLng, 16);                                                // Centre la carte sur le point
      return;                                                                 // Quitte la fonction
    }

    // ==============================
    // CAS 2 : ITINÉRAIRE
    // ==============================
    if (!routeStart) {                                                        // Si pas d'adresse de départ
      alert("Veuillez saisir une adresse de départ");                         // Affiche une alerte
      return;                                                                 // Quitte la fonction
    }

    const startCoords = await geocodeAddress(routeStart);                      // Géocode l'adresse de départ
    if (!startCoords) {                                                        // Si pas de coordonnées trouvées
      alert("Adresse de départ introuvable");                                  // Affiche une alerte
      return;                                                                  // Quitte la fonction
    }

    const startLatLng = L.latLng(startCoords[1], startCoords[0]);              // Crée un objet LatLng pour le départ

    L.marker(startLatLng)                                                      // Crée un marqueur pour le départ
      .addTo(routingLayer)                                                     // Ajoute le marqueur à la couche
      .bindPopup("Départ")                                                     // Ajoute une popup
      .openPopup();                                                            // Ouvre la popup

    // Si pas d'arrivée → juste zoom
    if (!routeEnd) {                                                          // Si pas d'adresse d'arrivée
      map.setView(startLatLng, 16);                                           // Centre la carte sur le départ
      return;                                                                 // Quitte la fonction
    }

    const endCoords = await geocodeAddress(routeEnd);                         // Géocode l'adresse d'arrivée
    if (!endCoords) {                                                         // Si pas de coordonnées trouvées
      alert("Adresse d'arrivée introuvable");                                 // Affiche une alerte
      return;                                                                 // Quitte la fonction
    }

    const endLatLng = L.latLng(endCoords[1], endCoords[0]);                  // Crée un objet LatLng pour l'arrivée

    L.marker(endLatLng)                                                      // Crée un marqueur pour l'arrivée
      .addTo(routingLayer)                                                    // Ajoute le marqueur à la couche
      .bindPopup("Arrivée");                                                  // Ajoute une popup

    const routeCoords = await getRoute(startCoords, endCoords);               // Calcule l'itinéraire

    if (!routeCoords) {                                                       // Si pas d'itinéraire trouvé
      alert("Impossible de calculer l'itinéraire");                           // Affiche une alerte
      return;                                                                 // Quitte la fonction
    }

    const latLngs = routeCoords.map(coord => [coord[1], coord[0]]);            // Convertit les coordonnées en LatLng

    const routeLine = L.polyline(latLngs, {                                    // Crée une polyligne pour l'itinéraire
      color: "red",                                                            // Couleur rouge
      weight: 4                                                                // Épaisseur de 4px
    }).addTo(routingLayer);                                                    // Ajoute la polyligne à la couche

    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });               // Ajuste la vue pour afficher tout l'itinéraire

  });

});

// // ==============================
// // TEST SIMPLE POST -> POPUP
// // ==============================

// const API_BASE_URL = "http://localhost:8000";

// async function testPostPopup() {
//   try {
//     const response = await fetch(`${API_BASE_URL}/pollution`, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json"
//       },
//       body: JSON.stringify({ test: "hello" })
//     });

//     const data = await response.json();

//     L.popup()
//       .setLatLng(map.getCenter())
//       .setContent(`
//         <b>Test POST réussi ✅</b><br><br>
//         PM2.5 : ${data.pollution["PM2.5"]}<br>
//         NO2 : ${data.pollution["NO2"]}<br>
//         O3 : ${data.pollution["O3"]}
//       `)
//       .openOn(map);

//   } catch (err) {

//     L.popup()
//       .setLatLng(map.getCenter())
//       .setContent(`
//         <b>Erreur POST ❌</b><br>
//         ${err}
//       `)
//       .openOn(map);

//   }
// }

// testPostPopup();


const API_BASE_URL = "http://127.0.0.1:8000";

// Au clic sur la carte
map.on("click", async function (e) {

  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  try {

    const response = await fetch(`${API_BASE_URL}/indicateurs`, {  // attention : endpoint mis à jour
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ latitude: lat, longitude: lon })
    });

    const data = await response.json();

    let content = "<b>Valeurs des couches :</b><br>";

    let hasData = false;

    // Boucle sur toutes les couches
    for (const [layer, value] of Object.entries(data)) {
      if (value !== null && !value.toString().startsWith("Erreur")) {
        hasData = true;
        content += `${layer} : ${value}<br>`;
      } else if (value && value.toString().startsWith("Erreur")) {
        content += `${layer} : <span style="color:red;">${value}</span><br>`;
      } else {
        content += `${layer} : Aucun résultat<br>`;
      }
    }

    if (!hasData) {
      content = "<b>Aucun résultat pour toutes les couches</b>";
    }

    L.popup()
      .setLatLng(e.latlng)
      .setContent(content)
      .openOn(map);

  } catch (error) {

    L.popup()
      .setLatLng(e.latlng)
      .setContent(`<b>Erreur ❌</b><br>${error}`)
      .openOn(map);

  }

});