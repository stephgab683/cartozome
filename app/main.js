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
  minZoom:            10,
  maxZoom:            18,
}).fitBounds(METROPOLE_BOUNDS);                                      // Vue initiale centrée sur Lyon

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// =============================================
// COMMUNES UV 
// =============================================

function getColor(uv) {
  if      (uv >= 11) return '#9c27b0'; // Extreme
  else if (uv >= 8)  return '#f44336'; // Très Fort
  else if (uv >= 6)  return '#ff9800'; // Fort
  else if (uv >= 3)  return '#ffeb3b'; // Modéré
  else if (uv >= 0) return '#8bc34a';  // Faible
  else              return '#FFFFFF';
}

const routingLayer = L.layerGroup().addTo(map);
let uvLayer = null; // variable globale pour la couche UV

// Fonction pour récupérer les données UV et créer la couche GeoJSON
async function loadUvLayer() {
  const res = await fetch("http://localhost:8000/uvCommunes");
  const communesGeojson = await res.json();

  uvLayer = L.geoJSON(communesGeojson, {
    style: feature => {
      const uv = feature.properties.uv;
      return {
        fillColor: getColor(uv), // ta fonction pour définir la couleur selon l'UV
        weight: 1,
        color: "#555",
        fillOpacity: 0.7
      };
    },
    onEachFeature: (feature, layer) => {
      layer.bindPopup(`Commune: ${feature.properties.nom}<br>UV: ${feature.properties.uv}`);
    }
  });
}

// Charger la couche au démarrage
loadUvLayer();

// Échelle
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

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
  "cartozome:sous_indice_multibruit_orhane_2023":"Indice multi-bruit",
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

// =============================================
// LÉGENDE
// Swatches hardcodées pour toutes les couches
// (couleurs extraites des SLD).
// UV : placeholder (palette à définir).
// Légende bruit : barre segmentée hardcodée.
// =============================================

