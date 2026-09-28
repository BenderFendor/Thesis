FROM python:3.11-slim AS rust-builder

# Install Rust and maturin for building the Rust RSS parser 

ENV PATH="/root/.cargo/bin:${PATH}" 

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		curl \
		libssl-dev \
		pkg-config \
	&& rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
	&& pip install --no-cache-dir "maturin>=1.10.0"

WORKDIR /build
COPY backend/Cargo.toml ./Cargo.toml
COPY backend/Cargo.lock ./Cargo.lock
COPY backend/rss_parser_rust ./rss_parser_rust
COPY backend/crates ./crates
WORKDIR /build/rss_parser_rust
RUN maturin build --manifest-path Cargo.toml --release --locked --out /build/wheels

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
	&& mv /root/.local/bin/uv /usr/local/bin/uv \
	&& mv /root/.local/bin/uvx /usr/local/bin/uvx \
	&& rm -rf /root/.local/share/uv

# Copy requirements and install dependencies with uv
COPY backend/requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# Install Rust-powered RSS parser wheel
COPY --from=rust-builder /build/wheels/*.whl /tmp/rust_wheels/
RUN uv pip install --system --no-cache /tmp/rust_wheels/*.whl && rm -rf /tmp/rust_wheels

# Copy only the app directory which is required
COPY backend/app/ ./app/

# Copy backend root files (all .py files)
COPY backend/*.py ./

# Copy SQL files if present
RUN cp -r backend/*.sql ./ 2>/dev/null || true

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
