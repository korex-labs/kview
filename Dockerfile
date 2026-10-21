ARG NODE_IMAGE=node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37
ARG GO_IMAGE=golang:1.26.10-bookworm@sha256:fe3da92a5cb2881e4aa75e625cb0b7c50571632fb4cf340cbe53e6ccdcffdd51

FROM ${NODE_IMAGE} AS node

FROM ${GO_IMAGE}

COPY --from=node /usr/local /usr/local

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		chromium \
		g++ \
		pkg-config \
		libgtk-3-dev \
		libwebkit2gtk-4.1-dev \
	&& dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' \
	&& webkit_pc_dir="$(pkg-config --variable=pcfiledir webkit2gtk-4.1)" \
	&& ln -s "${webkit_pc_dir}/webkit2gtk-4.1.pc" "${webkit_pc_dir}/webkit2gtk-4.0.pc" \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

ENV GOCACHE=/workspace/.cache/go-build \
	GOMODCACHE=/workspace/.cache/go-mod \
	npm_config_cache=/workspace/.cache/npm

RUN go version && node --version && npm --version
