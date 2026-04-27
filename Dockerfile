ARG NODE_IMAGE=node:22.20.0-bookworm@sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7
ARG GO_IMAGE=golang:1.26.2-bookworm@sha256:47ce5636e9936b2c5cbf708925578ef386b4f8872aec74a67bd13a627d242b19

FROM ${NODE_IMAGE} AS node

FROM ${GO_IMAGE}

COPY --from=node /usr/local /usr/local

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		g++ \
		pkg-config \
		libgtk-3-dev \
		libwebkit2gtk-4.1-dev \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

ENV GOCACHE=/workspace/.cache/go-build \
	GOMODCACHE=/workspace/.cache/go-mod \
	npm_config_cache=/workspace/.cache/npm

RUN go version && node --version && npm --version