// Définition des légendes en barres dégradées pour les couches Air et Ambroisie.
// stops   : points de couleur du dégradé CSS (position en % + couleur hex)
// min/max : valeurs affichées aux extrémités de la barre
// oms     : valeur du seuil OMS (null si absent) — marqueur vertical + label
// unit    : unité affichée à droite de la valeur max
const LAYER_LEGENDS = {

  "cartozome:mod_aura_2024_pm25_moyan": {
    unit: "µg/m³", oms: 5,
    entries: [
      { color: '#5C85A1', label: '0'   },
      { color: '#5FB0A9', label: '3'   },
      { color: '#DEDB6D', label: '4'   },
      { color: '#D47979', label: '5'   },
      { color: '#A83939', label: '6'   },
      { color: '#BD37AC', label: '>25' },
    ]
  },

  "cartozome:mod_aura_2024_pm10_moyan": {
    unit: "µg/m³", oms: 15,
    entries: [
      { color: '#5C85A1', label: '0'    },
      { color: '#5FB0A9', label: '8'    },
      { color: '#DEDB6D', label: '11'   },
      { color: '#D47979', label: '15'   },
      { color: '#A83939', label: '16'   },
      { color: '#BD37AC', label: '>35'  },
    ]
  },

  "cartozome:mod_aura_2024_no2_moyan": {
    unit: "µg/m³", oms: 10,
    entries: [
      { color: '#5C85A1', label: '0'    },
      { color: '#5FB0A9', label: '5'    },
      { color: '#DEDB6D', label: '7'    },
      { color: '#D47979', label: '10'   },
      { color: '#A83939', label: '11'   },
      { color: '#BD37AC', label: '>40'  },
    ]
  },

  "cartozome:mod_aura_2024_o3_somo35": {
    unit: "µg/m³·j", oms: null,
    entries: [
      { color: '#5FB0A9', label: '0'    },
      { color: '#DEDB6D', label: '4k'   },
      { color: '#D47979', label: '6k'   },
      { color: '#A83939', label: '7k'   },
    ]
  },

  "cartozome:Ambroisie_2024_AURA": {
    unit: "grains/m³", oms: null, centerLabels: true,
    entries: [
      { color: '#b2e0e8', label: 'Très faible (0 – 3)'    },
      { color: '#7ecdc2', label: 'Faible (3 – 30)'         },
      { color: '#f5e96a', label: 'Modéré (30 – 50)'        },
      { color: '#f4846a', label: 'Élevé (50 – 250)'        },
      { color: '#c0392b', label: 'Très élevé (250 – 500)'  },
      { color: '#8e44ad', label: 'Extrêmement élevé (>500)'},
    ]
  },

  "cartozome:sous_indice_multibruit_orhane_2023": {
    unit: "dB(A)", oms: null, centerLabels: true,
    entries: [
      { color: '#78c679', label: 'Zone préservée ou Absence de données' },
      { color: '#addd8e', label: 'Zone peu altérée'                     },
      { color: '#fed976', label: 'Zone moyennement altérée'             },
      { color: '#fd8d3c', label: 'Zone altérée'                         },
      { color: '#e31a1c', label: 'Zone dégradée'                        },
      { color: '#800026', label: 'Zone très dégradée'                   },
      { color: '#54278f', label: 'Zone hautement dégradée'              },
    ]
  },

  // ── Autres taxons pollen (à décommenter quand les couches seront actives) ──
  // Seuils communs Aulne / Bouleau : 0-10 / 10-60 / 60-100 / 100-500 / 500-1000 / >1000
  // "cartozome:Aulne_2024_AURA": {
  //   unit: "grains/m³", oms: null, centerLabels: true,
  //   entries: [
  //     { color: '#b2e0e8', label: 'Très faible (0 – 10)'      },
  //     { color: '#7ecdc2', label: 'Faible (10 – 60)'           },
  //     { color: '#f5e96a', label: 'Modéré (60 – 100)'          },
  //     { color: '#f4846a', label: 'Élevé (100 – 500)'          },
  //     { color: '#c0392b', label: 'Très élevé (500 – 1000)'    },
  //     { color: '#8e44ad', label: 'Extrêmement élevé (> 1000)' },
  //   ]
  // },
  // Seuils Armoise / Graminées / Ambroisie : 0-3 / 3-30 / 30-50 / 50-250 / 250-500 / >500
  // "cartozome:Armoise_2024_AURA": {
  //   unit: "grains/m³", oms: null, centerLabels: true,
  //   entries: [
  //     { color: '#b2e0e8', label: 'Très faible (0 – 3)'       },
  //     { color: '#7ecdc2', label: 'Faible (3 – 30)'            },
  //     { color: '#f5e96a', label: 'Modéré (30 – 50)'           },
  //     { color: '#f4846a', label: 'Élevé (50 – 250)'           },
  //     { color: '#c0392b', label: 'Très élevé (250 – 500)'     },
  //     { color: '#8e44ad', label: 'Extrêmement élevé (> 500)'  },
  //   ]
  // },
  // "cartozome:Graminees_2024_AURA": {
  //   unit: "grains/m³", oms: null, centerLabels: true,
  //   entries: [
  //     { color: '#b2e0e8', label: 'Très faible (0 – 3)'       },
  //     { color: '#7ecdc2', label: 'Faible (3 – 30)'            },
  //     { color: '#f5e96a', label: 'Modéré (30 – 50)'           },
  //     { color: '#f4846a', label: 'Élevé (50 – 250)'           },
  //     { color: '#c0392b', label: 'Très élevé (250 – 500)'     },
  //     { color: '#8e44ad', label: 'Extrêmement élevé (> 500)'  },
  //   ]
  // },
  // Seuils Bouleau : 0-10 / 10-60 / 60-100 / 100-500 / 500-1000 / >1000
  // "cartozome:Bouleau_2024_AURA": {
  //   unit: "grains/m³", oms: null, centerLabels: true,
  //   entries: [
  //     { color: '#b2e0e8', label: 'Très faible (0 – 10)'      },
  //     { color: '#7ecdc2', label: 'Faible (10 – 60)'           },
  //     { color: '#f5e96a', label: 'Modéré (60 – 100)'          },
  //     { color: '#f4846a', label: 'Élevé (100 – 500)'          },
  //     { color: '#c0392b', label: 'Très élevé (500 – 1000)'    },
  //     { color: '#8e44ad', label: 'Extrêmement élevé (> 1000)' },
  //   ]
  // },
  // Seuils Olivier : 0-20 / 20-100 / 100-200 / 200-500 / 500-1000 / >1000
  // "cartozome:Olivier_2024_AURA": {
  //   unit: "grains/m³", oms: null, centerLabels: true,
  //   entries: [
  //     { color: '#b2e0e8', label: 'Très faible (0 – 20)'      },
  //     { color: '#7ecdc2', label: 'Faible (20 – 100)'          },
  //     { color: '#f5e96a', label: 'Modéré (100 – 200)'         },
  //     { color: '#f4846a', label: 'Élevé (200 – 500)'          },
  //     { color: '#c0392b', label: 'Très élevé (500 – 1000)'    },
  //     { color: '#8e44ad', label: 'Extrêmement élevé (> 1000)' },
  //   ]
  // },

  "uvLayer": {
    unit: null, oms: null, centerLabels: true,
    entries: [
      { color: '#8bc34a', label: 'Faible (0 – 2)'    },
      { color: '#ffeb3b', label: 'Modéré (3 – 5)'    },
      { color: '#ff9800', label: 'Fort (6 – 7)'      },
      { color: '#f44336', label: 'Très fort (8 – 10)'},
      { color: '#9c27b0', label: 'Extrême (≥ 11)'    },
    ]
  },

};


