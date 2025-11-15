FROM ghcr.io/pyo3/maturin:1.4.0 as rust-builder

WORKDIR /build
COPY backend/rss_parser_rust ./rss_parser_rust
WORKDIR /build/rss_parser_rust
RUN maturin build --release --locked

FROM python:3.11-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy requirements and install dependencies with uv
COPY backend/requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# Install Rust-powered RSS parser wheel
COPY --from=rust-builder /build/rss_parser_rust/target/wheels/*.whl /tmp/rust_wheels/
RUN pip install /tmp/rust_wheels/*.whl && rm -rf /tmp/rust_wheels

# Copy only the app directory which is required
COPY backend/app/ ./app/

# Copy backend root files (all .py files)
COPY backend/*.py ./

# Copy SQL files if present
RUN cp -r backend/*.sql ./ 2>/dev/null || true

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
