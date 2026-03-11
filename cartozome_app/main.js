import 'leaflet/dist/leaflet.css';                                           // Import du CSS de Leaflet pour le style des cartes
import L from 'leaflet';                                                     // Import de la bibliothèque Leaflet pour la gestion des cartes

// URLs GeoServer local (WMS pour les rasters, WFS pour le bruit aérien)
const GEOSERVER_URL = "http://localhost:8081/geoserver/wms";
const GEOSERVER_WFS = "http://localhost:8081/geoserver/wfs";

// =============================================
// CARTE LEAFLET
// Centrée sur Lyon, limitée aux bounds de la
// métropole (pan + zoom bloqués hors zone).
// Fond de carte OpenStreetMap.
// =============================================

// Bounds de la métropole de Lyon
const METROPOLE_BOUNDS = L.latLngBounds(
  [45.45, 4.65],
  [46.00, 5.25]
);

const map = L.map('map').fitBounds(METROPOLE_BOUNDS);                                      // Vue initiale centrée sur Lyon

// Crédits
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution:
    'Données : <a href="https://www.atmo-auvergnerhonealpes.fr/" target="_blank">Atmo AURA</a> · ' +
    '<a href="https://www.orhane.fr/" target="_blank">ORHANE</a> · ' +
    '<a href="https://open-meteo.com/en/docs" target="_blank">Open-Meteo</a> · ' +
    'Fond de carte : &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · ' +
    '&copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
  subdomains: 'abcd',
}).addTo(map);


// =============================================
// COMMUNES UV 
// =============================================

function getColor(uv) {
  if      (uv >= 11) return '#9c27b0'; // Extreme
  else if (uv >= 8)  return '#f44336'; // Très Fort
  else if (uv >= 6)  return '#ff9800'; // Fort
  else if (uv >= 3)  return '#ffeb3b'; // Modéré
  else if (uv > 0)   return '#8bc34a'; // Faible
  else               return '#FFFFFF';
}

const routingLayer = L.layerGroup().addTo(map);
let uvLayer = null; // variable globale pour la couche UV
let uvLastUpdate = null;  // date/heure de dernière mise à jour UV

// Fonction pour récupérer les données UV et créer la couche GeoJSON
async function loadUvLayer() {
  const res = await fetch("/data/communes_uv.geojson");
  if (!res.ok) {
    throw new Error(`Erreur chargement UV : HTTP ${res.status}`);
  }

  const lastModifiedHeader = res.headers.get("Last-Modified");
  if (lastModifiedHeader) {
    uvLastUpdate = new Date(lastModifiedHeader);
  } else {
    uvLastUpdate = null;
  }

  const communesGeojson = await res.json();

  const filteredFeatures = communesGeojson.features.filter(feature => {
    const uv = Number(feature.properties.uv_max);
    return Number.isFinite(uv) && uv > 0;
  });

  const filteredGeojson = {
    ...communesGeojson,
    features: filteredFeatures
  };

  uvLayer = L.geoJSON(filteredGeojson, {
    style: feature => {
      const uv = Number(feature.properties.uv_max);
      return {
        fillColor: getColor(uv),
        weight: 1,
        color: "#555",
        fillOpacity: 0.7
      };
    },
    onEachFeature: (feature, layer) => {
      const uv = Number(feature.properties.uv_max);
      const nom =
        feature.properties.nom ||
        feature.properties.nom_commune ||
        feature.properties.libelle ||
        "Commune";

      layer.bindPopup(`Commune : ${nom}<br>UV : ${uv}`);
    }
  });
}

