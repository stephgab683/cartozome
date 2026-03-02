FROM python:3.12-slim

WORKDIR /app

ENV TZ=Europe/Paris

# Installer cron (daemon) dans l'image
RUN apt-get update \
    && apt-get install -y --no-install-recommends cron procps tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# (Optionnel) Si tu as des dépendances Python à installer, décommente ces lignes
# COPY requirements.txt /app/requirements.txt
# RUN pip install --no-cache-dir -r /app/requirements.txt

# Copier le script Python dans l'image
COPY openmeteo_request_uv_general.py /app/openmeteo_request_uv_general.py
COPY enrich_json_uv_communes.py /app/enrich_json_uv_communes.py

# Copier la règle cron et l'enregistrer dans la crontab du conteneur
COPY crontab /app/crontab
RUN sed -i 's/\r$//' /app/crontab \
    && chmod 0644 /app/crontab \
    && crontab /app/crontab

# Copier l'entrypoint qui démarre cron et garde le conteneur vivant
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
