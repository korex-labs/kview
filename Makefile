UI_DIR=ui
EMBED_DIR=internal/server/ui_dist
BINARY_NAME=kview
OUTPUT=$(BINARY_NAME)
DIST_DIR=dist
GOOS?=linux
GOARCH?=amd64
DOCKER_IMAGE=kview-build:go1.25.0-node22.20.0
COVERAGE_DIR=.artifacts/coverage
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

.DEFAULT_GOAL := all

.PHONY: all check lint-go coverage ui build build-webview build-release docker-image clean prepare-cache local-check local-lint-go local-coverage local-ui local-build local-build-webview local-build-release

all: check build

prepare-cache:
	mkdir -p .cache/go-build .cache/go-mod .cache/npm

check: docker-image prepare-cache
	$(DOCKER_RUN) make local-check

lint-go: docker-image prepare-cache
	$(DOCKER_RUN) make local-lint-go

coverage: docker-image prepare-cache
	$(DOCKER_RUN) make local-coverage COVERAGE_DIR=$(COVERAGE_DIR)

ui: docker-image prepare-cache
	$(DOCKER_RUN) make local-ui

build: docker-image prepare-cache
	$(DOCKER_RUN) make local-build OUTPUT=$(OUTPUT) VERSION=$(VERSION)

build-webview: docker-image prepare-cache
	$(DOCKER_RUN) make local-build-webview OUTPUT=$(OUTPUT) VERSION=$(VERSION)

build-release: docker-image prepare-cache
	mkdir -p $(DIST_DIR)
	$(DOCKER_RUN) make local-build-release GOOS=$(GOOS) GOARCH=$(GOARCH) OUTPUT=$(OUTPUT) VERSION=$(VERSION)

local-check:
	cd $(UI_DIR) && npm ci && npm run typecheck && npm run lint && npm run test
	GO_PACKAGES=$$(go list ./... | grep -v '/$(UI_DIR)/node_modules/'); \
		go vet $$GO_PACKAGES; \
		go test $$GO_PACKAGES

local-lint-go:
	go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest run

local-coverage:
	mkdir -p $(COVERAGE_DIR)
	GO_PACKAGES=$$(go list ./... | grep -v '/$(UI_DIR)/node_modules/'); \
		go test -covermode=atomic -coverprofile=$(COVERAGE_DIR)/go-coverage.out $$GO_PACKAGES
	go tool cover -func=$(COVERAGE_DIR)/go-coverage.out | tee $(COVERAGE_DIR)/go-coverage-summary.txt
	printf "%s\n" "Frontend coverage not generated: no dedicated Vitest coverage config/script is currently defined." > $(COVERAGE_DIR)/frontend-coverage-skipped.txt

local-ui:
	cd $(UI_DIR) && npm ci && npm run build
	rm -rf $(EMBED_DIR)
	mkdir -p $(EMBED_DIR)
	cp -r $(UI_DIR)/dist/* $(EMBED_DIR)/
	@echo "UI built and copied into $(EMBED_DIR)"

local-build: local-ui
	go build -ldflags "$(GO_LDFLAGS)" -o $(OUTPUT) ./cmd/kview
	@echo "Built $(OUTPUT) (browser/server modes; default: browser)"

local-build-webview: local-ui
	go build -tags webview -ldflags "$(GO_LDFLAGS)" -o $(OUTPUT) ./cmd/kview
	@echo "Built $(OUTPUT) with webview support (default: webview)"

local-build-release: local-ui
	mkdir -p $(dir $(OUTPUT))
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -trimpath -ldflags "$(GO_LDFLAGS) -s -w" -o $(OUTPUT) ./cmd/kview
	@echo "Built $(OUTPUT) ($(GOOS)/$(GOARCH); browser/server modes; default: browser)"

docker-image:
	docker build -t $(DOCKER_IMAGE) .

clean:
	rm -rf $(UI_DIR)/dist
	rm -rf $(UI_DIR)/node_modules
	rm -rf $(EMBED_DIR)/*
	rm -rf $(DIST_DIR)
	@echo "Cleaned UI dist/node_modules and embedded ui_dist contents"
