# Cartozome

> Application web de cartographie des expositions environnementales individuelles
> (qualité de l'air, bruit, UV, pollen) sur la métropole de Lyon.
> Développée pour le **Centre Léon Bérard**.

![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Python](https://img.shields.io/badge/FastAPI-back--end-009688?logo=fastapi&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-front--end-199900?logo=leaflet&logoColor=white)
![GeoServer](https://img.shields.io/badge/GeoServer-WMS%2FWCS-4CAF50?logoColor=white)
![Vite](https://img.shields.io/badge/Vite-bundler-646CFF?logo=vite&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Table des matières

- [Prérequis](#-prérequis)
- [Démarrage rapide](#-démarrage-rapide)
- [Architecture des services](#-architecture-des-services)
- [Configuration des couches GeoServer](#-configuration-des-couches-geoserver)
- [Mise à jour des données](#-mise-à-jour-des-données)
- [Développement](#-développement)
- [Références](#-références)

---

## Prérequis

Avant de déployer l'application, s'assurer que les outils suivants sont installés sur la machine hôte :

| Outil | Téléchargement | Vérification |
|-------|---------------|--------------|
| Git | [git-scm.com](https://git-scm.com/downloads) | `git --version` |
| Docker Desktop | [docker.com](https://www.docker.com/products/docker-desktop) | `docker --version` |
| Docker Compose | Inclus dans Docker Desktop | `docker compose version` |
| Node.js | [nodejs.org](https://nodejs.org/en/download) | `node --version` |
| npm | Inclus avec Node.js | `npm --version` |

> [!NOTE]
> L'application a été développée sous Windows. Elle est déployée via Docker Compose, ce qui la rend indépendante du système d'exploitation de la machine hôte.

---

## Démarrage rapide

### 1. Cloner le dépôt

```bash
git clone https://github.com/stephgab683/cartozome.git
cd cartozome
```

### 2. Lancer l'application

```bash
docker compose up -d --build
```

Cette commande télécharge les images Docker nécessaires et démarre les quatre services (back-end Python, GeoServer, Cron UV, Caddy).

> [!NOTE]
> Le premier lancement peut prendre plusieurs minutes selon la connexion réseau.

➡️ L'application est ensuite accessible sur un port local affiché dans le terminal : **http://localhost:####/**

### 3. Arrêter l'application

```bash
docker compose down
```

---

## Architecture des services

L'application repose sur quatre conteneurs orchestrés par Docker Compose :

| Service | Rôle | Port exposé |
|---------|------|-------------|
| `cartozome_app` | Application web (HTML, CSS, JS) — interface utilisateur | 8080 (interne) |
| `cartozome_api` | API FastAPI — extraction des valeurs d'exposition | 8000 (interne) |
| `cartozome_geoserver` | Publication des couches WMS environnementales | 8081 (interne) |
| `cron_uv` | Récupération périodique des indices UV (Open-Meteo) | — |
| `caddy` | Reverse proxy, routage, HTTPS | 80 / 443 |

---

## Configuration des couches GeoServer

Les couches environnementales (qualité de l'air, pollen, bruit) sont publiées dans GeoServer à partir des flux WMS Atmo AURA et du flux ORHANE/Cerema.

L'interface d'administration GeoServer est accessible à l'adresse :
**http://localhost:8081/geoserver/web/**

> [!WARNING]
> Identifiants par défaut — à modifier en production :
> - Login : `admin`
> - Mot de passe : `geoserver`

### Couches à publier

| Nom de couche | Source | Type |
|---------------|--------|------|
| `mod_aura_2024_no2_moyan` | Atmo AURA | WMS |
| `mod_aura_2024_pm25_moyan` | Atmo AURA | WMS |
| `mod_aura_2024_pm10_moyan` | Atmo AURA | WMS |
| `mod_aura_2024_o3_nbjdep120` | Atmo AURA | WMS |
| `Ambroisie_2024_AURA` | Atmo AURA | WMS |
| `sous_indice_multibruit_orhane_2023` | Cerema/ORHANE | WMS |
| `communes_metropole` | IGN Admin Express | WFS |

---

## Mise à jour des données

### Qualité de l'air et pollen (Atmo AURA)

Les cartes WMS Atmo AURA sont publiées annuellement. Pour mettre à jour les couches lors de la publication des données d'une nouvelle année, il suffit de substituer les flux WMS source dans GeoServer **sans modifier le code applicatif**. Les URL des flux WMS sont disponibles sur le portail ArcGIS d'Atmo AURA.

### Bruit (Cerema/ORHANE)

L'indice multi-bruit ORHANE est mis à jour selon un cycle quinquennal (dernière mise à jour : 2023, prochaine attendue : 2028). La procédure de mise à jour est identique à celle des couches qualité de l'air.

### UV (Open-Meteo)

Les données UV sont récupérées **automatiquement toutes les 3 heures** par la tâche Cron, sans intervention manuelle. En cas d'indisponibilité prolongée de l'API, les dernières valeurs mises en cache restent servies par l'application.

Pour vérifier le bon fonctionnement du pipeline UV :

```bash
docker compose logs cron_uv
```

---

## Développement

### Structure du dépôt

<details>
<summary> Voir l'arborescence complète</summary>

```text
cartozome/
├── cartozome_api/                          # Back-end Python (FastAPI)
│   ├── dockerfile
│   ├── main.py
│   └── requirements.txt
├── cartozome_app/                          # Front-end (Leaflet/Vite)
│   ├── .github/
│   │   └── workflows/
│   ├── img/                                # Assets graphiques
│   │   ├── air.png
│   │   ├── bruit.png
│   │   ├── pollen.png
│   │   ├── uv.png
│   │   ├── logo.png
│   │   └── leonberard.png
│   ├── index.html
│   ├── main.js
│   ├── popups.js
│   ├── style.css
│   └── vite.config.js
├── cartozome_geoserver/opt/                # Configuration GeoServer
│   ├── gwc-layers/                         # Cache tuiles (GeoWebCache)
│   ├── gwc/
│   ├── styles/                             # Styles SLD
│   └── workspaces/
│       └── cartozome/
│           ├── air/                        # Couches NO2, O3, PM10, PM2.5
│           ├── ambroisie/                  # Couche pollen ambroisie
│           └── pollution_sonore/           # Couche bruit ORHANE
├── uv_fetcher/                             # Pipeline Cron UV
│   ├── Dockerfile
│   ├── crontab
│   ├── entrypoint.sh
│   ├── openmeteo_request_uv_general.py
│   ├── enrich_json_uv_communes.py
│   └── requirements.txt
├── .gitignore
├── Caddyfile
├── docker-compose.yml
└── package-lock.json
```

</details>

### Lancer le front-end en mode développement

Pour travailler sur le front-end sans reconstruire les conteneurs à chaque modification, lancer le serveur de développement Vite séparément. Placez vous dans le dossier cartozome_app puis lancez les commandes suivantes : 

```bash
npm install
npm start
```

Le front-end est alors accessible sur un port local affiché dans le terminal **http://localhost:####** et se connecte aux services back-end démarrés via Docker Compose.

### Reconstruire les conteneurs

Après modification du back-end ou du `docker-compose.yml` :

```bash
docker compose up -d --build
```

---

## Licence
 
Ce projet est distribué sous licence **MIT** — voir le fichier [`LICENSE`](LICENSE) pour le détail.
 
En résumé : vous êtes libre de réutiliser, modifier et distribuer ce code, y compris à des fins commerciales, à condition de conserver la mention de copyright originale.
 
---
 
## Références
 
| Ressource | Lien |
|-----------|------|
| Dépôt GitHub | [github.com/stephgab683/cartozome](https://github.com/stephgab683/cartozome) |
| Documentation GeoServer | [docs.geoserver.org](https://docs.geoserver.org) |
| API Open-Meteo | [open-meteo.com/en/docs](https://open-meteo.com/en/docs) |
| Géoplateforme IGN | [data.geopf.fr](https://data.geopf.fr) |
| Portail Atmo AURA | [atmo-auvergnerhonealpes.fr](https://www.atmo-auvergnerhonealpes.fr) |
| Plateforme ORHANE/Cerema | [cerema.fr](https://www.cerema.fr) |
