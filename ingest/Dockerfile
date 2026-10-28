# LibreOffice is the only way to render slides (CLAUDE.md, Gotchas), so it ships in the image
# rather than being installed on anyone's machine. Build this on each host: the Mac is arm64
# and Azure Container Apps is amd64.
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

# Metric-compatible fonts keep LibreOffice's layout close to PowerPoint's, which keeps the
# label boxes close to where the XML says they are. Tesseract reads labels baked into a
# figure's pixels (Tier 2): its boxes are exact, so OCR, not a vision model, places blanks.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-impress-nogui \
        tesseract-ocr \
        tesseract-ocr-eng \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

# LibreOffice and Tesseract parse files students upload, so the worker doesn't run as root.
RUN useradd --create-home --uid 10001 worker

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY app ./app

USER worker

# Claims jobs until stopped. SIGTERM finishes the current job first, so give `docker stop` a
# longer timeout than its default 10 s; `python -m app.cli` is still there for one-off runs.
CMD ["python", "-m", "app.worker"]
