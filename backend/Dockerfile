FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
ARG DEBIAN_MIRROR=
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN if [ -n "$DEBIAN_MIRROR" ]; then sed -i "s|http://deb.debian.org|$DEBIAN_MIRROR|g; s|https://deb.debian.org|$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN --mount=type=bind,source=.,target=/build-context \
    if [ -d /build-context/.wheels ]; then \
        pip install --no-cache-dir --no-index --find-links=/build-context/.wheels -r requirements.txt; \
    else \
        pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r requirements.txt; \
    fi
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini article-sources.json ./
RUN useradd --create-home --uid 10001 todo && mkdir /app/.runtime && chown -R todo:todo /app
USER todo
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
