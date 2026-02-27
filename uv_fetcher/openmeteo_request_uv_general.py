import os
import requests
from pathlib import Path

# URL de requête vers l’API Open-Meteo
url = "https://api.open-meteo.com/v1/forecast?latitude=45.820531,45.869215,45.812209,45.914129,45.673298,45.735886,45.798335,45.701567,45.771983,45.762989,45.825812,45.668335,45.754934,45.608641,45.864054,45.840343,45.855450,45.786144,45.701773,45.781869,45.665119,45.777157,45.877300,45.830951,45.650882,45.791274,45.704245,45.738135,45.738018,45.780074,45.828442,45.646033,45.771046,45.882728,45.730167,45.784973,45.761291,45.835572,45.843178,45.815030,45.746003,45.581312,45.860326,45.694318,45.649514,45.797678,45.810248,45.822066,45.855206,45.675100,45.898288,45.734669,45.859387,45.847983,45.843658,45.883428,45.819271,45.708464&longitude=4.898870,4.818375,4.746933,4.773641,4.857801,4.793586,4.786579,4.850547,4.961720,4.754962,4.874488,4.908523,4.836349,4.787176,4.830634,4.886168,4.794546,4.926687,4.948938,4.772621,4.948962,5.006306,4.867615,4.771214,4.790352,5.041326,4.881208,4.962252,4.756216,4.743163,4.856335,4.838183,4.888995,4.800971,4.812673,4.711462,4.726880,4.820135,4.854460,4.797860,4.726872,4.757955,4.883992,4.789338,4.809468,4.851583,4.712360,4.842634,4.745332,4.817791,4.837983,4.911928,4.850884,4.821752,4.838697,4.844178,4.818183,4.815172&daily=uv_index_max&models=meteofrance_seamless&forecast_days=1&timezone=Europe/Paris"

# Exécution de la requête HTTP
response = requests.get(
    url,
    timeout=60, #sans réponse de l'API en 60 secondes = exception levée = empêche le script de rester bloqué indéfiniment
    headers={"User-Agent":"cartozome-uv-fetcher/1.0"} #identification du client côté serveur
    )
response.raise_for_status() #vérification statut HTTP = exception immédiate si 4xx ou 5xx pour empêcher d'écrire un JSON vide ou erroné

# Détermination d’un répertoire de sortie portable :
    # On se base sur l’emplacement du script lui-même.
    # __file__ : chemin du script Python en cours
    # parent : dossier contenant le script

base_dir = Path(__file__).resolve().parent
output = base_dir / "DATA_API" #sous-dossier cible

# Création du dossier si absent
# Si le dossier DATA_API existe déjà, aucune exception n'est levée (idempotence)
output.mkdir(exist_ok=True)

#Définition du fichier final
#Le fichier du jour remplace celui d'hier

    #Attention, le script Python et le front (GeoServer) tournent en parallèle dans Docker quand le cron s'active
    #Or l'écriture d'un fichier n'est pas instantanée, donc le front peut lire un JSON vide ou erroné le temps que le nouveau JSON soit écrit
    #Donc on écrit le nouveau JSON d'abord dans un fichier temporaire, comme ça l'écriture du nouveau JSON final est instantanée = pas de bug potentiel
    #JSON de la veille > écriture du nouveau JSON dans un fichier temporaire > remplacement du JSON de la veille instantanément par le temporaire = nouveau JSON final d'aujourd'hui

final_path=output/"openmeteo_uv_meteofrance.json" #nom fixe pour éviter historique et avoir un chemin stable
tmp_path=output/"openmeteo_uv_meteofrance.json.tmp" #création du fichier temporaire (vide) utilisé pour écriture atomique
tmp_path.write_text(response.text,encoding="utf-8") #écriture dans le fichier temporaire
os.replace(tmp_path,final_path) #remplacement du JSON de la veille par le fichier temporaire = le nouveau JSON

print("Fichier enregistré :", final_path)
