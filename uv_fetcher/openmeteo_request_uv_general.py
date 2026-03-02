import os
import json
import requests
from pathlib import Path
from enrich_json_uv_communes import get_code_insee

LAT = "45.820531,45.869215,45.812209,45.914129,45.673298,45.735886,45.798335,45.701567,45.771983,45.762989,45.825812,45.668335,45.754934,45.608641,45.864054,45.840343,45.855450,45.786144,45.701773,45.781869,45.665119,45.777157,45.877300,45.830951,45.650882,45.791274,45.704245,45.738135,45.738018,45.780074,45.828442,45.646033,45.771046,45.882728,45.730167,45.784973,45.761291,45.835572,45.843178,45.815030,45.746003,45.581312,45.860326,45.694318,45.649514,45.797678,45.810248,45.822066,45.855206,45.675100,45.898288,45.734669,45.859387,45.847983,45.843658,45.883428,45.819271,45.708464"
LON = "4.898870,4.818375,4.746933,4.773641,4.857801,4.793586,4.786579,4.850547,4.961720,4.754962,4.874488,4.908523,4.836349,4.787176,4.830634,4.886168,4.794546,4.926687,4.948938,4.772621,4.948962,5.006306,4.867615,4.771214,4.790352,5.041326,4.881208,4.962252,4.756216,4.743163,4.856335,4.838183,4.888995,4.800971,4.812673,4.711462,4.726880,4.820135,4.854460,4.797860,4.726872,4.757955,4.883992,4.789338,4.809468,4.851583,4.712360,4.842634,4.745332,4.817791,4.837983,4.911928,4.850884,4.821752,4.838697,4.844178,4.818183,4.815172"

BASE_URL = "https://api.open-meteo.com/v1/forecast"

params = {
    "latitude": LAT,
    "longitude": LON,
    "hourly": "uv_index",
    "forecast_days": 1,
    "timezone": "Europe/Paris",
}

r = requests.get(BASE_URL, params=params, timeout=60, headers={"User-Agent": "cartozome-uv-fetcher/1.0"})
r.raise_for_status()
data = r.json()

# En multi-coordonnées, on attend une liste
if not isinstance(data, list):
    raise RuntimeError(f"Réponse inattendue (type={type(data)}), attendu: list")

out_points = []
non_null = 0
missing_insee = 0

for i, p in enumerate(data):
    uvs = p.get("hourly", {}).get("uv_index") or []
    uvs_num = [v for v in uvs if isinstance(v, (int, float))]
    uv_max = max(uvs_num) if uvs_num else None

    # date du jour = première timestamp horaire (YYYY-MM-DD)
    t0 = (p.get("hourly", {}).get("time") or [""])[0]
    day = t0[:10] if t0 else None

    if uv_max is not None:
        non_null += 1

    # On garde une structure compatible avec ton front (daily.uv_index_max[0])
    out_points.append({
        "latitude": p.get("latitude"),
        "longitude": p.get("longitude"),
        "code_insee": None,
        "generationtime_ms": p.get("generationtime_ms"),
        "utc_offset_seconds": p.get("utc_offset_seconds"),
        "timezone": p.get("timezone"),
        "timezone_abbreviation": p.get("timezone_abbreviation"),
        "elevation": p.get("elevation"),
        "location_id": p.get("location_id", i),
        "daily_units": {"time": "iso8601", "uv_index_max": "index"},
        "daily": {"time": [day], "uv_index_max": [uv_max]},
    })

if non_null == 0:
    raise RuntimeError("UV: toutes les valeurs sont null (hourly=uv_index vide) → fichier non écrit")

# Écriture dans le volume monté (par défaut /app/DATA_API)
out_dir = Path(os.environ.get("DATA_API_DIR", "/app/DATA_API"))
out_dir.mkdir(parents=True, exist_ok=True)

final_path = out_dir / "openmeteo_uv_meteofrance.json"
tmp_path = out_dir / "openmeteo_uv_meteofrance.json.tmp"
tmp_path.write_text(json.dumps(out_points, ensure_ascii=False), encoding="utf-8")
os.replace(tmp_path, final_path)

print("Fichier enregistré :", final_path, "| points:", len(out_points), "| non_null:", non_null)