// Charger la couche au démarrage
(async () => {
  try {
    await loadUvLayer();

    const uvCheckbox = document.querySelector('.layer-checkbox[data-layer="uvLayer"]');
    if (uvCheckbox && uvCheckbox.checked && uvLayer) {
      map.addLayer(uvLayer);
    }
  } catch (err) {
    console.error("[UV LOAD ERROR]", err);
  }
})();

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
  "cartozome:mod_aura_2024_o3_nbjdep120":  "O3 SOMO35",
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
  "cartozome:mod_aura_2024_o3_nbjdep120": "jours/an",
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
      { color: '#BD37AC', label: '25' },
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
      { color: '#BD37AC', label: '35'  },
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
      { color: '#BD37AC', label: '40'  },
    ]
  },

  "cartozome:mod_aura_2024_o3_nbjdep120": {
    unit: "jours/an", oms: 25,
    entries: [
      { color: '#006400', label: '0'   },
      { color: '#4caf50', label: '7'   },
      { color: '#8bc34a', label: '10'  },
      { color: '#cddc39', label: '12'  },
      { color: '#ffeb3b', label: '15'  },
      { color: '#ffc107', label: '17'  },
      { color: '#ff5722', label: '20'  },
      { color: '#f44336', label: '22'  },
      { color: '#b71c1c', label: '25'  },
      { color: '#3e0000', label: '50' },
    ]
  },

  "cartozome:Ambroisie_2024_AURA": {
    unit: "Nombre de jour avec un RAEP >3", oms: null,
    entries: [
      { color: '#b2e8e4', label: '0'    },
      { color: '#7ecdc2', label: '3'    },
      { color: '#f5e96a', label: '30'   },
      { color: '#f4846a', label: '40'   },
      { color: '#c0392b', label: '250'  },
      { color: '#8e44ad', label: '500' },
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

function buildUvUpdateHTML() {
  if (!uvLastUpdate || isNaN(uvLastUpdate.getTime())) {
    return `
      <div class="uv-update-block" style="
        margin-top:10px;
        padding-top:10px;
        border-top:1px solid #d9d9d9;
        font-size:0.85rem;
        line-height:1.4;
        color:#444;
      ">
        <strong>Dernière mise à jour :</strong><br>
        Non disponible
      </div>
    `;
  }

  const date = uvLastUpdate.toLocaleDateString("fr-FR");
  const heure = uvLastUpdate.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  return `
    <div class="uv-update-block" style="
      margin-top:10px;
      padding-top:10px;
      border-top:1px solid #d9d9d9;
      font-size:0.85rem;
      line-height:1.4;
      color:#444;
    ">
      <strong>Dernière mise à jour :</strong><br>
      ${date}<br>
      ${heure}
    </div>
  `;
}

/**
 * Construit le HTML de la légende pour un data-layer donné.
 */
function buildLegendHTML(layerName) {
  const def = LAYER_LEGENDS[layerName];
  if (!def) return '';

  let html = buildSegmentedBar(def);

  if (layerName === "uvLayer") {
    html += buildUvUpdateHTML();
  }

  return html;
}

/**
 * Barre segmentée couleurs pleines.
 * Les labels sont placés aux bordures entre cases (left: 0%, 1/n*100%, 2/n*100%…).
 * Seuil OMS affiché au-dessus de la barre avec flèche, aligné sur la bordure OMS.
 */
function buildSegmentedBar(def) {
  const n = def.entries.length;
  const unitLabel = def.unit ? `<div class="lgd-col-unit">${def.unit}</div>` : '';

  const segments = def.entries.map((e, i) => {
    const radius = i === 0 ? '4px 0 0 4px' : i === n - 1 ? '0 4px 4px 0' : '0';
    return `<div class="lgd-seg" style="background:${e.color};opacity:${LAYER_OPACITY};border-radius:${radius};flex:1"></div>`;
  }).join('');

  if (def.centerLabels) {
    const rows = def.entries.map((e) => `<div class="lgd-col-row">
        <span class="lgd-col-swatch" style="background:${e.color};opacity:${LAYER_OPACITY}"></span>
        <span class="lgd-col-label">${e.label}</span>
      </div>`).join('');
    return `<div class="lgd-col-list">${unitLabel}${rows}</div>`;
  }

  const borderLabels = def.entries.map((e, i) => {
    const pct = (i / n) * 100;
    return `<span class="lgd-border-label" style="left:${pct}%">${e.label}</span>`;
  }).join('');

  const omsIdx = def.oms != null ? def.entries.findIndex(e => e.label === String(def.oms)) : -1;
  const omsAbove = omsIdx >= 0 ? (() => {
    const pct = (omsIdx / n) * 100;
    return `<div class="lgd-oms-above" style="left:${pct}%">
      <span class="lgd-seg-oms">Seuil OMS : ${def.oms} ${def.unit}</span>
    </div>
    <div class="lgd-oms-line" style="left:${pct}%"></div>`;
  })() : '';

  return `
    <div class="lgd-bar-outer${def.oms == null ? ' lgd-bar-outer--no-oms' : ''}">
      ${unitLabel}
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
      if (!layerInstances[layerName]) {
        layerInstances[layerName] = await initLayer(layerName, isWFS);
      }
      if (layerInstances[layerName]) {
        map.addLayer(layerInstances[layerName]);
      }      

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
    `&timeUnit=minute` +
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
  routingLayer.clearLayers();
  document.getElementById('point-start').value = '';
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
  routingLayer.clearLayers();
  document.getElementById('compare-a').value = '';
  document.getElementById('compare-b').value = '';
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
  routingLayer.clearLayers();
  document.getElementById('route-start').value = '';
  document.getElementById('route-end').value = '';
  document.getElementById('panel-route').classList.remove('hidden');
  document.getElementById('panel-address').classList.add('hidden');
  document.getElementById('panel-compare').classList.add('hidden');
  searchPanel.classList.remove('hidden');
  btnRoute.classList.add('active');
  btnAddress.classList.remove('active');
  btnCompare.classList.remove('active');
  resultsPanel.classList.add("hidden");
}

// Branche les boutons "effacer" sur chaque champ de saisie.
// Au clic : vide le champ et remet le focus dessus.
function attachClearButtons() {
  document.querySelectorAll('.clear-btn').forEach(btn => {
    const targetId = btn.dataset.target;
    const inputEl  = document.getElementById(targetId);
    if (!inputEl) return;
    btn.addEventListener('click', () => {
      inputEl.value = '';
      inputEl.focus();
    });
  });
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



document.getElementById("calc-route-btn").addEventListener("click", async () => {
  routingLayer.clearLayers();

  const routeStart = document.getElementById("route-start").value.trim();
  const routeEnd = document.getElementById("route-end").value.trim();
  if (!routeStart) {
    alert("Veuillez saisir une adresse de départ");
    return;
  }

  const startCoords = await geocodeAddress(routeStart);
  if (!startCoords) {
    alert("Adresse de départ introuvable");
    return;
  }
  const startLatLng = L.latLng(startCoords[1], startCoords[0]);
  L.marker(startLatLng, { icon: iconDepart }).addTo(routingLayer).bindPopup("Départ");

  if (!routeEnd) {
    map.setView(startLatLng, 16);
    return;
  }

  const endCoords = await geocodeAddress(routeEnd);
  if (!endCoords) {
    alert("Adresse d'arrivée introuvable");
    return;
  }
  const endLatLng = L.latLng(endCoords[1], endCoords[0]);
  L.marker(endLatLng, { icon: iconArrivee }).addTo(routingLayer).bindPopup("Arrivée");

  const routeCoords = await getRoute(startCoords, endCoords);
  if (!routeCoords) {
    alert("Impossible de calculer l'itinéraire");
    return;
  }

  // Transformation en LatLng pour Leaflet
  const latLngs = routeCoords.map((c) => L.latLng(c[1], c[0]));
  const routeLine = L.polyline(latLngs, { color: "#1A4E72", weight: 4, opacity: 1 }).addTo(routingLayer);
  map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

  // Échantillonnage
  function sampleRoutePoints(latlngs, step = 20) {
    const sampled = [];
    for (let i = 0; i < latlngs.length; i += step) {
      sampled.push(latlngs[i]);
    }
    if (latlngs.length > 0 && !sampled.includes(latlngs[latlngs.length - 1])) {
      sampled.push(latlngs[latlngs.length - 1]);
    }
    return sampled;
  }

  const sampledPoints = sampleRoutePoints(latLngs, 20);

  // Appel à l'API pour obtenir les valeurs des polluants
  const exposures = await fetch("http://localhost:8000/indicateursItineraire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      coords: sampledPoints.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    }),
  }).then((r) => r.json());

  // Stockez les données des polluants dans une variable globale
  window.routeExposures = {
    points: sampledPoints,
    data: exposures,
    latLngs: latLngs,
  };

  openResultsPanel();
  renderRouteResultsPanel(routeStart, routeEnd, exposures);
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
        return lat >= 44 && lat <= 47 && lon >= 1.75 && lon <= 7.2;
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
attachClearButtons();
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
  "cartozome:mod_aura_2024_pm10_moyan":           { label: "PM10",           unit: "µg/m³",   oms: 15,  thresholds: [0, 35]    },
  "cartozome:mod_aura_2024_pm25_moyan":           { label: "PM2.5",          unit: "µg/m³",   oms: 5,   thresholds: [0, 25]     },
  "cartozome:mod_aura_2024_no2_moyan":            { label: "NO₂",            unit: "µg/m³",   oms: 10,  thresholds: [0, 40]    },
  "cartozome:mod_aura_2024_o3_nbjdep120":            { label: "O₃",             unit: "µg/m³·j", oms: null, thresholds: [0, 17500] },
  "cartozome:Ambroisie_2024_AURA":                { label: "Ambroisie",      unit: "gr/m³",   oms: null, thresholds: [0, 500]     },
  "cartozome:sous_indice_multibruit_orhane_2023": { label: "Indice multi-bruit", unit: "dB(A)", oms: null, thresholds: [0, 30]   },
};

// Structure des catégories affichées dans le panel
const RESULT_CATEGORIES = [
  {
    label: "Air", icon: '<img src="./img/air.png" style="width:16px;height:16px;object-fit:contain;vertical-align:middle">',
    layers: [
      "cartozome:mod_aura_2024_pm10_moyan",
      "cartozome:mod_aura_2024_pm25_moyan",
      "cartozome:mod_aura_2024_no2_moyan",
      "cartozome:mod_aura_2024_o3_nbjdep120",
    ]
  },
  {
    label: "Pollen", icon: '<img src="./img/pollen.png" style="width:16px;height:16px;object-fit:contain;vertical-align:middle">',
    layers: ["cartozome:Ambroisie_2024_AURA"]
  },
  {
    label: "Bruit", icon: '<img src="./img/bruit.png" style="width:16px;height:16px;object-fit:contain;vertical-align:middle">',
    layers: ["cartozome:sous_indice_multibruit_orhane_2023"]
  },
];

// Retourne le badge correspondant à la valeur
function getBadge(val, thresholds) {
  if (val <= thresholds[0]) return { label: "Bon",     cls: "badge-low"  };
  if (val <= thresholds[1]) return { label: "Modéré",  cls: "badge-mid"  };
  return                           { label: "Élevé",   cls: "badge-high" };
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

// =============================================
// SEUILS NUMERIQUES PAR INDICATEUR
// =============================================

const LAYER_THRESHOLDS = {

  "cartozome:mod_aura_2024_pm10_moyan":
    [0,8,11,15,16,35,Infinity],

  "cartozome:mod_aura_2024_pm25_moyan":
    [0,3,4,5,6,25,Infinity],

  "cartozome:mod_aura_2024_no2_moyan":
    [0,5,7,10,11,40,Infinity],

  "cartozome:mod_aura_2024_o3_nbjdep120":
    [0,7,10,12,15,17,22,25,50, Infinity],

  "cartozome:Ambroisie_2024_AURA":
    [0,3,30,50,250,500,Infinity],

  "cartozome:sous_indice_multibruit_orhane_2023":
    [1,2,3,4,5,6,7,8],   // valeurs discrètes 1–7

  "uvLayer":
    [0,3,6,8,11,Infinity]
};

// =============================================
// SEUILS OMS (ticks)
// =============================================

const OMS_THRESHOLDS = {
  "cartozome:mod_aura_2024_pm10_moyan": 15,
  "cartozome:mod_aura_2024_pm25_moyan": 5,
  "cartozome:mod_aura_2024_no2_moyan": 10,
  "cartozome:mod_aura_2024_o3_nbjdep120":25
};

// =============================================
// COULEUR CURSEUR
// =============================================

function getLayerValueColor(layerName,value){
  const legend = LAYER_LEGENDS[layerName];
  const thresholds = LAYER_THRESHOLDS[layerName];
  if(!legend || !thresholds) return "#999";
  for(let i=thresholds.length-2;i>=0;i--){
    if(value >= thresholds[i]){
      return legend.entries[i].color;
    }
  }
  return legend.entries[0].color;
}

// =============================================
// BARRE RESULTATS
// =============================================

function buildResultBar(layerName,value){
  const legend = LAYER_LEGENDS[layerName];
  const thresholds = LAYER_THRESHOLDS[layerName];
  if(!legend || !thresholds) return "";
  const entries = legend.entries;
  const segments = thresholds.length-1;

  const colors = entries.map(e=>e.color);

  const gradient = colors
    .map((c,i)=>`${c} ${(i/segments)*100}% ${(i+1)/segments*100}%`)
    .join(",");


  // ===============================
  // POSITION CURSEUR
  // ===============================

  let segmentIndex = segments-1;
  for(let i=0;i<segments;i++){

    if(value >= thresholds[i] && value < thresholds[i+1]){
      segmentIndex = i;
      break;
    }

  }

  const min = thresholds[segmentIndex];
  const max = thresholds[segmentIndex+1];

  let relative;
  if(layerName==="cartozome:sous_indice_multibruit_orhane_2023"){relative = 0.5;}
  else if(max===Infinity){relative = 0.8;}
  else{relative = (value-min)/(max-min);}

  const position =
    (segmentIndex + relative) / segments;

  const left = Math.max(0,Math.min(1,position))*100;

  // ===============================
  // POSITION TICK OMS
  // ===============================

  let tickHTML = "";
  const omsValue = OMS_THRESHOLDS[layerName];
  if(omsValue !== undefined){

    let tickSegment = segments-1;
    for(let i=0;i<segments;i++){
      if(omsValue >= thresholds[i] && omsValue < thresholds[i+1]){
        tickSegment = i;
        break;
      }
    }

    const tmin = thresholds[tickSegment];
    const tmax = thresholds[tickSegment+1];

    let trel;

    if(tmax === Infinity){trel = 0.8;}
    else{trel = (omsValue - tmin)/(tmax - tmin);}

    const tpos =
      (tickSegment + trel) / segments;

    const tickLeft =
      Math.max(0,Math.min(1,tpos))*100;

tickHTML = `
  <div style="
    position:absolute;
    left:${tickLeft}%;
    top:-3px;
    transform:translateX(-50%);
    text-align:center;
    pointer-events:none;
  ">
    <!-- Tick -->
    <div style="
      width:2px;
      height:16px;
      background:black;
      margin:auto;
      position:relative;
    ">
      <!-- Texte au-dessus du tick -->
      <div style="
        position:absolute;
        bottom:100%;  /* juste au-dessus */
        left:50%;
        transform:translateX(-50%);
        font-size:9px;
        color:#333;
        white-space:nowrap;
        margin-bottom:2px; /* petit écart */
      ">
        Seuil OMS
      </div>
    </div>
  </div>
`;
  }

  const cursorColor = getLayerValueColor(layerName,value);

  return `
  <div style="margin-top:6px;position:relative">

    <div style="
      height:10px;
      border-radius:6px;
      background:linear-gradient(to right,${gradient});
      position:relative;
    ">

      ${tickHTML}

      <div style="
        position:absolute;
        left:${left}%;
        top:-4px;
        width:14px;
        height:14px;
        border-radius:50%;
        border:2px solid white;
        background:${cursorColor};
        transform:translateX(-50%);
        box-shadow:0 0 3px rgba(0,0,0,0.4);
      "></div>

    </div>

  </div>
  `;
}


// =============================================
// PANEL RESULTATS
// =============================================

function renderResultsPanel(address, layerValues, uvValue){

  const content = document.getElementById("results-content");
  document.getElementById("results-address").textContent = address;

  let html="";

  for(const cat of RESULT_CATEGORIES){

    html += `
    <div class="cat-card">

      <div class="cat-header">
        ${cat.icon} ${cat.label}
      </div>

      <div class="cat-body">
    `;

    for(const layerName of cat.layers){

      const meta = LAYER_META[layerName];
      const value = layerValues[layerName];

      html+=`<div class="res-row">`;

      html+=`
      <div class="res-top">
        <span class="res-label">${meta.label}</span>
      `;

      if(value===null || isNaN(value)){

        html+=`<span class="res-value no-data">Non disponible</span>`;

      }else{

        html+=`
        <span class="res-value">
          ${value.toFixed(1)} ${meta.unit}
        </span>
        `;

      }

      html+=`</div>`;

      if(value!==null && !isNaN(value)){

        html+=buildResultBar(layerName,value);

      }

      html+=`</div>`;

    }

    html+=`
      </div>
    </div>
    `;

  }


  // ================= UV =================

  html+=`

  <div class="cat-card">

    <div class="cat-header">
      <img src="./img/uv.png"
      style="width:16px;height:16px;vertical-align:middle">
      UV
    </div>

    <div class="cat-body">

      <div class="res-row">

        <div class="res-top">

          <span class="res-label">
          Indice UV
          </span>

  `;

  if(uvValue===null || isNaN(uvValue)){

    html+=`
    <span class="res-value no-data">
    Non disponible
    </span>
    `;

  }else{

    html+=`
    <span class="res-value">
    ${uvValue}
    </span>
    `;

  }

  html+=`

        </div>

        ${uvValue!==null ? buildResultBar("uvLayer",uvValue) : ""}

      </div>

    </div>

  </div>

  `;


  content.innerHTML=html;

}



// =============================================
// APPEL API POINT
// =============================================

async function updateResultsForPoint(lat,lon,address){

  let data={};

  try{

    const res=await fetch(
      "http://localhost:8000/indicateursPoint",
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          latitude:lat,
          longitude:lon
        })
      }
    );

//    data=await res.json();
data = await res.json();
console.log("[indicateursPoint]", data);

  }catch(err){

    console.error("API indicateurs erreur",err);

  }


  const layerValues={
    "cartozome:mod_aura_2024_pm10_moyan": parseFloat(data.PM10) || null,
    "cartozome:mod_aura_2024_pm25_moyan": parseFloat(data["PM2.5"]) || null,
    "cartozome:mod_aura_2024_no2_moyan": parseFloat(data.NO2) || null,
    "cartozome:mod_aura_2024_o3_nbjdep120": data.O3 !== undefined && data.O3 !== null ? parseFloat(data.O3) : null,
    "cartozome:Ambroisie_2024_AURA": parseFloat(data.Ambroisie) || null,
    "cartozome:sous_indice_multibruit_orhane_2023": parseFloat(data.Bruit) || null

  };


  const uvValue =
    data.UV !== undefined && data.UV !== null
    ? parseFloat(data.UV)
    : null;


  renderResultsPanel(
    address,
    layerValues,
    uvValue
  );

}

// =============================================
// BOUTON 'TELECHARGER EN PDF' - IMPRESSION / EXPORT PDF
// =============================================
document.getElementById("btn-share").addEventListener("click", async () => {
  const panel   = document.getElementById("results-panel");
  const content = document.getElementById("results-content");
  const header  = document.getElementById("results-header");

  // Sauvegarde les styles contraignants
  const savedPanelMaxHeight   = panel.style.maxHeight;
  const savedPanelOverflow    = panel.style.overflow;
  const savedContentMaxHeight = content.style.maxHeight;
  const savedContentOverflow  = content.style.overflow;
  const savedHeaderDisplay    = header.style.display;

  // Retire temporairement les limites de hauteur
  panel.style.maxHeight   = "none";
  panel.style.overflow    = "visible";
  content.style.maxHeight = "none";
  content.style.overflow  = "visible";

  // Cache le header (bouton partager + croix) du PDF
  header.style.display = "none";

  // Laisse le navigateur recalculer le layout
  await new Promise(r => setTimeout(r, 100));

  const canvas = await html2canvas(panel, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    scrollY: 0,
    windowWidth:  panel.scrollWidth,
    windowHeight: panel.scrollHeight,
    height:       panel.scrollHeight,
    width:        panel.scrollWidth,
  });

  // Remet les styles d'origine
  panel.style.maxHeight   = savedPanelMaxHeight;
  panel.style.overflow    = savedPanelOverflow;
  content.style.maxHeight = savedContentMaxHeight;
  content.style.overflow  = savedContentOverflow;
  header.style.display    = savedHeaderDisplay;

  const imgData = canvas.toDataURL("image/png");

  // Détecte le mode actif et construit le titre
  let address = "Résultats Cartozome";

  if (document.getElementById("btn-address").classList.contains("active")) {
    const val = document.getElementById("point-start").value.trim();
    if (val) address = val;

  } else if (document.getElementById("btn-compare").classList.contains("active")) {
    const a = document.getElementById("compare-a").value.trim();
    const b = document.getElementById("compare-b").value.trim();
    if (a && b) address = `Point A : ${a}  VS  Point B : ${b}`;
    else if (a) address = a;

  } else if (document.getElementById("btn-route").classList.contains("active")) {
    const start = document.getElementById("route-start").value.trim();
    const end   = document.getElementById("route-end").value.trim();
    if (start && end) address = `${start}  VERS  ${end}`;
    else if (start) address = start;
  }

  const { jsPDF } = window.jspdf;
  const margin   = 15;
  const imgScale = 0.6;
  const imgWidth  = (210 - margin * 2) * imgScale;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgLeft   = (210 - imgWidth) / 2;

  // PDF temporaire pour calculer la hauteur du titre
  const pdfTemp = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pdfTemp.setFont("helvetica", "bold");
  pdfTemp.setFontSize(12);
  const lines       = pdfTemp.splitTextToSize(address, 210 - margin * 2);
  const titleHeight = lines.length * 6 + 4;

  // PDF final avec hauteur exacte
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [210, imgHeight + margin * 2 + titleHeight],
  });

  // Titre
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(44, 66, 108);
  pdf.text(lines, margin, margin + 6);

  // Image centrée sous le titre
  pdf.addImage(imgData, "PNG", imgLeft, margin + titleHeight, imgWidth, imgHeight);

  pdf.save("cartozome-resultats.pdf");
});

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

// ======================================== COMPARAISON ========================
function buildCompareBars(layerName, valueA, valueB) {
  const legend = LAYER_LEGENDS[layerName];
  const thresholds = LAYER_THRESHOLDS[layerName];

  if (!legend || !thresholds) return "";

  const entries = legend.entries;
  const segments = thresholds.length - 1;
  const colors = entries.map((e) => e.color);

  // Génération du dégradé pour la barre
  const gradient = colors
    .map((c, i) => `${c} ${(i / segments) * 100}% ${((i + 1) / segments) * 100}%`)
    .join(",");

  // Fonction pour calculer la position du curseur
  const getCursorPosition = (value) => {
    let segmentIndex = segments - 1;
    for (let i = 0; i < segments; i++) {
      if (value >= thresholds[i] && value < thresholds[i + 1]) {
        segmentIndex = i;
        break;
      }
    }

    const min = thresholds[segmentIndex];
    const max = thresholds[segmentIndex + 1];
    let relative;
    if (layerName === "cartozome:sous_indice_multibruit_orhane_2023") {
      relative = 0.5;
    } else if (max === Infinity) {
      relative = 0.8;
    } else {
      relative = (value - min) / (max - min);
    }

    const position = (segmentIndex + relative) / segments;
    return Math.max(0, Math.min(1, position)) * 100;
  };

  // Position des curseurs pour A et B
  const leftA = getCursorPosition(valueA);
  const leftB = getCursorPosition(valueB);

  // Couleur des curseurs
  const cursorColorA = getLayerValueColor(layerName, valueA);
  const cursorColorB = getLayerValueColor(layerName, valueB);

  // Tick OMS (si applicable)
  let tickHTML = "";
  const omsValue = OMS_THRESHOLDS[layerName];
  if (omsValue !== undefined) {
    let tickSegment = segments - 1;
    for (let i = 0; i < segments; i++) {
      if (omsValue >= thresholds[i] && omsValue < thresholds[i + 1]) {
        tickSegment = i;
        break;
      }
    }
    const tmin = thresholds[tickSegment];
    const tmax = thresholds[tickSegment + 1];
    let trel = tmax === Infinity ? 0.8 : (omsValue - tmin) / (tmax - tmin);
    const tpos = (tickSegment + trel) / segments;
    const tickLeft = Math.max(0, Math.min(1, tpos)) * 100;

    tickHTML = `
      <div style="
        position:absolute;
        left:${tickLeft}%;
        top:-3px;
        transform:translateX(-50%);
        text-align:center;
        pointer-events:none;
      ">
        <div style="
          width:2px;
          height:16px;
          background:black;
          margin:auto;
          position:relative;
        ">
          <div style="
            position:absolute;
            bottom:100%;
            left:50%;
            transform:translateX(-50%);
            font-size:9px;
            color:#333;
            white-space:nowrap;
            margin-bottom:2px;
          ">
            Seuil OMS
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div style="margin-top:6px;position:relative">
      <div style="
        height:10px;
        border-radius:6px;
        background:linear-gradient(to right,${gradient});
        position:relative;
        margin-bottom:4px;
      ">
        ${tickHTML}
        <div style="
          position:absolute;
          left:${leftA}%;
          top:-4px;
          width:14px;
          height:14px;
          border-radius:50%;
          border:2px solid white;
          background:${cursorColorA};
          transform:translateX(-50%);
          box-shadow:0 0 3px rgba(0,0,0,0.4);
        "></div>
      </div>
      <div style="
        height:10px;
        border-radius:6px;
        background:linear-gradient(to right,${gradient});
        position:relative;
      ">
        ${tickHTML}
        <div style="
          position:absolute;
          left:${leftB}%;
          top:-4px;
          width:14px;
          height:14px;
          border-radius:50%;
          border:2px solid white;
          background:${cursorColorB};
          transform:translateX(-50%);
          box-shadow:0 0 3px rgba(0,0,0,0.4);
        "></div>
      </div>
    </div>
  `;
}

function renderCompareResultsPanel(addressA, addressB, layerValuesA, layerValuesB, uvValueA, uvValueB) {
  const content = document.getElementById("results-content");
  document.getElementById("results-address").textContent = `Comparaison: ${addressA} vs ${addressB}`;

  let html = "";

  for (const cat of RESULT_CATEGORIES) {
    html += `
      <div class="cat-card">
        <div class="cat-header">
          ${cat.icon} ${cat.label}
        </div>
        <div class="cat-body">
    `;

    for (const layerName of cat.layers) {
      const meta = LAYER_META[layerName];
      const valueA = layerValuesA[layerName];
      const valueB = layerValuesB[layerName];

      html += `<div class="res-row">`;
      html += `
        <div class="res-top">
          <span class="res-label">${meta.label}</span>
      `;

      if (valueA === null || isNaN(valueA) || valueB === null || isNaN(valueB)) {
        html += `<span class="res-value no-data">Non disponible</span>`;
      } else {
        html += `
          <span class="res-value">
            Point A: ${valueA.toFixed(1)} ${meta.unit}<br>
            Point B: ${valueB.toFixed(1)} ${meta.unit}
          </span>
        `;
      }

      html += `</div>`;

      if (valueA !== null && !isNaN(valueA) && valueB !== null && !isNaN(valueB)) {
        html += buildCompareBars(layerName, valueA, valueB);
      }

      html += `</div>`;
    }

    html += `
        </div>
      </div>
    `;
  }

  // Ajoutez la section UV si nécessaire
  if (uvValueA !== null && uvValueB !== null) {
    html += `
      <div class="cat-card">
        <div class="cat-header">
          <img src="./img/uv.png" style="width:16px;height:16px;vertical-align:middle">
          UV
        </div>
        <div class="cat-body">
          <div class="res-row">
            <div class="res-top">
              <span class="res-label">Indice UV</span>
              <span class="res-value">
                Point A: ${uvValueA}<br>
                Point B: ${uvValueB}
              </span>
            </div>
            ${buildCompareBars("uvLayer", uvValueA, uvValueB)}
          </div>
        </div>
      </div>
    `;
  }

  content.innerHTML = html;
}

async function updateResultsForCompare(latA, lonA, addressA, latB, lonB, addressB) {
  let dataA = {};
  let dataB = {};

  try {
    const resA = await fetch("http://localhost:8000/indicateursPoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: latA, longitude: lonA }),
    });
    dataA = await resA.json();

    const resB = await fetch("http://localhost:8000/indicateursPoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: latB, longitude: lonB }),
    });
    dataB = await resB.json();
  } catch (err) {
    console.error("API indicateurs erreur", err);
  }

  const layerValuesA = {
    "cartozome:mod_aura_2024_pm10_moyan": parseFloat(dataA.PM10) || null,
    "cartozome:mod_aura_2024_pm25_moyan": parseFloat(dataA["PM2.5"]) || null,
    "cartozome:mod_aura_2024_no2_moyan": parseFloat(dataA.NO2) || null,
    "cartozome:mod_aura_2024_o3_nbjdep120": parseFloat(dataA.O3) || null,
    "cartozome:Ambroisie_2024_AURA": parseFloat(dataA.Ambroisie) || null,
    "cartozome:sous_indice_multibruit_orhane_2023": parseFloat(dataA.Bruit) || null,
  };

  const layerValuesB = {
    "cartozome:mod_aura_2024_pm10_moyan": parseFloat(dataB.PM10) || null,
    "cartozome:mod_aura_2024_pm25_moyan": parseFloat(dataB["PM2.5"]) || null,
    "cartozome:mod_aura_2024_no2_moyan": parseFloat(dataB.NO2) || null,
    "cartozome:mod_aura_2024_o3_nbjdep120": parseFloat(dataB.O3) || null,
    "cartozome:Ambroisie_2024_AURA": parseFloat(dataB.Ambroisie) || null,
    "cartozome:sous_indice_multibruit_orhane_2023": parseFloat(dataB.Bruit) || null,
  };

  const uvValueA = dataA.UV !== undefined && dataA.UV !== null ? parseFloat(dataA.UV) : null;
  const uvValueB = dataB.UV !== undefined && dataB.UV !== null ? parseFloat(dataB.UV) : null;

  renderCompareResultsPanel(addressA, addressB, layerValuesA, layerValuesB, uvValueA, uvValueB);
}

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

  openResultsPanel();
  updateResultsForCompare(coordsA[1], coordsA[0], inputA, coordsB[1], coordsB[0], inputB);
});

// ======================================== ITINERAIRE ========================
function buildSegmentedRouteBar(layerName, values) {
  const legend = LAYER_LEGENDS[layerName];
  const thresholds = LAYER_THRESHOLDS[layerName];

  if (!legend || !thresholds || !values || values.length === 0) {
    return "";
  }

  // Calcul de la largeur de chaque segment (25 segments = 4% chacun)
  const segmentWidth = 100 / values.length;

  // Génération des segments
  const segments = values.map((value, index) => {
    const color = getLayerValueColor(layerName, value);
    const left = index * segmentWidth;
    return `
      <div style="
        position: absolute;
        left: ${left}%;
        width: ${segmentWidth}%;
        height: 10px;
        background-color: ${color};
        
        box-sizing: border-box;
      "></div>
    `;
  }).join("");

  // Ajout du tick OMS si applicable
  let tickHTML = "";
  const omsValue = OMS_THRESHOLDS[layerName];
  if (omsValue !== undefined) {
    // Trouver la position du seuil OMS dans la barre
    let omsPosition = 0;
    for (let i = 0; i < thresholds.length - 1; i++) {
      if (omsValue >= thresholds[i] && omsValue < thresholds[i + 1]) {
        omsPosition = (i + (omsValue - thresholds[i]) / (thresholds[i + 1] - thresholds[i])) / (thresholds.length - 1);
        break;
      }
    }
    const omsLeft = omsPosition * 100;
    
  }

  return `
    <div style="margin-top: 6px; position: relative; height: 10px; width: 100%; border-radius: 4px; overflow: hidden;">
      ${segments}
      ${tickHTML}
    </div>
  `;
}

function colorRouteByPollutant(pollutant) {
  if (!window.routeExposures) return;

  const { points, data } = window.routeExposures;

  // Déterminez la couche correspondante au polluant
  const layerMap = {
    PM10: "cartozome:mod_aura_2024_pm10_moyan",
    "PM2.5": "cartozome:mod_aura_2024_pm25_moyan",
    NO2: "cartozome:mod_aura_2024_no2_moyan",
    O3: "cartozome:mod_aura_2024_o3_nbjdep120",
    Ambroisie: "cartozome:Ambroisie_2024_AURA",
    Bruit: "cartozome:sous_indice_multibruit_orhane_2023",
    UV: "uvLayer",
  };

  const layerName = layerMap[pollutant];
  if (!layerName) return;

  // Récupérez les valeurs du polluant
  const values = data.map((exp) => {
    if (pollutant === "UV") return parseFloat(exp.UV);
    if (pollutant === "PM2.5") return parseFloat(exp["PM2.5"]);
    return parseFloat(exp[pollutant]);
  });

  // Créez un tableau de couleurs pour chaque segment
  const colors = values.map((value) => getLayerValueColor(layerName, value));

  // Effacez l'itinéraire actuel
  routingLayer.eachLayer((layer) => {
    if (layer instanceof L.Polyline) {
      routingLayer.removeLayer(layer);
    }
  });

  // Créez un tableau de LatLngs avec des segments colorés
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      latlngs: [points[i], points[i + 1]],
      color: colors[i],
    });
  }

  // Ajoutez les segments colorés
  segments.forEach((segment) => {
    L.polyline(segment.latlngs, {
      color: segment.color,
      weight: 4,
      opacity: 1,
    }).addTo(routingLayer);
  });
}

function renderRouteResultsPanel(startAddress, endAddress, exposures) {
  const content = document.getElementById("results-content");
  document.getElementById("results-address").textContent = `Itinéraire: ${startAddress} → ${endAddress}`;

  let html = `
    <div class="pollutant-checkboxes">
      <label><input type="checkbox" data-pollutant="PM10" class="pollutant-checkbox"> PM10</label>
      <label><input type="checkbox" data-pollutant="PM2.5" class="pollutant-checkbox"> PM2.5</label>
      <label><input type="checkbox" data-pollutant="NO2" class="pollutant-checkbox"> NO₂</label>
      <label><input type="checkbox" data-pollutant="O3" class="pollutant-checkbox"> O₃</label>
      <label><input type="checkbox" data-pollutant="Ambroisie" class="pollutant-checkbox"> Ambroisie</label>
      <label><input type="checkbox" data-pollutant="Bruit" class="pollutant-checkbox"> Bruit</label>
      <label><input type="checkbox" data-pollutant="UV" class="pollutant-checkbox"> UV</label>
    </div>
  `;

  // Préparation des données par catégorie
  const routeValues = {
    "cartozome:mod_aura_2024_pm10_moyan": exposures.map((exp) => parseFloat(exp.PM10) || null),
    "cartozome:mod_aura_2024_pm25_moyan": exposures.map((exp) => parseFloat(exp["PM2.5"]) || null),
    "cartozome:mod_aura_2024_no2_moyan": exposures.map((exp) => parseFloat(exp.NO2) || null),
    "cartozome:mod_aura_2024_o3_nbjdep120": exposures.map((exp) => parseFloat(exp.O3) || null),
    "cartozome:Ambroisie_2024_AURA": exposures.map((exp) => parseFloat(exp.Ambroisie) || null),
    "cartozome:sous_indice_multibruit_orhane_2023": exposures.map((exp) => parseFloat(exp.Bruit) || null),
  };

  // Section UV
  const uvValues = exposures.map((exp) => parseFloat(exp.UV) || null);

  // Ajoutez le reste du contenu du panel de résultats
  for (const cat of RESULT_CATEGORIES) {
    html += `
      <div class="cat-card">
        <div class="cat-header">
          ${cat.icon} ${cat.label}
        </div>
        <div class="cat-body">
    `;

    for (const layerName of cat.layers) {
      const meta = LAYER_META[layerName];
      const values = routeValues[layerName];

      html += `<div class="res-row">`;
      html += `
        <div class="res-top">
          <span class="res-label">${meta.label}</span>
        </div>
      `;

      if (!values || values.some((val) => val === null || isNaN(val))) {
        html += `<span class="res-value no-data">Non disponible</span>`;
      } else {
        html += buildSegmentedRouteBar(layerName, values);
      }

      html += `</div>`;
    }

    html += `
        </div>
      </div>
    `;
  }

  // Ajout de la section UV
  if (uvValues && uvValues.length > 0) {
    html += `
      <div class="cat-card">
        <div class="cat-header">
          <img src="./img/uv.png" style="width:16px;height:16px;vertical-align:middle">
          UV
        </div>
        <div class="cat-body">
          <div class="res-row">
            <div class="res-top">
              <span class="res-label">Indice UV</span>
            </div>
            ${buildSegmentedRouteBar("uvLayer", uvValues)}
          </div>
        </div>
      </div>
    `;
  }

  content.innerHTML = html;

  // Ajoutez l'écouteur d'événement pour les checkboxes après avoir mis à jour le contenu
  document.querySelectorAll(".pollutant-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      // Décochez toutes les autres checkboxes
      document.querySelectorAll(".pollutant-checkbox").forEach((otherCheckbox) => {
        if (otherCheckbox !== this) {
          otherCheckbox.checked = false;
        }
      });

      if (this.checked) {
        const pollutant = this.getAttribute("data-pollutant");
        colorRouteByPollutant(pollutant);
      } else {
        // Si aucune checkbox n'est cochée, réaffichez l'itinéraire par défaut
        if (window.routeExposures) {
          routingLayer.eachLayer((layer) => {
            if (layer instanceof L.Polyline) {
              routingLayer.removeLayer(layer);
            }
          });
          const latLngs = window.routeExposures.latLngs;
          L.polyline(latLngs, { color: "#1A4E72", weight: 4, opacity: 1 }).addTo(routingLayer);
        }
      }
    });
  });
}