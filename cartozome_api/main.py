from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from pyproj import Transformer
import asyncio
import json
import math
from pathlib import Path

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost",
        "http://localhost:80",
        "http://127.0.0.1"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
)

WMS_URL = "http://geoserver:8080/geoserver/cartozome/ows"
DATA_DIR = Path("/app/DATA_API")
UV_POINTS_FILE = DATA_DIR / "openmeteo_uv_meteofrance_enriched.json"

WMS_LAYERS = {
    "Ambroisie": "cartozome:Ambroisie_2024_AURA",
    "NO2": "cartozome:mod_aura_2024_no2_moyan",
    "O3": "cartozome:mod_aura_2024_o3_nbjdep120",
    "PM10": "cartozome:mod_aura_2024_pm10_moyan",
    "PM2.5": "cartozome:mod_aura_2024_pm25_moyan",
    "Bruit": "cartozome:sous_indice_multibruit_orhane_2023"
}

transformer = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


class Coord(BaseModel):
    latitude: float
    longitude: float


class CoordList(BaseModel):
    coords: list[Coord]


def load_uv_points():
    if not UV_POINTS_FILE.exists():
        return []

    try:
        with UV_POINTS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def get_uv_value_from_point_record(record):
    daily = record.get("daily", {})
    values = daily.get("uv_index_max", [])
    if not values:
        return None

    value = values[0]

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def find_nearest_uv(lat, lon, uv_points):
    best_uv = None
    best_dist = None

    for p in uv_points:
        plat = p.get("latitude")
        plon = p.get("longitude")
        if not isinstance(plat, (int, float)) or not isinstance(plon, (int, float)):
            continue

        uv = get_uv_value_from_point_record(p)
        if uv is None:
            continue

        dist = math.hypot(lat - plat, lon - plon)
        if best_dist is None or dist < best_dist:
            best_dist = dist
            best_uv = uv

    return best_uv


async def fetch_point_data(client, lat, lon, uv_points):
    x, y = transformer.transform(lon, lat)
    delta = 5
    bbox = f"{x-delta},{y-delta},{x+delta},{y+delta}"

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

        try:
            r = await client.get(WMS_URL, params=params)
            r.raise_for_status()
            data = r.json()
            if "features" in data and len(data["features"]) > 0:
                return data["features"][0]["properties"].get("GRAY_INDEX")
        except Exception:
            return None

        return None

    wms_tasks = [fetch_wms(layer) for layer in WMS_LAYERS.values()]
    wms_values = await asyncio.gather(*wms_tasks)

    uv_value = find_nearest_uv(lat, lon, uv_points)

    result = {key: value for key, value in zip(WMS_LAYERS.keys(), wms_values)}
    result["UV"] = uv_value
    return result


@app.post("/indicateursItineraire")
async def get_itineraire_data(coord_list: CoordList):
    uv_points = load_uv_points()

    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [
            fetch_point_data(client, c.latitude, c.longitude, uv_points)
            for c in coord_list.coords
        ]
        results = await asyncio.gather(*tasks)

    return results


@app.post("/indicateursPoint")
async def get_point_data(coord: Coord):
    uv_points = load_uv_points()

    async with httpx.AsyncClient(timeout=10) as client:
        data = await fetch_point_data(client, coord.latitude, coord.longitude, uv_points)

    return data


@app.get("/uvCommunes")
async def uv_communes():
    geojson_file = DATA_DIR / "communes_uv.geojson"
    if not geojson_file.exists():
        return {"type": "FeatureCollection", "features": []}

    with geojson_file.open("r", encoding="utf-8") as f:
        return json.load(f)
