package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
)

func recoveryFixture(t *testing.T, revision int, status release.Status) corev1.Secret {
	t.Helper()
	client := fake.NewSimpleClientset()
	store := driver.NewSecrets(client.CoreV1().Secrets("apps"))
	name := fmt.Sprintf("sh.helm.release.v1.demo.v%d", revision)
	rel := &release.Release{Name: "demo", Namespace: "apps", Version: revision, Info: &release.Info{Status: status, Description: "fixture"}, Chart: &chart.Chart{Metadata: &chart.Metadata{Name: "demo", Version: "1.0.0"}}, Manifest: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo\n"}
	if err := store.Create(name, rel); err != nil {
		t.Fatal(err)
	}
	s, err := client.CoreV1().Secrets("apps").Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	s.UID = types.UID(fmt.Sprintf("uid-%d", revision))
	s.ResourceVersion = fmt.Sprint(revision)
	return *s
}

func TestHelmRecovery(t *testing.T) {
	cases := []struct {
		name string
		code int
	}{
		{"happy", 200}, {"rollback", 200}, {"duplicate-field", 400}, {"null-field", 400}, {"missing-field", 400}, {"terminating", 409}, {"long-description", 409}, {"changed-prior", 409}, {"blocked-middle", 409}, {"delete-denied", 403}, {"readonly-get", 200}, {"readonly", 403}, {"missing-context", 400}, {"trim-context", 400}, {"unknown-context", 400},
		{"secret", 409}, {"uid", 409}, {"rv", 409}, {"revision", 409}, {"confirmation", 400}, {"writers", 400}, {"unknown-field", 400}, {"oversize-body", 400}, {"fraction", 400},
		{"failed", 409}, {"deployed", 409}, {"pending-install", 409}, {"rev1", 409}, {"bad-prior", 409}, {"missing-chart", 409}, {"missing-manifest", 409}, {"corrupt", 409}, {"identity", 409}, {"oversize-secret", 409}, {"pagination", 409}, {"new-revision", 409}, {"changed-latest", 409}, {"get-changed", 409}, {"readback-present", 409}, {"rbac-denied", 403}, {"rbac-error", 403}, {"list-denied", 403}, {"get-denied", 403},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			latest := recoveryFixture(t, 2, release.StatusPendingUpgrade)
			prior := recoveryFixture(t, 1, release.StatusDeployed)
			switch tc.name {
			case "rollback":
				latest = recoveryFixture(t, 2, release.StatusPendingRollback)
			case "failed":
				latest = recoveryFixture(t, 2, release.StatusFailed)
			case "deployed":
				latest = recoveryFixture(t, 2, release.StatusDeployed)
			case "pending-install":
				latest = recoveryFixture(t, 2, release.StatusPendingInstall)
			case "rev1":
				latest = recoveryFixture(t, 1, release.StatusPendingUpgrade)
			case "bad-prior":
				prior = recoveryFixture(t, 1, release.StatusFailed)
			case "blocked-middle":
				latest = recoveryFixture(t, 3, release.StatusPendingUpgrade)
				prior = recoveryFixture(t, 2, release.StatusFailed)
			case "terminating":
				now := metav1.Now()
				latest.DeletionTimestamp = &now
			case "corrupt":
				prior.Data["release"] = []byte("bad")
			case "identity":
				latest.Labels["version"] = "3"
			case "missing-chart", "missing-manifest", "long-description":
				rel, err := decodeRecoverySecret(&prior, "apps", "demo")
				if err != nil {
					t.Fatal(err)
				}
				switch tc.name {
				case "missing-chart":
					rel.Chart = nil
				case "long-description":
					rel.Info.Description = strings.Repeat("x", (16<<10)+1)
				default:
					rel.Manifest = ""
				}
				data, _ := json.Marshal(rel)
				prior.Data["release"] = []byte(base64.StdEncoding.EncodeToString(data))
			case "oversize-secret":
				var buf bytes.Buffer
				gz := gzip.NewWriter(&buf)
				_, _ = gz.Write([]byte(strings.Repeat("x", recoveryPayloadLimit+1)))
				_ = gz.Close()
				latest.Data["release"] = []byte(base64.StdEncoding.EncodeToString(buf.Bytes()))
			}
			lists, gets, deletes := 0, 0, 0
			deleted := false
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if strings.Contains(r.URL.Path, "selfsubjectaccessreviews") {
					var review authorizationv1.SelfSubjectAccessReview
					_ = json.NewDecoder(r.Body).Decode(&review)
					a := review.Spec.ResourceAttributes
					if a.Resource != "secrets" || a.Namespace != "apps" || (a.Verb != "list" && a.Name != latest.Name) {
						t.Errorf("unexpected access review: %+v", a)
					}
					if tc.name == "rbac-error" {
						http.Error(w, "unavailable", 500)
						return
					}
					review.Status.Allowed = (tc.name != "rbac-denied" || a.Verb != "delete") && (tc.name != "list-denied" || a.Verb != "list") && (tc.name != "get-denied" || a.Verb != "get")
					_ = json.NewEncoder(w).Encode(review)
					return
				}
				if r.Method == http.MethodDelete {
					deletes++
					var options metav1.DeleteOptions
					_ = json.NewDecoder(r.Body).Decode(&options)
					if options.Preconditions == nil || options.Preconditions.UID == nil || *options.Preconditions.UID != latest.UID || options.Preconditions.ResourceVersion == nil || *options.Preconditions.ResourceVersion != latest.ResourceVersion || !strings.HasSuffix(r.URL.Path, "/"+latest.Name) {
						t.Error("missing exact deletion preconditions")
					}
					if tc.name == "delete-denied" {
						w.WriteHeader(http.StatusForbidden)
						_ = json.NewEncoder(w).Encode(&metav1.Status{Status: "Failure", Reason: metav1.StatusReasonForbidden, Code: 403})
						return
					}
					deleted = true
					_ = json.NewEncoder(w).Encode(&metav1.Status{Status: "Success"})
					return
				}
				if strings.HasSuffix(r.URL.Path, "/secrets") {
					lists++
					if r.URL.Query().Get("labelSelector") != "name=demo,owner=helm" {
						t.Error("wrong selector")
					}
					items := []corev1.Secret{prior, latest}
					if tc.name == "blocked-middle" {
						items = append(items, recoveryFixture(t, 1, release.StatusDeployed))
					}
					if lists > 1 && tc.name == "changed-prior" {
						items[0].ResourceVersion = "changed"
					}
					if tc.name == "rev1" {
						items = []corev1.Secret{latest}
					}
					if lists > 1 && tc.name == "new-revision" {
						items = append(items, recoveryFixture(t, 3, release.StatusPendingUpgrade))
					}
					if lists > 1 && tc.name == "changed-latest" {
						items[1].ResourceVersion = "new"
					}
					list := corev1.SecretList{Items: items}
					if tc.name == "pagination" {
						list.Continue = "next"
					}
					_ = json.NewEncoder(w).Encode(list)
					return
				}
				gets++
				if deleted && tc.name != "readback-present" {
					w.WriteHeader(404)
					_ = json.NewEncoder(w).Encode(&metav1.Status{Status: "Failure", Reason: metav1.StatusReasonNotFound, Code: 404})
					return
				}
				item := latest.DeepCopy()
				if tc.name == "get-changed" {
					item.ResourceVersion = "new"
				}
				_ = json.NewEncoder(w).Encode(item)
			}))
			defer source.Close()
			s, _ := newTestServer(t)
			path := filepath.Join(t.TempDir(), "config")
			config := strings.ReplaceAll(minimalKubeconfig, "https://127.0.0.1:16443", source.URL)
			if err := os.WriteFile(path, []byte(config), 0600); err != nil {
				t.Fatal(err)
			}
			mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, path)
			if err != nil {
				t.Fatal(err)
			}
			s.mgr = mgr
			clients, _, err := mgr.GetClientsForContext(context.Background(), "test-context")
			if err != nil {
				t.Fatal(err)
			}
			cfg := *clients.RestConfig
			cfg.ContentType = "application/json"
			cfg.AcceptContentTypes = "application/json"
			clients.Clientset, err = kubernetes.NewForConfig(&cfg)
			if err != nil {
				t.Fatal(err)
			}
			b := helmRecoveryRequest{ExpectedRevision: 2, ExpectedSecretName: "sh.helm.release.v1.demo.v2", ExpectedUID: "uid-2", ExpectedResourceVersion: "2", Confirmation: "delete apps/demo revision 2", WritersStopped: true}
			ctxName := "test-context"
			method := http.MethodPost
			switch tc.name {
			case "readonly":
				s.SetReadOnly(true)
			case "readonly-get":
				s.SetReadOnly(true)
				method = http.MethodGet
			case "missing-context":
				ctxName = ""
			case "trim-context":
				ctxName = " test-context"
			case "unknown-context":
				ctxName = "unknown"
			case "secret":
				b.ExpectedSecretName = "other"
			case "uid":
				b.ExpectedUID = "other"
			case "rv":
				b.ExpectedResourceVersion = "other"
			case "revision":
				b.ExpectedRevision = 3
				b.Confirmation = "delete apps/demo revision 3"
			case "confirmation":
				b.Confirmation += " "
			case "writers":
				b.WritersStopped = false
			case "blocked-middle":
				b.ExpectedRevision, b.ExpectedSecretName, b.ExpectedUID, b.ExpectedResourceVersion = 3, latest.Name, string(latest.UID), latest.ResourceVersion
				b.Confirmation = "delete apps/demo revision 3"
			}
			data, _ := json.Marshal(b)
			if tc.name == "duplicate-field" {
				data = append(data[:len(data)-1], []byte(`,"writersStopped":true}`)...)
			}
			if tc.name == "null-field" {
				data = []byte(strings.Replace(string(data), `"writersStopped":true`, `"writersStopped":null`, 1))
			}
			if tc.name == "missing-field" {
				data = []byte(strings.Replace(string(data), `,"writersStopped":true`, ``, 1))
			}
			if tc.name == "unknown-field" {
				data = append(data[:len(data)-1], []byte(`,"extra":true}`)...)
			}
			if tc.name == "oversize-body" {
				data = []byte(strings.Repeat("x", 4097))
			}
			if tc.name == "fraction" {
				data = []byte(strings.Replace(string(data), `"expectedRevision":2`, `"expectedRevision":2.1`, 1))
			}
			rec := doReqWithHeader(t, s.Router(), method, "/api/namespaces/apps/helmreleases/demo/recovery", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": ctxName}, data)
			if rec.Code != tc.code {
				t.Fatalf("got %d want %d: %s", rec.Code, tc.code, rec.Body.String())
			}
			shouldDelete := tc.name == "happy" || tc.name == "rollback" || tc.name == "readback-present"
			if shouldDelete && (deletes != 1 || gets != 2) {
				t.Fatalf("delete/readback missing: %d/%d", deletes, gets)
			}
			if tc.name == "delete-denied" && (deletes != 1 || deleted) {
				t.Fatal("denied delete reported as performed")
			}
			if !shouldDelete && tc.name != "delete-denied" && deletes != 0 {
				t.Fatal("unexpected delete")
			}
			if tc.name == "readonly-get" && !strings.Contains(rec.Body.String(), `"eligible":false`) {
				t.Fatal("readonly preview eligible")
			}
		})
	}
}
