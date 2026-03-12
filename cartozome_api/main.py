import os
os.environ["USE_CACHE"] = "False"
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import asyncio
import json
import math
import osmnx as ox
from pyproj import Transformer
from pathlib import Path
from typing import List, Dict, Optional, Union
from shapely.geometry import LineString
import geopandas as gpd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5174",
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
    coords: List[Coord]

class RouteRequest(BaseModel):
    start: Coord
    end: Coord

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
    try:
        return float(values[0])
    except (TypeError, ValueError):
        return None

def find_nearest_uv(lat: float, lon: float, uv_points: List[Dict]) -> Optional[float]:
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

async def fetch_point_data(client: httpx.AsyncClient, lat: float, lon: float, uv_points: List[Dict]) -> Dict:
    x, y = transformer.transform(lon, lat)
    delta = 5
    bbox = f"{x-delta},{y-delta},{x+delta},{y+delta}"

    async def fetch_wms(layer: str) -> Optional[float]:
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

# Nouvelle route pour le calcul d'itinéraire vélo avec OSMnx
from concurrent.futures import ThreadPoolExecutor
import asyncio
from shapely.geometry import LineString
import geopandas as gpd

# Executor global pour calcul OSMnx
executor = ThreadPoolExecutor(max_workers=2)

# Fonction utilitaire pour convertir un itinéraire en GeoDataFrame
def route_to_gdf(G, route_nodes):
    lines = []
    for u, v in zip(route_nodes[:-1], route_nodes[1:]):
        data = G.get_edge_data(u, v)
        if data is not None:
            edge_data = data[list(data.keys())[0]]  # première arête si multi-edges
            geom = edge_data.get(
                "geometry",
                LineString([(G.nodes[u]["x"], G.nodes[u]["y"]),
                            (G.nodes[v]["x"], G.nodes[v]["y"])])
            )
            lines.append(geom)
    gdf = gpd.GeoDataFrame(geometry=lines, crs=G.graph["crs"])
    return gdf

# Fonction synchrone pour calcul de l'itinéraire
def calc_route_sync(route):
    import osmnx as ox
    from pyproj import Transformer

    # 1. Centre et distance
    center_lat = (route.start.latitude + route.end.latitude) / 2
    center_lon = (route.start.longitude + route.end.longitude) / 2
    center_address = f"{center_lat}, {center_lon}"

    # 2. Distance max 5 km pour limiter le graphe
    distance_meters = min(
        ox.distance.great_circle(
            route.start.latitude, route.start.longitude,
            route.end.latitude, route.end.longitude
        ) * 1.5,
        5000
    )

    # 3. Récupérer le graphe vélo simplifié
    G = ox.graph_from_address(
        address=center_address,
        dist=distance_meters,
        network_type="bike",
        dist_type="bbox",
        simplify=True
    )

    # 4. Projeter le graphe
    G_proj = ox.project_graph(G)

    # 5. Transformer les coordonnées
    transformer = Transformer.from_crs("EPSG:4326", G_proj.graph["crs"], always_xy=True)
    start_point = transformer.transform(route.start.longitude, route.start.latitude)
    end_point = transformer.transform(route.end.longitude, route.end.latitude)

    # 6. Trouver les nœuds les plus proches
    origin_node = ox.distance.nearest_nodes(G_proj, start_point[0], start_point[1])
    destination_node = ox.distance.nearest_nodes(G_proj, end_point[0], end_point[1])

    # 7. Calculer l’itinéraire le plus court
    shortest_route = ox.shortest_path(G_proj, origin_node, destination_node, weight="length")

    # 8. Convertir en GeoDataFrame
    route_gdf = route_to_gdf(G_proj, shortest_route)

    # 9. Reprojeter en WGS84
    route_gdf = route_gdf.to_crs(epsg=4326)

    return route_gdf

# Endpoint asynchrone pour FastAPI
@app.post("/itineraire/velo")
async def itineraire_velo(route: RouteRequest):
    try:
        loop = asyncio.get_event_loop()
        # Exécuter le calcul dans un thread séparé pour ne pas bloquer FastAPI
        route_gdf = await loop.run_in_executor(executor, calc_route_sync, route)
        # Retourner GeoJSON
        return json.loads(route_gdf.to_json())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du calcul de l'itinéraire vélo : {str(e)}")