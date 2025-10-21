FROM python:3.12-slim

WORKDIR /app

# Install system dependencies and update ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies with pip
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt

# Copy only the app directory which is required
COPY backend/app/ ./app/

# Copy backend root files (all .py files)
COPY backend/*.py ./

# Copy SQL files if present
COPY backend/*.sql ./ 2>/dev/null || true

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]