/**
 * Construit le HTML de la légende pour un data-layer donné.
 */
function buildLegendHTML(layerName) {

  // UV → même logique que les autres couches

  // Autres couches → barre dégradée
  const def = LAYER_LEGENDS[layerName];
  if (!def) return '';
  return buildSegmentedBar(def);
}

/**
 * Barre segmentée couleurs pleines.
 * Les labels sont placés aux bordures entre cases (left: 0%, 1/n*100%, 2/n*100%…).
 * Seuil OMS affiché au-dessus de la barre avec flèche, aligné sur la bordure OMS.
 */
function buildSegmentedBar(def) {
  const n = def.entries.length;

  const segments = def.entries.map((e, i) => {
    const radius = i === 0 ? '4px 0 0 4px' : i === n - 1 ? '0 4px 4px 0' : '0';
    return `<div class="lgd-seg" style="background:${e.color};opacity:${LAYER_OPACITY};border-radius:${radius};flex:1"></div>`;
  }).join('');

  // Mode columnLabels : liste verticale case + label (bruit)
  if (def.centerLabels) {
    const unitLabel = def.unit ? `<div class="lgd-col-unit">${def.unit}</div>` : '';
    const rows = def.entries.map((e, i) => {
      return `<div class="lgd-col-row">
        <span class="lgd-col-swatch" style="background:${e.color};opacity:${LAYER_OPACITY}"></span>
        <span class="lgd-col-label">${e.label}</span>
      </div>`;
    }).join('');
    return `<div class="lgd-col-list">${unitLabel}${rows}</div>`;
  }

  // Mode défaut : labels aux bordures gauches + seuil OMS au-dessus
  const borderLabels = def.entries.map((e, i) => {
    const pct = (i / n) * 100;
    return `<span class="lgd-border-label" style="left:${pct}%">${e.label}</span>`;
  }).join('');

  const omsIdx = def.oms != null
    ? def.entries.findIndex(e => e.label === String(def.oms))
    : -1;
  const omsAbove = omsIdx >= 0 ? (() => {
    const pct = (omsIdx / n) * 100;
    return `<div class="lgd-oms-above" style="left:${pct}%">
      <span class="lgd-seg-oms">Seuil OMS : ${def.oms} ${def.unit}</span>
    </div>
    <div class="lgd-oms-line" style="left:${pct}%"></div>`;
  })() : '';

  return `
    <div class="lgd-bar-outer">
      ${omsAbove}
      <div class="lgd-seg-bar">${segments}</div>
      <div class="lgd-border-labels">${borderLabels}</div>
    </div>`;
}

