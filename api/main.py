from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from pyproj import Transformer
import asyncio
from shapely.geometry import shape

app = FastAPI()

# ======== Autoriser le front ========
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost","http://localhost:80","http://127.0.0.1"], 
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
)


# ======== Constantes ========
WMS_URL = "http://localhost:8081/geoserver/cartozome/ows"
UV_URL = "https://api.open-meteo.com/v1/forecast"
WFS_COMMUNES_URL = "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows"

WMS_LAYERS = {
    "Ambroisie": "cartozome:Ambroisie_2024_AURA",
    "NO2": "cartozome:mod_aura_2024_no2_moyan",
    "O3": "cartozome:mod_aura_2024_o3_nbjdep120",
    "PM10": "cartozome:mod_aura_2024_pm10_moyan",
    "PM2.5": "cartozome:mod_aura_2024_pm25_moyan",
    "Bruit": "cartozome:sous_indice_multibruit_orhane_2023"
}



# Conversion WGS84 -> Lambert 93
transformer = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)

class Coord(BaseModel):
    latitude: float
    longitude: float

class CoordList(BaseModel):
    coords: list[Coord]

# ======== fonction WMS/UV pour un point ========
async def fetch_point_data(client, lat, lon):
    # bbox autour du point
    x, y = transformer.transform(lon, lat)
    delta = 5
    bbox = f"{x-delta},{y-delta},{x+delta},{y+delta}"

    # WMS en parallèle
    async def fetch_wms(layer):
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
        r = await client.get(WMS_URL, params=params)
        data = r.json()
        if "features" in data and len(data["features"]) > 0:
            return data["features"][0]["properties"].get("GRAY_INDEX")
        return None

    wms_tasks = [fetch_wms(layer) for layer in WMS_LAYERS.values()]
    wms_values = await asyncio.gather(*wms_tasks)

    # UV
    try:
        r = await client.get(UV_URL, params={"latitude": lat, "longitude": lon, "current": "uv_index"})
        uv_value = r.json().get("current", {}).get("uv_index")
    except:
        uv_value = None

    result = {key: value for key, value in zip(WMS_LAYERS.keys(), wms_values)}
    result["UV"] = uv_value
    return result

# ======== endpoint optimisé pour liste de points ========
@app.post("/indicateursItineraire")
async def get_itineraire_data(coord_list: CoordList):
    async with httpx.AsyncClient(timeout=30) as client:
        # toutes les requêtes en parallèle
        tasks = [fetch_point_data(client, c.latitude, c.longitude) for c in coord_list.coords]
        results = await asyncio.gather(*tasks)
    return results

@app.post("/indicateursPoint")
async def get_point_data(coord: Coord):
    async with httpx.AsyncClient(timeout=10) as client:
        data = await fetch_point_data(client, coord.latitude, coord.longitude)
    return data





# ======== fonction pour afficher les données des UV ========

# -------- récupération des communes --------
async def fetch_communes():
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAME": "metropole-de-lyon:adr_voie_lieu.adrcomgl_2024",
        "OUTPUTFORMAT": "application/json",
        "SRSNAME": "EPSG:4326",
        "startIndex": 0,
        "count": 100
    }

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(WFS_COMMUNES_URL, params=params)
        r.raise_for_status()
        return r.json()

# -------- récupération UV avec retry --------
async def get_uv(client, lat, lon, retries=3):
    for _ in range(retries):
        try:
            r = await client.get(
                UV_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "uv_index"
                }
            )
            if r.status_code == 200:
                uv = r.json().get("current", {}).get("uv_index")
                if uv is not None:
                    return uv
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return None


# -------- enrichissement des communes --------
async def enrich_with_uv(communes_geojson):
    async with httpx.AsyncClient(timeout=30) as client:
        tasks = []

        for feature in communes_geojson["features"]:
            geom = shape(feature["geometry"])
            lat, lon = geom.centroid.y, geom.centroid.x
            tasks.append(get_uv(client, lat, lon))

        uv_values = await asyncio.gather(*tasks)

        for feature, uv in zip(communes_geojson["features"], uv_values):
            feature["properties"]["uv"] = uv

    return communes_geojson

# -------- endpoint API --------
@app.get("/uvCommunes")
async def uv_communes():

    communes = await fetch_communes()
    communes_uv = await enrich_with_uv(communes)

    return communes_uv