import requests
from typing import Optional

GEOSERVER_WFS = "http://geoserver:8080/geoserver/cartozome/ows"  # depuis le conteneur uv_fetcher
LAYER = "cartozome:communes"

def get_code_insee(lon: float, lat: float) -> Optional[str]:
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": LAYER,
        "outputFormat": "application/json",
        "propertyName": "code_insee",
        "count": 1,
        "cql_filter": f"INTERSECTS(geometrie,POINT({lon} {lat}))",
    }

    try:
        r = requests.get(
            GEOSERVER_WFS,
            params=params,
            timeout=20,
            headers={"User-Agent": "cartozome-uv-fetcher/1.0"},
        )
        r.raise_for_status()
        fc = r.json()
    except Exception:
        # On renvoie None en cas de pépin réseau/GeoServer pour ne pas bloquer le pipeline UV.
        return None

    feats = fc.get("features", [])
    if not feats:
        return None
    return feats[0].get("properties", {}).get("code_insee")