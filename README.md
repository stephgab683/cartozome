# 🗺️ Cartozome

> Application web de cartographie des expositions environnementales individuelles
> (qualité de l'air, bruit, UV, pollen) sur la métropole de Lyon.
> Développée pour le Centre Léon Bérard.

![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)
![Python](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi)
![Leaflet](https://img.shields.io/badge/Leaflet-frontend-199900?logo=leaflet)
![GeoServer](https://img.shields.io/badge/GeoServer-WMS%2FWCS-4CAF50)

## 📋 Prérequis

| Outil | Téléchargement | Vérification |
|-------|---------------|--------------|
| Git | [git-scm.com](https://git-scm.com/downloads) | `git --version` |
| Docker Desktop | [docker.com](https://www.docker.com/products/docker-desktop) | `docker --version` |
| Node.js | [nodejs.org](https://nodejs.org) | `node --version` |

## 🚀 Démarrage rapide
```bash
# Cloner le dépôt
git clone https://github.com/stephgab683/cartozome.git
cd cartozome

# Lancer l'application
docker compose up -d
```

➡️ Accessible sur **http://localhost:5173**
```bash
# Arrêter
docker compose down
```

## 🏗️ Architecture des services

| Service | Rôle | Port |
|---------|------|------|
| `backend` | API FastAPI — extraction des expositions | 8000 |
| `geoserver` | Publication des couches WMS/WCS | 8081 |
| `cron_uv` | Récupération UV toutes les 3h (Open-Meteo) | — |
| `caddy` | Reverse proxy / HTTPS | 80 / 443 |

## 📁 Structure du dépôt
```text
cartozome/
├── cartozome_api/        # Back-end FastAPI
├── cartozome_app/        # Front-end Leaflet/Vite
├── cartozome_geoserver/  # Configuration GeoServer + styles SLD
├── uv_fetcher/           # Pipeline Cron UV
├── Caddyfile
└── docker-compose.yml
```

<details>
<summary>📁 Voir l'arborescence complète</summary>
```text
cartozome/
├── cartozome_api/
│   ├── main.py
│   └── ...
```

</details>

## Table des matières
- [Prérequis](#-prérequis)
- [Démarrage rapide](#-démarrage-rapide)
- [Architecture](#-architecture-des-services)

> [!NOTE]
> Le premier lancement peut prendre plusieurs minutes.

> [!WARNING]
> Ne pas exposer l'interface GeoServer en production sans changer les identifiants par défaut.
