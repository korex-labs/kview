package server

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
)

const testUIBundle = "/assets/index-A-osQNjC.js"

func uiFixture() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                {Data: []byte("<!doctype html><html>app shell</html>")},
		"assets/index-A-osQNjC.js":  {Data: []byte(strings.Repeat("export const message = 'hello';\n", 200))},
		"assets/style-BZ12xozU.css": {Data: []byte("body { color: red; }")},
		"assets/help-BZ12xozU.html": {Data: []byte("<html>help</html>")},
		"assets/plain.js":           {Data: []byte("console.log('plain')")},
		"favicon.svg":               {Data: []byte("<svg></svg>")},
	}
}

func uiTestHandler(t *testing.T) *uiHandler {
	t.Helper()
	h, err := newUIHandler(uiFixture())
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func uiRequest(h http.Handler, method, target string, headers http.Header) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, nil)
	if headers != nil {
		r.Header = headers.Clone()
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestUIEncodingNegotiation(t *testing.T) {
	h := uiTestHandler(t)
	for _, tt := range []struct {
		name     string
		header   string
		encoding string
		status   int
	}{
		{"absent", "", "", 200},
		{"gzip", "gzip", "gzip", 200},
		{"normal browser", "gzip, deflate, br", "gzip", 200},
		{"gzip disabled", "gzip;q=0", "", 200},
		{"explicit overrides wildcard", "gzip;q=0, *;q=1", "", 200},
		{"weighted gzip", "gzip;q=0.8, identity;q=0.2", "gzip", 200},
		{"weighted identity", "gzip;q=0.2, identity;q=0.8", "", 200},
		{"implicit identity", "gzip;q=0.5", "", 200},
		{"identity disabled", "gzip;q=0.5, identity;q=0", "gzip", 200},
		{"wildcard", "*", "gzip", 200},
		{"wildcard refused gzip explicit", "*;q=0, gzip;q=1", "gzip", 200},
		{"wildcard refused identity explicit", "*;q=0, identity;q=1", "", 200},
		{"unsupported", "br", "", 200},
		{"case and spaces", " GZip ; Q=1 ", "gzip", 200},
		{"invalid weight", "gzip;q=oops", "", 200},
		{"nan weight", "gzip;q=NaN", "", 200},
		{"out of range", "gzip;q=2", "", 200},
		{"exponent is not a qvalue", "gzip;q=1e0", "", 200},
		{"too precise", "gzip;q=1.0000", "", 200},
		{"three decimals", "gzip;q=1.000", "gzip", 200},
		{"duplicate refusal", "gzip, gzip;q=0", "", 200},
		{"nothing acceptable", "gzip;q=0, identity;q=0", "", 406},
		{"wildcard refusal", "*;q=0", "", 406},
		{"unsupported identity refused", "br, identity;q=0", "", 406},
	} {
		t.Run(tt.name, func(t *testing.T) {
			w := uiRequest(h, http.MethodGet, testUIBundle, http.Header{"Accept-Encoding": {tt.header}})
			if w.Code != tt.status || w.Header().Get("Content-Encoding") != tt.encoding {
				t.Fatalf("status/encoding = %d/%q, want %d/%q", w.Code, w.Header().Get("Content-Encoding"), tt.status, tt.encoding)
			}
			if w.Header().Get("Vary") != "Accept-Encoding" {
				t.Fatalf("missing encoding variation: %v", w.Header())
			}
			if tt.status != http.StatusOK {
				return
			}
			body := w.Body.Bytes()
			if tt.encoding == "gzip" {
				zr, err := gzip.NewReader(bytes.NewReader(body))
				if err != nil {
					t.Fatal(err)
				}
				defer func() {
					if err := zr.Close(); err != nil {
						t.Errorf("close gzip reader: %v", err)
					}
				}()
				body, err = io.ReadAll(zr)
				if err != nil {
					t.Fatal(err)
				}
			}
			if !bytes.Equal(body, uiFixture()[strings.TrimPrefix(testUIBundle, "/")].Data) {
				t.Fatal("response does not match the embedded bundle")
			}
			if w.Header().Get("Content-Length") != strconv.Itoa(w.Body.Len()) {
				t.Fatalf("incorrect representation length: %v", w.Header())
			}
		})
	}
	w := uiRequest(h, http.MethodGet, testUIBundle, http.Header{"Accept-Encoding": {"identity;q=0", "gzip"}})
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("multiple Accept-Encoding header fields were not combined")
	}
}

