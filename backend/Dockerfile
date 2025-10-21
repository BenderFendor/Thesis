FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy requirements and install dependencies with uv
COPY backend/requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# Copy only the app directory which is required
COPY backend/app/ ./app/

# Copy backend root files (all .py files)
COPY backend/*.py ./

# Copy SQL files if present
COPY backend/*.sql ./ 2>/dev/null || true

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]