/**
 * Affiche la légende dans le layer-group-content de la couche active.
 * Passe null pour tout effacer.
 */
function updateLegend(layerName) {
  document.querySelectorAll('.layer-legend').forEach(el => el.remove());
  if (!layerName) return;

  const checkbox = document.querySelector(`.layer-checkbox[data-layer="${layerName}"]`);
  if (!checkbox) return;
  const content = checkbox.closest('.layer-group-content');
  if (!content) return;

  const html = buildLegendHTML(layerName);
  if (!html) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'layer-legend';
  wrapper.innerHTML = html;
  content.appendChild(wrapper);
}

// URLs GeoServer local (WMS pour les rasters, WFS pour le bruit aérien)
const GEOSERVER_URL = "http://localhost:8081/geoserver/wms";
const GEOSERVER_WFS = "http://localhost:8081/geoserver/wfs";

// =============================================
// GESTION DES COUCHES (WMS + WFS + UV)
// Une seule couche active à la fois
// =============================================

const layerInstances = {}; // Cache des instances déjà initialisées
// Opacité commune couches + légende
const LAYER_OPACITY = 0.7;


// Raccourci pour créer une couche WMS avec BetterWMS
function createWMSLayer(layerName) {
  return L.tileLayer.betterWms(GEOSERVER_URL, {
    layers: layerName,
    transparent: true,
    format: "image/png",
    opacity: LAYER_OPACITY,
    version: "1.1.1",
  });
}