func TestUICachePolicyAndSPAFallback(t *testing.T) {
	h := uiTestHandler(t)
	for _, tt := range []struct {
		path        string
		status      int
		cache       string
		contentType string
	}{
		{"/", 200, "no-cache", "text/html; charset=utf-8"},
		{"/index.html", 200, "no-cache", "text/html; charset=utf-8"},
		{"/workloads/pods", 200, "no-cache", "text/html; charset=utf-8"},
		{"/workloads/pods/", 200, "no-cache", "text/html; charset=utf-8"},
		{testUIBundle, 200, "public, max-age=31536000, immutable", "application/javascript; charset=utf-8"},
		{testUIBundle + "?v=123", 200, "public, max-age=31536000, immutable", "application/javascript; charset=utf-8"},
		{"/assets/style-BZ12xozU.css", 200, "public, max-age=31536000, immutable", "text/css; charset=utf-8"},
		{"/assets/help-BZ12xozU.html", 200, "no-cache", "text/html; charset=utf-8"},
		{"/assets/plain.js", 200, "no-cache", "application/javascript; charset=utf-8"},
		{"/favicon.svg", 200, "no-cache", "image/svg+xml"},
		{"/assets/gone-BZ12xozU.js", 404, "no-store", "text/plain; charset=utf-8"},
		{"/missing.js", 404, "no-store", "text/plain; charset=utf-8"},
		{"/assets/missing", 404, "no-store", "text/plain; charset=utf-8"},
		{"/assets", 404, "no-store", "text/plain; charset=utf-8"},
		{"/../index.html", 404, "no-store", "text/plain; charset=utf-8"},
	} {
		t.Run(tt.path, func(t *testing.T) {
			w := uiRequest(h, http.MethodGet, tt.path, nil)
			if w.Code != tt.status || w.Header().Get("Cache-Control") != tt.cache || w.Header().Get("Content-Type") != tt.contentType {
				t.Fatalf("unexpected response: status=%d headers=%v", w.Code, w.Header())
			}
			if tt.status == 200 && w.Header().Get("ETag") == "" {
				t.Fatal("missing ETag")
			}
		})
	}
	root := uiRequest(h, http.MethodGet, "/", nil)
	route := uiRequest(h, http.MethodGet, "/workloads/pods", nil)
	if root.Body.String() != route.Body.String() || root.Header().Get("ETag") != route.Header().Get("ETag") {
		t.Fatal("SPA routes do not share the index representation")
	}
}

