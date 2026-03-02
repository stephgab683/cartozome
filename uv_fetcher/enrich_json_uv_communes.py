#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path

import requests
from shapely.geometry import Point, mapping, shape
from shapely.strtree import STRtree

DATA_DIR = Path(os.environ.get("DATA_API_DIR", "/app/DATA_API"))

POINTS_IN = DATA_DIR / "openmeteo_uv_meteofrance.json"
POINTS_OUT = DATA_DIR / "openmeteo_uv_meteofrance_enriched.json"
COMMUNES_OUT = DATA_DIR / "communes_uv.geojson"

WFS_URL = os.environ.get("GEOSERVER_WFS_URL", "http://geoserver:8080/geoserver/wfs")
TYPENAME = os.environ.get("COMMUNES_TYPENAME", "cartozome:communes")
INSEE_FIELD = os.environ.get("COMMUNES_INSEE_FIELD", "code_insee")


def _swap_xy_coords(obj):
    """Swap (x,y) <-> (y,x) recursively in a GeoJSON-like coordinates structure."""
    if isinstance(obj, list):
        if len(obj) == 2 and all(isinstance(v, (int, float)) for v in obj):
            return [obj[1], obj[0]]
        return [_swap_xy_coords(e) for e in obj]
    return obj


def _needs_swap_lonlat(geom):
    """
    Detect if a geometry likely comes as (lat, lon) instead of (lon, lat).
    For metropolitan France, lon is roughly [-6..11], lat is roughly [41..52].
    If x looks like a latitude (~40-55) and y looks like a longitude (~-10..20), we swap.
    """
    coords = geom.get("coordinates")
    sample = None

    def find_first_pair(c):
        nonlocal sample
        if sample is not None:
            return
        if isinstance(c, list):
            if len(c) == 2 and all(isinstance(v, (int, float)) for v in c):
                sample = c
                return
            for e in c:
                find_first_pair(e)

    find_first_pair(coords)
    if not sample:
        return False

    x, y = sample[0], sample[1]
    return (40 <= x <= 55) and (-10 <= y <= 20)


def compute_bbox(points, pad=0.05):
    xs, ys = [], []
    for p in points:
        lon = p.get("longitude")
        lat = p.get("latitude")
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)):
            xs.append(lon)
            ys.append(lat)
    if not xs:
        raise RuntimeError("Aucun point valide (latitude/longitude) dans openmeteo_uv_meteofrance.json.")
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    return (minx - pad, miny - pad, maxx + pad, maxy + pad)


def fetch_communes_geojson(bbox):
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": TYPENAME,
        "outputFormat": "application/json",
        "srsName": "CRS:84",
        "bbox": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},CRS:84",
    }

    last_err = None
    for _attempt in range(1, 11):  # 10 tentatives
        try:
            r = requests.get(WFS_URL, params=params, timeout=20)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            time.sleep(2)

    raise RuntimeError(f"WFS indisponible après plusieurs tentatives: {last_err}")


def uv_from_point(p):
    daily = p.get("daily") or {}
    arr = daily.get("uv_index_max") or [None]
    v = arr[0] if arr else None
    return float(v) if isinstance(v, (int, float)) else None


def main():
    if not POINTS_IN.exists():
        raise FileNotFoundError(f"Fichier introuvable: {POINTS_IN}")

    points = json.loads(POINTS_IN.read_text(encoding="utf-8"))
    bbox = compute_bbox(points)

    communes_fc = fetch_communes_geojson(bbox)
    feats = communes_fc.get("features", [])
    if not feats:
        raise RuntimeError("WFS communes: 0 feature. Vérifie la couche et l’emprise.")

    geoms = []
    props_list = []

    swapped = 0
    for f in feats:
        geom = f["geometry"]
        if _needs_swap_lonlat(geom):
            geom = dict(geom)  # shallow copy
            geom["coordinates"] = _swap_xy_coords(geom["coordinates"])
            swapped += 1

        geoms.append(shape(geom))
        props_list.append(f.get("properties", {}))

    tree = STRtree(geoms)
    props_by_id = {id(g): props_list[i] for i, g in enumerate(geoms)}

    uv_by_insee = {}
    missing = 0

    for p in points:
        lon = p.get("longitude")
        lat = p.get("latitude")
        if not (isinstance(lon, (int, float)) and isinstance(lat, (int, float))):
            p["code_insee"] = None
            missing += 1
            continue

        pt = Point(lon, lat)
        idxs = tree.query(pt)

        code = None
        for idx in idxs:
            g = geoms[int(idx)]
            if g.covers(pt):
                code = props_list[int(idx)].get(INSEE_FIELD)
                break

        p["code_insee"] = code

        uv = uv_from_point(p)
        if code is None:
            missing += 1
        elif uv is not None:
            uv_by_insee.setdefault(code, []).append(uv)

    POINTS_OUT.write_text(json.dumps(points, ensure_ascii=False), encoding="utf-8")

    out_features = []
    for i, g in enumerate(geoms):
        props = dict(props_list[i])
        code = props.get(INSEE_FIELD)
        vals = uv_by_insee.get(code, [])
        props["uv_max"] = max(vals) if vals else None
        props["uv_mean"] = (sum(vals) / len(vals)) if vals else None
        out_features.append(
            {
                "type": "Feature",
                "geometry": mapping(g),
                "properties": props,
            }
        )

    COMMUNES_OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": out_features}, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"[enrich] points_in   : {POINTS_IN}")
    print(f"[enrich] points_out  : {POINTS_OUT}")
    print(f"[enrich] communes_uv : {COMMUNES_OUT}")
    print(f"[enrich] missing commune: {missing}/{len(points)}")
    print(f"[enrich] swapped geometries (axis fix): {swapped}/{len(feats)}")


if __name__ == "__main__":
    main()