// Crée la couche WFS (GeoJSON) — uniquement pour les UV si tu veux remplacer par WFS plus tard
async function createWFSLayer(layerName) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: layerName,
    outputFormat: "application/json",
    srsName: "EPSG:4326"
  });
  const url = `${GEOSERVER_WFS}?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`[WFS] Erreur HTTP ${response.status} pour ${layerName}`);
  const geojson = await response.json();
  return L.geoJSON(geojson, {
    style: { color: "#5b6eae", weight: 1.5, opacity: 0.9, fillColor: "#7f8c8d", fillOpacity: 0.4 }
  });
}

// Sélectionne le type de couche à initialiser
async function initLayer(layerName, isWFS = false) {
  if (layerName === "uvLayer") return uvLayer; // UV = GeoJSON local
  return isWFS ? await createWFSLayer(layerName) : createWMSLayer(layerName);
}

// Gestion des checkboxes : une seule couche active à la fois
document.querySelectorAll('.layer-checkbox').forEach(checkbox => {
  const layerName = checkbox.dataset.layer;
  const isWFS = checkbox.dataset.type === "wfs";

  checkbox.addEventListener('change', async function() {
    if (this.checked) {
      // Décoche et retire toutes les autres couches
      document.querySelectorAll('.layer-checkbox').forEach(other => {
        if (other !== this && other.checked) {
          other.checked = false;
          const otherLayer = layerInstances[other.dataset.layer];
          if (otherLayer) map.removeLayer(otherLayer);
        }
      });

      // Initialise la couche si pas encore en cache
      if (!layerInstances[layerName]) layerInstances[layerName] = await initLayer(layerName, isWFS);
      map.addLayer(layerInstances[layerName]);

      // Affiche la légende
      updateLegend(layerName);
    } else {
      if (layerInstances[layerName]) map.removeLayer(layerInstances[layerName]);
      updateLegend(null);
    }
  });
});

// Affiche la couche UV si la checkbox est déjà cochée au chargement
const uvCheckbox = document.querySelector('.layer-checkbox[data-layer="uvLayer"]');
if (uvCheckbox && uvCheckbox.checked && uvLayer) {
  map.addLayer(uvLayer);
}

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
  L.marker(latLng, { icon: iconPoint }).addTo(routingLayer);
  map.setView(latLng, 16);

  console.log("[POINT] Coordonnées :", { lat: coords[1], lon: coords[0] });
  openResultsPanel();
  updateResultsForPoint(coords[1], coords[0], pointInput);
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

  L.marker(latLngA, { icon: iconCompareA }).addTo(routingLayer).bindPopup("Point A");
  L.marker(latLngB, { icon: iconCompareB }).addTo(routingLayer).bindPopup("Point B");

  // Centre la vue pour afficher les deux points
  const bounds = L.latLngBounds([latLngA, latLngB]);
  map.fitBounds(bounds, { padding: [80, 80] });

  console.log("[COMPARAISON] Point A :", { lat: coordsA[1], lon: coordsA[0] });
  console.log("[COMPARAISON] Point B :", { lat: coordsB[1], lon: coordsB[0] });
  openResultsPanel();
  updateResultsForPoint(coordsA[1], coordsA[0], inputA);
});

// Validation itinéraire : géocode départ et arrivée, trace la route piétonne.
// TODO : échantillonner des points le long de la polyligne et interroger les
// couches actives pour calculer l'exposition moyenne sur le trajet
// document.getElementById("calc-route-btn").addEventListener("click", async () => {
//   routingLayer.clearLayers();

//   const routeStart = document.getElementById("route-start").value.trim();
//   const routeEnd   = document.getElementById("route-end").value.trim();
//   if (!routeStart) { alert("Veuillez saisir une adresse de départ"); return; }

//   const startCoords = await geocodeAddress(routeStart);
//   if (!startCoords) { alert("Adresse de départ introuvable"); return; }
//   const startLatLng = L.latLng(startCoords[1], startCoords[0]);
//   L.marker(startLatLng, { icon: iconDepart }).addTo(routingLayer).bindPopup("Départ");

//   if (!routeEnd) { map.setView(startLatLng, 16); return; }

//   const endCoords = await geocodeAddress(routeEnd);
//   if (!endCoords) { alert("Adresse d'arrivée introuvable"); return; }
//   const endLatLng = L.latLng(endCoords[1], endCoords[0]);
//   L.marker(endLatLng, { icon: iconArrivee }).addTo(routingLayer).bindPopup("Arrivée");

//   const routeCoords = await getRoute(startCoords, endCoords);
//   if (!routeCoords) { alert("Impossible de calculer l'itinéraire"); return; }

//   const latLngs   = routeCoords.map(c => [c[1], c[0]]);
//   const routeLine = L.polyline(latLngs, { color: "#1A4E72", weight: 4, opacity: 1 }).addTo(routingLayer);
//   map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

//   console.log("[ITINÉRAIRE] Coordonnées :", routeCoords);
//   openResultsPanel();
//   updateResultsForPoint(startCoords[1], startCoords[0], routeStart);
// });


document.getElementById("calc-route-btn").addEventListener("click", async () => {
  routingLayer.clearLayers();

  const routeStart = document.getElementById("route-start").value.trim();
  const routeEnd   = document.getElementById("route-end").value.trim();
  if (!routeStart) { alert("Veuillez saisir une adresse de départ"); return; }

  const startCoords = await geocodeAddress(routeStart);
  if (!startCoords) { alert("Adresse de départ introuvable"); return; }
  const startLatLng = L.latLng(startCoords[1], startCoords[0]);
  L.marker(startLatLng, { icon: iconDepart }).addTo(routingLayer).bindPopup("Départ");

  if (!routeEnd) { map.setView(startLatLng, 16); return; }

  const endCoords = await geocodeAddress(routeEnd);
  if (!endCoords) { alert("Adresse d'arrivée introuvable"); return; }
  const endLatLng = L.latLng(endCoords[1], endCoords[0]);
  L.marker(endLatLng, { icon: iconArrivee }).addTo(routingLayer).bindPopup("Arrivée");

  const routeCoords = await getRoute(startCoords, endCoords);
  if (!routeCoords) { alert("Impossible de calculer l'itinéraire"); return; }

  // Transformation en LatLng pour Leaflet
  const latLngs = routeCoords.map(c => L.latLng(c[1], c[0]));
  const routeLine = L.polyline(latLngs, { color: "#1A4E72", weight: 4, opacity: 1 }).addTo(routingLayer);
  map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

  // ========== échantillonnage ==========
  function sampleRoutePoints(latlngs, step = 10) {
    const sampled = [];
    for (let i = 0; i < latlngs.length; i += step) {
      sampled.push(latlngs[i]);
    }
    if (latlngs.length > 0 && !sampled.includes(latlngs[latlngs.length-1])) {
      sampled.push(latlngs[latlngs.length-1]);
    }
    return sampled;
  }

  const sampledPoints = sampleRoutePoints(latLngs, 20); // tous les 20 points

  // ========== appel à ton endpoint Python ==========
  const exposures = await fetch("http://localhost:8000/indicateursItineraire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      coords: sampledPoints.map(p => ({ latitude: p.lat, longitude: p.lng }))
    })
  }).then(r => r.json());

  // ========== ajout des markers / popups ==========
  sampledPoints.forEach((p, i) => {
    const data = exposures[i];
    if (!data) return;
    const popupContent = Object.entries(data)
      .filter(([k]) => k !== "latitude" && k !== "longitude")
      .map(([k, v]) => `<b>${k}</b>: ${v}`)
      .join("<br>");

    L.circleMarker([p.lat, p.lng], { radius: 4, color: "#ff9800" })
      .addTo(routingLayer)
      .bindPopup(popupContent);
  });

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


// =============================================
// MÉTADONNÉES POUR LE PANEL DE RÉSULTATS
// min/max : valeurs approx. sur la métropole
// oms     : seuil OMS (null si inexistant)
// thresholds : [seuil_bon, seuil_modéré]
// =============================================
const LAYER_META = {
  "cartozome:mod_aura_2024_pm10_moyan":  { label: "PM10",              unit: "µg/m³",   min: 5,  max: 50,    oms: 15,   thresholds: [15, 30]    },
  "cartozome:mod_aura_2024_pm25_moyan":  { label: "PM2.5",             unit: "µg/m³",   min: 2,  max: 30,    oms: 5,    thresholds: [5, 15]     },
  "cartozome:mod_aura_2024_no2_moyan":   { label: "NO₂",               unit: "µg/m³",   min: 5,  max: 80,    oms: 10,   thresholds: [10, 25]    },
  "cartozome:mod_aura_2024_o3_somo35":   { label: "O₃",                unit: "µg/m³·j", min: 0,  max: 25000, oms: null, thresholds: [10000, 17500] },
  "cartozome:Ambroisie_2024_AURA":       { label: "Ambroisie",         unit: "gr/m³",   min: 0,  max: 20,    oms: null, thresholds: [3, 10]     },
  "cartozome:GL_Rte_Lden":               { label: "Routier (jour)",     unit: "dB",      min: 40, max: 80,    oms: 53,   thresholds: [53, 65]    },
  "cartozome:GL_Fer_Lden":               { label: "Ferroviaire (jour)", unit: "dB",      min: 40, max: 80,    oms: 54,   thresholds: [54, 65]    },
  "cartozome:Indus_GL_E4_Lden":          { label: "Industriel (jour)",  unit: "dB",      min: 40, max: 80,    oms: 70,   thresholds: [70, 75]    },
  "cartozome:GL_Rte_Ln":                 { label: "Routier (nuit)",     unit: "dB",      min: 30, max: 70,    oms: 45,   thresholds: [45, 55]    },
  "cartozome:GL_Fer_Ln":                 { label: "Ferroviaire (nuit)", unit: "dB",      min: 30, max: 70,    oms: 44,   thresholds: [44, 55]    },
};

// Structure des catégories affichées dans le panel
const RESULT_CATEGORIES = [
  {
    label: "Air", icon: "🌫",
    layers: [
      "cartozome:mod_aura_2024_pm10_moyan",
      "cartozome:mod_aura_2024_pm25_moyan",
      "cartozome:mod_aura_2024_no2_moyan",
      "cartozome:mod_aura_2024_o3_somo35",
    ]
  },
  {
    label: "Pollen", icon: "🌿",
    layers: ["cartozome:Ambroisie_2024_AURA"]
  },
  {
    label: "Bruit", icon: "🔊",
    layers: [
      "cartozome:GL_Rte_Lden",
      "cartozome:GL_Fer_Lden",
      "cartozome:Indus_GL_E4_Lden",
      "cartozome:GL_Rte_Ln",
      "cartozome:GL_Fer_Ln",
    ]
  },
];

// Retourne le badge correspondant à la valeur
function getBadge(val, thresholds) {
  if (val <= thresholds[0]) return { label: "Bon",     cls: "badge-low"  };
  if (val <= thresholds[1]) return { label: "Modéré",  cls: "badge-mid"  };
  return                           { label: "Élevé",   cls: "badge-high" };
}

// Construit la barre de légende avec marqueur OMS et marqueur valeur
function buildLegendBar(val, meta) {
  const { min, max, oms, unit } = meta;
  const pct    = v  => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  const valPct = pct(val);
  const omsPct = oms !== null ? pct(oms) : null;

  return `
    <div class="legend-bar-wrap">
      <div class="legend-bar"></div>
      ${omsPct !== null ? `
        <div class="marker-oms" style="left:${omsPct}%"></div>
        <span class="label-oms" style="left:${omsPct}%">OMS ${oms}</span>
      ` : ''}
      <div class="marker-val" style="left:${valPct}%"></div>
      <div class="legend-labels">
        <span>${min}</span>
        <span>${max} ${unit}</span>
      </div>
    </div>`;
}

// Interroge GeoServer en GetFeatureInfo pour un point donné
// Retourne la valeur numérique de la couche, ou null si absent
async function queryLayerAtPoint(layerName, lat, lon) {
  const delta = 0.001; // Petite bbox autour du point
  const bbox  = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

  const params = new URLSearchParams({
    service:       "WMS",
    version:       "1.1.1",
    request:       "GetFeatureInfo",
    layers:        layerName,
    query_layers:  layerName,
    styles:        "",
    bbox:          bbox,
    width:         101,
    height:        101,
    srs:           "EPSG:4326",
    format:        "image/png",
    transparent:   true,
    info_format:   "application/json",
    x:             50,
    y:             50,
    feature_count: 1,
  });

  try {
    const res  = await fetch(`${GEOSERVER_URL}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const features = data?.features;
    if (!features || features.length === 0) return null;
    const entry = Object.entries(features[0].properties).find(([, v]) => typeof v === "number");
    return entry ? entry[1] : null;
  } catch {
    return null;
  }
}

