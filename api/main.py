from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from pyproj import Transformer
import asyncio

app = FastAPI()

# Autoriser le front
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Front exact
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
)

# Conversion WGS84 -> Lambert 93
transformer = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)

class Coordonnees(BaseModel):
    latitude: float
    longitude: float

# Mapping noms lisibles -> couches GeoServer
WMS_LAYERS = {
    "ambroisie": "cartozome:Ambroisie_2024_AURA",
    "no2": "cartozome:mod_aura_2024_no2_moyan",
    "o3": "cartozome:mod_aura_2024_o3_somo35",
    "pm10": "cartozome:mod_aura_2024_pm10_moyan",
    "pm25": "cartozome:mod_aura_2024_pm25_moyan",
    "bruit": "cartozome:sous_indice_multibruit_orhane_2023"
}

WMS_URL = "http://localhost:8081/geoserver/cartozome/ows"
UV_URL = "https://api.open-meteo.com/v1/forecast"

# -------- fonction requête WMS --------
async def fetch_wms_all(client, bbox):
    layers = ",".join(WMS_LAYERS.values())

    params = {
        "service": "WMS",
        "version": "1.3.0",
        "request": "GetFeatureInfo",
        "layers": layers,
        "query_layers": layers,
        "crs": "EPSG:2154",
        "bbox": bbox,
        "width": 101,
        "height": 101,
        "format": "image/png",
        "info_format": "application/json",
        "x": 50,
        "y": 50
    }

    r = await client.get(WMS_URL, params=params)
    data = r.json()

    result = {k: None for k in WMS_LAYERS.keys()}

    if "features" in data:
        for feature in data["features"]:
            layer_name = feature["id"].split(".")[0]
            value = feature["properties"].get("GRAY_INDEX")
            for key, layer in WMS_LAYERS.items():
                if layer.endswith(layer_name):
                    result[key] = value

    return result

# -------- fonction requête UV --------
async def fetch_uv(client, lat, lon):
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "uv_index"
    }

    try:
        r = await client.get(UV_URL, params=params)
        data = r.json()
        return data["current"]["uv_index"]
    except Exception as e:
        return f"Erreur: {e}"

# -------- endpoint principal --------
@app.post("/indicateurs")
async def get_indicateurs(coords: Coordonnees):
    lat = coords.latitude
    lon = coords.longitude

    # conversion vers Lambert 93
    x, y = transformer.transform(lon, lat)

    # petite bbox autour du point
    delta = 5
    bbox = f"{x-delta},{y-delta},{x+delta},{y+delta}"

    async with httpx.AsyncClient(timeout=30) as client:
        # Appel WMS unique
        wms_result = await fetch_wms_all(client, bbox)
        uv_value = await fetch_uv(client, lat, lon)

    # Combine résultats
    result = wms_result
    result["uv"] = uv_value

    return result





# from fastapi.middleware.cors import CORSMiddleware

# app = FastAPI()

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],  
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# @app.post("/pollution")
# def get_pollution():
#     return {
#         "pollution": {
#             "PM2.5": 12.3,
#             "NO2": 24.7,
#             "O3": 18.1
#         }
#     }


# # https://data.grandlyon.com/geoserver/grandlyon/ows?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=GL_Fer_Ln&query_layers=GL_Fer_Ln&crs=EPSG:2154&bbox=842313.8040,6519192.1484,842460.9725,6519266.7661&width=800&height=800&format=image/png&info_format=application/json&x=100&y=100

# http://localhost:8081/geoserver/cartozome/wms?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=cartozome%3AAmbroisie_2024_AURA&query_layers=cartozome%3AAmbroisie_2024_AURA&crs=EPSG:2154&bbox=842313.8040,6519192.1484,842460.9725,6519266.7661&width=100&height=100&format=image/png&info_format=application/json&x=50&y=50

# http://localhost:8081/geoserver/cartozome/wms?service=WMS&version=1.1.0&request=GetMap&layers=cartozome%3AAmbroisie_2024_AURA&bbox=-378305.8099675195%2C6008151.219241469%2C1320649.571233652%2C7235612.7247730335&width=768&height=554&srs=EPSG%3A2154&styles=&format=application/openlayers