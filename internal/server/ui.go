package server

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed ui_dist
var uiFS embed.FS

// The cache contains only files discovered in the embedded distribution, never
// request paths. Each file is read, hashed and compressed at most once, including
// concurrent first requests. SPA routes all share the index.html entry.
var embeddedUI = sync.OnceValues(func() (*uiHandler, error) {
	root, err := fs.Sub(uiFS, "ui_dist")
	if err != nil {
		return nil, err
	}
	return newUIHandler(root)
})

type uiRepresentation struct {
	body []byte
	etag string
}

type uiAsset struct {
	once     sync.Once
	identity uiRepresentation
	gzip     uiRepresentation
	err      error
}

type uiHandler struct {
	fs     fs.FS
	assets map[string]*uiAsset
}

func newUIHandler(root fs.FS) (*uiHandler, error) {
	h := &uiHandler{fs: root, assets: make(map[string]*uiAsset)}
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type().IsRegular() {
			h.assets[name] = &uiAsset{}
		}
		return nil
	})
	return h, err
}

func (s *Server) serveUI(w http.ResponseWriter, r *http.Request) {
	h, err := embeddedUI()
	if err != nil {
		http.Error(w, "UI not built", http.StatusNotFound)
		return
	}
	h.ServeHTTP(w, r)
}

// Vite's default output uses an eight-character base64url content hash. Only
// existing files under assets/ with known non-HTML extensions get immutable
// caching; public files and all HTML must revalidate across deployments.
var fingerprintedUIAsset = regexp.MustCompile(`^assets/(.*/)?[^/]+-[A-Za-z0-9_-]{8}\.(js|css|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|wasm)$`)

func (h *uiHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	asset := h.assets[name]
	if asset == nil {
		// Missing bundles must fail, not return the app shell with a JS MIME
		// type or immutable caching. Extensionless paths remain SPA routes.
		fallbackPath := strings.TrimSuffix(name, "/")
		if !fs.ValidPath(fallbackPath) || name == "assets" || strings.HasPrefix(name, "assets/") || path.Ext(fallbackPath) != "" {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		name = "index.html"
		asset = h.assets[name]
	}
	if asset == nil {
		http.Error(w, "UI not built", http.StatusNotFound)
		return
	}
	asset.once.Do(func() {
		body, err := fs.ReadFile(h.fs, name)
		if err != nil {
			asset.err = err
			return
		}
		asset.identity = newUIRepresentation(body)
		var compressed bytes.Buffer
		zw := gzip.NewWriter(&compressed)
		if _, err = zw.Write(body); err == nil {
			err = zw.Close()
		}
		if err != nil {
			asset.err = err
			return
		}
		asset.gzip = newUIRepresentation(compressed.Bytes())
	})
	if asset.err != nil {
		http.Error(w, "Unable to read UI", http.StatusInternalServerError)
		return
	}

	w.Header().Add("Vary", "Accept-Encoding")
	gzipQ, identityQ := uiEncodingQualities(strings.Join(r.Header.Values("Accept-Encoding"), ","))
	if gzipQ == 0 && identityQ == 0 {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "No acceptable content encoding", http.StatusNotAcceptable)
		return
	}
	representation := asset.identity
	if gzipQ > 0 && gzipQ >= identityQ {
		representation = asset.gzip
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("Content-Type", contentTypeByPath(name))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-cache")
	if fingerprintedUIAsset.MatchString(name) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	w.Header().Set("ETag", representation.etag)
	w.Header().Set("Content-Length", strconv.Itoa(len(representation.body)))
	// ServeContent handles HEAD, weak/list/wildcard If-None-Match, If-Match,
	// and byte ranges against the selected representation. No invented build
	// timestamp: embedded files have no useful Last-Modified date.
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(representation.body))
}

func newUIRepresentation(body []byte) uiRepresentation {
	return uiRepresentation{body: body, etag: fmt.Sprintf(`"%x"`, sha256.Sum256(body))}
}

func uiEncodingQualities(header string) (gzipQ, identityQ float64) {
	// An absent/empty header conservatively selects identity. Explicit coding
	// entries override wildcard entries, including explicit q=0 refusals.
	qualities := make(map[string]float64)
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(item, ";")
		coding := strings.ToLower(strings.TrimSpace(parts[0]))
		if coding == "" {
			continue
		}
		q := 1.0
		for _, param := range parts[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(param), "=")
			if !ok || !strings.EqualFold(strings.TrimSpace(key), "q") {
				q = 0
				break
			}
			parsed, valid := uiQuality(strings.TrimSpace(value))
			if !valid {
				q = 0
				break
			}
			q = parsed
		}
		// Be conservative with contradictory duplicate codings.
		if previous, exists := qualities[coding]; !exists || q < previous {
			qualities[coding] = q
		}
	}
	gzipQ, explicitGzip := qualities["gzip"]
	wildcard, hasWildcard := qualities["*"]
	if !explicitGzip && hasWildcard {
		gzipQ = wildcard
	}
	identityQ, explicitIdentity := qualities["identity"]
	if !explicitIdentity {
		identityQ = 1
		if hasWildcard && wildcard == 0 {
			identityQ = 0
		}
	}
	return gzipQ, identityQ
}

// HTTP qvalues are 0 or 1 with at most three fractional digits; accepting
// generic floating-point syntax would also accept NaN, signs and exponents.
func uiQuality(value string) (float64, bool) {
	whole, fraction, hasFraction := strings.Cut(value, ".")
	if whole != "0" && whole != "1" {
		return 0, false
	}
	if hasFraction {
		if len(fraction) > 3 {
			return 0, false
		}
		for _, digit := range fraction {
			if digit < '0' || digit > '9' || (whole == "1" && digit != '0') {
				return 0, false
			}
		}
	}
	q, err := strconv.ParseFloat(value, 64)
	return q, err == nil
}

func contentTypeByPath(p string) string {
	switch path.Ext(p) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js":
		return "application/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".ico":
		return "image/x-icon"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".wasm":
		return "application/wasm"
	case ".json", ".map":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}
