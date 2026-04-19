UI_DIR=ui
EMBED_DIR=internal/server/ui_dist
BINARY_NAME=kview
OUTPUT=$(BINARY_NAME)
DIST_DIR=dist
GOOS?=$(shell go env GOOS 2>/dev/null || echo linux)
GOARCH?=$(shell go env GOARCH 2>/dev/null || echo amd64)
DOCKER_IMAGE=kview-build:go1.25.0-node22.20.0
VERSION?=$(shell sh -c 'tag=""; \
	if [ "$$GITHUB_REF_TYPE" = "tag" ] && [ -n "$$GITHUB_REF_NAME" ]; then \
		tag="$$GITHUB_REF_NAME"; \
	else \
		tag=$$(git tag --points-at HEAD --sort=-version:refname 2>/dev/null | head -n 1); \
	fi; \
	if [ -n "$$tag" ]; then \
		printf "%s" "$$tag"; \
	elif git rev-parse --short=12 HEAD >/dev/null 2>&1; then \
		git rev-parse --short=12 HEAD; \
	else \
		printf "dev"; \
	fi')
GO_LDFLAGS=-X github.com/korex-labs/kview/internal/buildinfo.Version=$(VERSION)
DOCKER_RUN=docker run --rm \
	-u $(shell id -u):$(shell id -g) \
	-e HOME=/tmp \
	-e GOCACHE=/workspace/.cache/go-build \
	-e GOMODCACHE=/workspace/.cache/go-mod \
	-e npm_config_cache=/workspace/.cache/npm \
	-v "$(CURDIR):/workspace" \
	-w /workspace \
	$(DOCKER_IMAGE)

.PHONY: ui run build build-webview build-release docker-image build-docker build-docker-release clean check

check:
	cd $(UI_DIR) && npm run typecheck && npm run lint && npm run test
	go vet ./...
	go test ./...

ui:
	cd $(UI_DIR) && npm ci && npm run build
	rm -rf $(EMBED_DIR)
	mkdir -p $(EMBED_DIR)
	cp -r $(UI_DIR)/dist/* $(EMBED_DIR)/
	@echo "UI built and copied into $(EMBED_DIR)"

run: ui
	go run ./cmd/kview

build: ui
	go build -ldflags "$(GO_LDFLAGS)" -o $(OUTPUT) ./cmd/kview
	@echo "Built $(OUTPUT) (browser/server modes; default: browser)"

build-webview: ui
	go build -tags webview -ldflags "$(GO_LDFLAGS)" -o $(OUTPUT) ./cmd/kview
	@echo "Built $(OUTPUT) with webview support (default: webview)"

build-release: ui
	mkdir -p $(dir $(OUTPUT))
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -trimpath -ldflags "$(GO_LDFLAGS) -s -w" -o $(OUTPUT) ./cmd/kview
	@echo "Built $(OUTPUT) ($(GOOS)/$(GOARCH); browser/server modes; default: browser)"

docker-image:
	docker build -t $(DOCKER_IMAGE) .

build-docker: docker-image
	mkdir -p .cache/go-build .cache/go-mod .cache/npm
	$(DOCKER_RUN) make build OUTPUT=$(OUTPUT) VERSION=$(VERSION)

build-docker-release: docker-image
	mkdir -p .cache/go-build .cache/go-mod .cache/npm $(DIST_DIR)
	$(DOCKER_RUN) make build-release GOOS=$(GOOS) GOARCH=$(GOARCH) OUTPUT=$(OUTPUT) VERSION=$(VERSION)

clean:
	rm -rf $(UI_DIR)/dist
	rm -rf $(UI_DIR)/node_modules
	rm -rf $(EMBED_DIR)/*
	rm -rf $(DIST_DIR)
	@echo "Cleaned UI dist/node_modules and embedded ui_dist contents"
