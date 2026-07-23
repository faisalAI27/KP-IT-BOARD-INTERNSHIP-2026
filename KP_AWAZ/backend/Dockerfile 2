FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    DATABASE_URL=sqlite:////data/database/kp_awaz.db \
    RAW_AUDIO_STORAGE_ROOT=/data/audio/raw \
    STORAGE_ROOT=/data/legacy-storage \
    AUDIO_STORAGE_SUBDIRECTORY=audio

WORKDIR /app

COPY backend/requirements-prod.txt ./requirements-prod.txt
RUN pip install --no-cache-dir -r requirements-prod.txt \
    && addgroup --system kpawaz \
    && adduser --system --ingroup kpawaz --home /app kpawaz \
    && mkdir -p /data/database /data/audio/raw /data/legacy-storage/audio \
    && chown -R kpawaz:kpawaz /app /data

COPY --chown=kpawaz:kpawaz backend/app ./app

USER kpawaz
VOLUME ["/data/database", "/data/audio/raw", "/data/legacy-storage/audio"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).read()"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-server-header"]
