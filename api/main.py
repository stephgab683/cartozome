from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from pyproj import Transformer

app = FastAPI()

# Autoriser le front
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
)

# Conversion WGS84 -> Lambert 93
transformer = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)

class Coordonnees(BaseModel):
    latitude: float
    longitude: float

# Liste de toutes les couches à interroger
WMS_LAYERS = [
    "cartozome:Ambroisie_2024_AURA",
    "cartozome:mod_aura_2024_no2_moyan",
    "cartozome:mod_aura_2024_o3_somo35 ",
    "cartozome:mod_aura_2024_pm10_moyan ",
    "cartozome:mod_aura_2024_pm25_moyan", 
    "cartozome:sous_indice_multibruit_orhane_2023",
]

WMS_URL = "http://localhost:8081/geoserver/cartozome/ows"

@app.post("/indicateurs")
def get_indicateurs(coords: Coordonnees):
    lat = coords.latitude
    lon = coords.longitude

    # Conversion en Lambert 93 
    x, y = transformer.transform(lon, lat)

    # Petit BBOX autour du point (5 mètres)
    delta = 5
    bbox = f"{x-delta},{y-delta},{x+delta},{y+delta}"

    result = {}

    for layer in WMS_LAYERS:
        params = {
            "service": "WMS",
            "version": "1.3.0",
            "request": "GetFeatureInfo",
            "layers": layer,
            "query_layers": layer,
            "crs": "EPSG:2154",
            "bbox": bbox,
            "width": 101,
            "height": 101,
            "format": "image/png",
            "info_format": "application/json",
            "x": 50,
            "y": 50
        }

        try:
            response = requests.get(WMS_URL, params=params)
            data = response.json()

            if data.get("features"):
                # On récupère la première valeur trouvée
                gray_value = data["features"][0]["properties"].get("GRAY_INDEX")
                result[layer] = gray_value
            else:
                result[layer] = None

        except Exception as e:
            # En cas d'erreur, on renvoie None ou un message d'erreur
            result[layer] = f"Erreur: {e}"

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