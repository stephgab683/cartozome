FROM python:3.12-slim

WORKDIR /app

ENV TZ=Europe/Paris

# Installer cron (daemon) + outils utiles dans l'image
RUN apt-get update \
    && apt-get install -y --no-install-recommends cron procps tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Scripts Python
COPY openmeteo_request_uv_general.py /app/openmeteo_request_uv_general.py
COPY enrich_json_uv_communes.py /app/enrich_json_uv_communes.py

# Cron : copier puis normaliser CRLF->LF + retirer BOM éventuel, puis installer
COPY crontab /app/crontab
RUN sed -i 's/\r$//' /app/crontab \
    && sed -i '1s/^\xEF\xBB\xBF//' /app/crontab \
    && chmod 0644 /app/crontab \
    && crontab /app/crontab

# Entrypoint : copier puis normaliser CRLF->LF + retirer BOM éventuel, puis rendre exécutable
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh \
    && sed -i '1s/^\xEF\xBB\xBF//' /entrypoint.sh \
    && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