// Construit et injecte le HTML du panel de résultats
// address    : adresse lisible affichée en titre
// layerValues : { layerName: valeur | null }
// uvValue    : indice UV (number | null)
function renderResultsPanel(address, layerValues, uvValue) {
  const content = document.getElementById("results-content");
  const header  = document.getElementById("results-header");

  document.getElementById("results-address").textContent = address;
  document.getElementById("results-close").addEventListener("click", () => {
      resultsPanel.classList.add("hidden");
  });

  document.getElementById("results-close").addEventListener("click", () => {
    resultsPanel.classList.add("hidden");
  });

  let html = ``;

  // Catégories Air, Pollen, Bruit
  for (const cat of RESULT_CATEGORIES) {
    html += `<div class="cat-card">
      <div class="cat-header">${cat.icon} ${cat.label}</div>
      <div class="cat-body">`;

    for (const layerName of cat.layers) {
      const meta = LAYER_META[layerName];
      if (!meta) continue;
      const val = layerValues[layerName];

      html += `<div class="res-row"><div class="res-top">
        <span class="res-label">${meta.label}</span>`;

      if (val === null || val === undefined) {
        html += `<span class="res-value no-data">Non disponible</span>`;
      } else {
        const badge = getBadge(val, meta.thresholds);
        html += `<div class="res-right">
          <span class="res-value">${val.toFixed(1)} ${meta.unit}</span>
          <span class="res-badge ${badge.cls}">${badge.label}</span>
        </div>`;
      }

      html += `</div>`;
      if (val !== null && val !== undefined) html += buildLegendBar(val, meta);
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  // Catégorie UV (données JSON Météo-France)
  html += `<div class="cat-card">
    <div class="cat-header">☀️ UV</div>
    <div class="cat-body">
      <div class="res-row"><div class="res-top">
        <span class="res-label">Indice UV max</span>`;

  if (uvValue === null || uvValue === undefined) {
    html += `<span class="res-value no-data">Non disponible</span>`;
  } else {
    const badge = getBadge(uvValue, [2, 5]);
    html += `<div class="res-right">
      <span class="res-value">${uvValue}</span>
      <span class="res-badge ${badge.cls}">${badge.label}</span>
    </div>`;
  }

  html += `</div>`;
  if (uvValue !== null && uvValue !== undefined) {
    html += buildLegendBar(uvValue, { min: 0, max: 11, oms: null, unit: "" });
  }
  html += `</div></div></div>`;

  content.innerHTML = html;
}

// Interroge toutes les couches pour un point et met à jour le panel
async function updateResultsForPoint(lat, lon, address) {
  // Lance toutes les requêtes en parallèle
  const entries = await Promise.all(
    Object.keys(LAYER_META).map(async layerName => {
      const val = await queryLayerAtPoint(layerName, lat, lon);
      return [layerName, val];
    })
  );
  const layerValues = Object.fromEntries(entries);

  // Récupère la valeur UV depuis le JSON déjà chargé
  let uvValue = null;
  try {
    const points = await fetchUvJson();
    const p      = closestUvPoint(points, lat, lon);
    if (p) uvValue = extractUvMax(p).uv;
  } catch { /* silencieux */ }

  renderResultsPanel(address, layerValues, uvValue);
}

// =============================================
// CLIC SUR LA CARTE -> POPUP INDICATEURS
// =============================================
map.on("click", async (e) => {
  const { lat, lng } = e.latlng;

  try {
    const res = await fetch("http://localhost:8000/indicateursPoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // Construire le contenu HTML de la popup
    let content = `<div style="font-family:'Jost',sans-serif;font-size:0.85rem;line-height:1.4;">`;
    content += `<b style="color:#1A4E72;">Coordonnées :</b> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>`;
    
    for (const [key, value] of Object.entries(data)) {
      content += `<b>${key}</b> : ${value ?? "n/a"}<br>`;
    }
    content += `</div>`;

    L.popup({ maxWidth: 300 })
      .setLatLng([lat, lng])
      .setContent(content)
      .openOn(map);

  } catch (err) {
    console.error("Erreur API indicateurs :", err);
    L.popup()
      .setLatLng([lat, lng])
      .setContent(`<b>Erreur</b> lors de la récupération des indicateurs : ${err.message}`)
      .openOn(map);
  }
});

// //////////////////////////////////