func TestUIConditionalRequestsAndHead(t *testing.T) {
	h := uiTestHandler(t)
	identity := uiRequest(h, http.MethodGet, testUIBundle, nil)
	gzipHeaders := http.Header{"Accept-Encoding": {"gzip"}}
	compressed := uiRequest(h, http.MethodGet, testUIBundle, gzipHeaders)
	if identity.Header().Get("ETag") == compressed.Header().Get("ETag") {
		t.Fatal("different encodings must have different strong ETags")
	}
	for _, encoding := range []string{"identity", "gzip"} {
		for _, target := range []string{testUIBundle, "/", "/workloads/pods"} {
			t.Run(encoding+target, func(t *testing.T) {
				headers := http.Header{"Accept-Encoding": {encoding}}
				get := uiRequest(h, http.MethodGet, target, headers)
				head := uiRequest(h, http.MethodHead, target, headers)
				if head.Code != 200 || head.Body.Len() != 0 {
					t.Fatalf("HEAD returned %d with %d bytes", head.Code, head.Body.Len())
				}
				for _, key := range []string{"Content-Length", "Content-Type", "Content-Encoding", "Cache-Control", "ETag", "Vary"} {
					if head.Header().Get(key) != get.Header().Get(key) {
						t.Fatalf("HEAD/GET %s mismatch", key)
					}
				}
				for _, validator := range []string{get.Header().Get("ETag"), "W/" + get.Header().Get("ETag"), `"other", W/` + get.Header().Get("ETag"), "*"} {
					headers.Set("If-None-Match", validator)
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						w := uiRequest(h, method, target, headers)
						if w.Code != 304 || w.Body.Len() != 0 {
							t.Fatalf("%s conditional %q returned %d with %d bytes", method, validator, w.Code, w.Body.Len())
						}
						for _, key := range []string{"ETag", "Vary", "Cache-Control"} {
							if w.Header().Get(key) != get.Header().Get(key) {
								t.Fatalf("304 lost %s", key)
							}
						}
					}
				}
			})
		}
	}
	gzipHeaders.Set("If-None-Match", identity.Header().Get("ETag"))
	if w := uiRequest(h, http.MethodGet, testUIBundle, gzipHeaders); w.Code != 200 {
		t.Fatalf("identity validator incorrectly matched gzip: %d", w.Code)
	}
	other := uiRequest(uiTestHandler(t), http.MethodGet, testUIBundle, http.Header{"Accept-Encoding": {"gzip"}})
	if other.Header().Get("ETag") != compressed.Header().Get("ETag") || !bytes.Equal(other.Body.Bytes(), compressed.Body.Bytes()) {
		t.Fatal("gzip bytes and ETags must be deterministic across handler instances")
	}
	changedFixture := uiFixture()
	changedFixture["index.html"].Data = []byte("new deployment")
	changed, err := newUIHandler(changedFixture)
	if err != nil {
		t.Fatal(err)
	}
	oldIndex := uiRequest(h, http.MethodGet, "/", nil)
	newIndex := uiRequest(changed, http.MethodGet, "/", http.Header{"If-None-Match": {oldIndex.Header().Get("ETag")}})
	if newIndex.Code != 200 || newIndex.Header().Get("ETag") == oldIndex.Header().Get("ETag") {
		t.Fatal("HTML validator did not change across deployments")
	}
}

type uiCountingFS struct {
	fs.FS
	reads atomic.Int64
}

func (f *uiCountingFS) ReadFile(name string) ([]byte, error) {
	f.reads.Add(1)
	return fs.ReadFile(f.FS, name)
}

func TestUICacheBoundedAndConcurrent(t *testing.T) {
	root := &uiCountingFS{FS: uiFixture()}
	h, err := newUIHandler(root)
	if err != nil {
		t.Fatal(err)
	}
	assetCount := len(h.assets)
	var requests sync.WaitGroup
	for i := 0; i < 32; i++ {
		requests.Add(1)
		go func(i int) {
			defer requests.Done()
			for _, target := range []string{testUIBundle, fmt.Sprintf("/route/%d", i)} {
				w := uiRequest(h, http.MethodGet, target, http.Header{"Accept-Encoding": {"gzip"}})
				if w.Code != 200 {
					t.Errorf("concurrent request returned %d", w.Code)
				}
			}
			uiRequest(h, http.MethodGet, fmt.Sprintf("/assets/missing-%d.js", i), nil)
		}(i)
	}
	requests.Wait()
	if root.reads.Load() != 2 {
		t.Fatalf("read files %d times, want one bundle and one shell read", root.reads.Load())
	}
	if len(h.assets) != assetCount {
		t.Fatal("arbitrary request paths grew the asset cache")
	}
}

func TestUIHeadRouteAndMethods(t *testing.T) {
	// Exercise the actual router registration, without depending on generated
	// asset hashes or even on whether the embedded index has been built.
	_, router := newTestServer(t)
	w := uiRequest(router, http.MethodHead, "/", nil)
	if w.Code == http.StatusMethodNotAllowed {
		t.Fatal("the public UI route does not register HEAD")
	}
	w = uiRequest(uiTestHandler(t), http.MethodPost, "/", nil)
	if w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("unexpected unsupported method response: %d %v", w.Code, w.Header())
	}
}
