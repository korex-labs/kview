package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/korex-labs/kview/v5/internal/cluster"
	"helm.sh/helm/v3/pkg/release"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/validation"
)

const recoveryPayloadLimit = 8 << 20

type helmRecoveryRevision struct {
	Revision        int    `json:"revision"`
	Status          string `json:"status"`
	Description     string `json:"description"`
	SecretName      string `json:"secretName"`
	UID             string `json:"uid"`
	ResourceVersion string `json:"resourceVersion"`
}
type helmRecoveryPrevious struct {
	Revision   int    `json:"revision"`
	Status     string `json:"status"`
	SecretName string `json:"secretName"`
}
type helmRecoveryPreview struct {
	Namespace     string                `json:"namespace"`
	Release       string                `json:"release"`
	Latest        helmRecoveryRevision  `json:"latest"`
	Previous      *helmRecoveryPrevious `json:"previous,omitempty"`
	Eligible      bool                  `json:"eligible"`
	BlockedReason string                `json:"blockedReason,omitempty"`
	Confirmation  string                `json:"confirmation"`
}
type helmRecoveryRequest struct {
	ExpectedRevision        int    `json:"expectedRevision"`
	ExpectedSecretName      string `json:"expectedSecretName"`
	ExpectedUID             string `json:"expectedUID"`
	ExpectedResourceVersion string `json:"expectedResourceVersion"`
	Confirmation            string `json:"confirmation"`
	WritersStopped          bool   `json:"writersStopped"`
}

// Do not use Helm's storage History here: its decoder skips corrupt records and
// its decompressor is unbounded. Recovery must account for every retained record.
func decodeRecoverySecret(s *corev1.Secret, ns, name string) (*release.Release, error) {
	invalid := fmt.Errorf("helm history is corrupt, ambiguous, or unsupported")
	raw := s.Data["release"]
	if len(raw) == 0 || len(raw) > recoveryPayloadLimit {
		return nil, invalid
	}
	data, err := base64.StdEncoding.DecodeString(string(raw))
	if err != nil {
		return nil, invalid
	}
	if len(data) >= 3 && bytes.Equal(data[:3], []byte{0x1f, 0x8b, 0x08}) {
		zr, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, invalid
		}
		data, err = io.ReadAll(io.LimitReader(zr, recoveryPayloadLimit+1))
		_ = zr.Close()
		if err != nil {
			return nil, invalid
		}
	}
	if len(data) > recoveryPayloadLimit {
		return nil, invalid
	}
	var rel release.Release
	if json.Unmarshal(data, &rel) != nil || rel.Info == nil || rel.Version <= 0 {
		return nil, invalid
	}
	switch rel.Info.Status {
	case release.StatusDeployed, release.StatusSuperseded, release.StatusFailed, release.StatusUninstalled, release.StatusUninstalling, release.StatusPendingInstall, release.StatusPendingUpgrade, release.StatusPendingRollback:
	default:
		return nil, invalid
	}
	if s.DeletionTimestamp != nil || s.Namespace != ns || rel.Namespace != ns || rel.Name != name || s.Type != "helm.sh/release.v1" || s.Labels["owner"] != "helm" || s.Labels["name"] != name || s.Labels["version"] != strconv.Itoa(rel.Version) || s.Labels["status"] != rel.Info.Status.String() || s.Name != fmt.Sprintf("sh.helm.release.v1.%s.v%d", name, rel.Version) {
		return nil, invalid
	}
	return &rel, nil
}

func recoveryAllowed(ctx context.Context, c *cluster.Clients, ns, verb, name string) bool {
	review, err := c.Clientset.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, &authorizationv1.SelfSubjectAccessReview{Spec: authorizationv1.SelfSubjectAccessReviewSpec{ResourceAttributes: &authorizationv1.ResourceAttributes{Namespace: ns, Verb: verb, Resource: "secrets", Name: name}}}, metav1.CreateOptions{})
	return err == nil && review != nil && review.Status.Allowed && !review.Status.Denied && review.Status.EvaluationError == ""
}

func recoveryHistory(ctx context.Context, c *cluster.Clients, ns, name string) (*helmRecoveryPreview, []corev1.Secret, error) {
	list, err := c.Clientset.CoreV1().Secrets(ns).List(ctx, metav1.ListOptions{LabelSelector: labels.Set{"owner": "helm", "name": name}.AsSelector().String(), Limit: 257})
	if err != nil {
		return nil, nil, err
	}
	if list.Continue != "" || len(list.Items) == 0 || len(list.Items) > 256 {
		return nil, nil, fmt.Errorf("complete bounded Helm history unavailable")
	}
	type entry struct {
		secret   corev1.Secret
		revision helmRecoveryRevision
		usable   bool
	}
	entries := make([]entry, 0, len(list.Items))
	seen := map[int]bool{}
	encodedBytes := 0
	for _, secret := range list.Items {
		encodedBytes += len(secret.Data["release"])
		if encodedBytes > recoveryPayloadLimit {
			return nil, nil, fmt.Errorf("bounded Helm history payload unavailable")
		}
		rel, err := decodeRecoverySecret(&secret, ns, name)
		if err != nil {
			return nil, nil, err
		}
		if seen[rel.Version] {
			return nil, nil, fmt.Errorf("ambiguous Helm history")
		}
		seen[rel.Version] = true
		if len(rel.Info.Description) > 16<<10 {
			return nil, nil, fmt.Errorf("bounded Helm description unavailable")
		}
		revision := helmRecoveryRevision{Revision: rel.Version, Status: rel.Info.Status.String(), Description: rel.Info.Description, SecretName: secret.Name, UID: string(secret.UID), ResourceVersion: secret.ResourceVersion}
		usable := (rel.Info.Status == release.StatusDeployed || rel.Info.Status == release.StatusSuperseded) && rel.Chart != nil && rel.Chart.Metadata != nil && rel.Chart.Metadata.Name != "" && strings.TrimSpace(rel.Manifest) != ""
		// Keep only metadata between records; charts, values and manifests can
		// be large and are never needed after deriving prior-history usability.
		secret.Data, secret.StringData = nil, nil
		entries = append(entries, entry{secret: secret, revision: revision, usable: usable})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].revision.Revision > entries[j].revision.Revision })
	latest := entries[0]
	p := &helmRecoveryPreview{Namespace: ns, Release: name, Latest: latest.revision, Confirmation: fmt.Sprintf("delete %s/%s revision %d", ns, name, latest.revision.Revision)}
	if len(entries) > 1 {
		previous := entries[1]
		p.Previous = &helmRecoveryPrevious{Revision: previous.revision.Revision, Status: previous.revision.Status, SecretName: previous.secret.Name}
	}
	p.BlockedReason = "Only a pending upgrade or rollback with an immediately preceding usable deployed or superseded revision can be recovered; age does not prove writers have stopped."
	if (p.Latest.Status == string(release.StatusPendingUpgrade) || p.Latest.Status == string(release.StatusPendingRollback)) && p.Latest.Revision > 1 && len(entries) > 1 && p.Latest.UID != "" && p.Latest.ResourceVersion != "" {
		if entries[1].usable {
			p.Eligible = true
			p.BlockedReason = ""
		}
	}
	ordered := make([]corev1.Secret, len(entries))
	for i := range entries {
		ordered[i] = entries[i].secret
	}
	return p, ordered, nil
}

func decodeHelmRecoveryRequest(dec *json.Decoder, body *helmRecoveryRequest) error {
	invalid := fmt.Errorf("invalid recovery request")
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return invalid
	}
	fields := map[string]json.RawMessage{}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return invalid
		}
		name, ok := key.(string)
		if !ok {
			return invalid
		}
		switch name {
		case "expectedRevision", "expectedSecretName", "expectedUID", "expectedResourceVersion", "confirmation", "writersStopped":
		default:
			return invalid
		}
		if _, ok := fields[name]; ok {
			return invalid
		}
		var value json.RawMessage
		if dec.Decode(&value) != nil || bytes.Equal(value, []byte("null")) {
			return invalid
		}
		fields[name] = value
	}
	if token, err = dec.Token(); err != nil || token != json.Delim('}') || len(fields) != 6 || dec.Decode(&struct{}{}) != io.EOF {
		return invalid
	}
	data, err := json.Marshal(fields)
	if err != nil {
		return invalid
	}
	return json.Unmarshal(data, body)
}

func recoveryMatches(p *helmRecoveryPreview, b helmRecoveryRequest) bool {
	return p.Latest.Revision == b.ExpectedRevision && p.Latest.SecretName == b.ExpectedSecretName && p.Latest.UID == b.ExpectedUID && p.Latest.ResourceVersion == b.ExpectedResourceVersion
}
func recoverySameHistory(a, b []corev1.Secret) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Name != b[i].Name || a[i].UID != b[i].UID || a[i].ResourceVersion != b[i].ResourceVersion {
			return false
		}
	}
	return true
}

func (s *Server) handleHelmRecovery(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	fail := func(code int, message string) { writeErrorResponse(w, code, message) }
	if r.Method == http.MethodPost && s.ReadOnly() {
		writeReadOnlyBlocked(w, r.URL.Path)
		return
	}
	selected := r.Header.Get("X-Kview-Context")
	ns, name := chi.URLParam(r, "ns"), chi.URLParam(r, "name")
	if len(r.Header.Values("X-Kview-Context")) != 1 || selected == "" || selected != strings.TrimSpace(selected) || len(validation.IsDNS1123Label(ns)) != 0 || len(validation.IsDNS1123Subdomain(name)) != 0 {
		fail(400, "exact context, namespace and release required")
		return
	}
	if s.mgr == nil {
		fail(503, "context unavailable")
		return
	}
	if _, ok := s.mgr.ContextInfo(selected); !ok {
		fail(400, "unknown context")
		return
	}
	var body helmRecoveryRequest
	if r.Method == http.MethodPost {
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		if decodeHelmRecoveryRequest(dec, &body) != nil || body.ExpectedRevision <= 0 || body.ExpectedSecretName == "" || body.ExpectedUID == "" || body.ExpectedResourceVersion == "" || !body.WritersStopped || body.Confirmation != fmt.Sprintf("delete %s/%s revision %d", ns, name, body.ExpectedRevision) {
			fail(400, "exact recovery expectations, typed confirmation and stopped-writers acknowledgement required")
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
	defer cancel()
	clients, active, err := s.clientsForRequest(ctx, r)
	if err != nil || active != selected || clients == nil {
		fail(400, "context could not be resolved exactly")
		return
	}
	if !recoveryAllowed(ctx, clients, ns, "list", "") {
		fail(403, "Secret list permission could not be confirmed")
		return
	}
	p, history, err := recoveryHistory(ctx, clients, ns, name)
	historyError := func(err error) {
		if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) {
			fail(403, "Secret access denied")
		} else {
			fail(409, "Complete validated Helm history unavailable; refresh before recovery")
		}
	}
	if err != nil {
		historyError(err)
		return
	}
	if !recoveryAllowed(ctx, clients, ns, "get", p.Latest.SecretName) {
		fail(403, "Exact Secret get permission could not be confirmed")
		return
	}
	allowed := recoveryAllowed(ctx, clients, ns, "delete", p.Latest.SecretName)
	if r.Method == http.MethodGet {
		if !allowed {
			p.Eligible = false
			p.BlockedReason = "Exact Secret delete permission could not be confirmed."
		}
		if s.ReadOnly() {
			p.Eligible = false
			p.BlockedReason = readOnlyMutationMessage
		}
		writeJSON(w, 200, map[string]any{"active": active, "item": p})
		return
	}
	if !allowed {
		fail(403, "Exact Secret delete permission could not be confirmed")
		return
	}
	if !recoveryMatches(p, body) || !p.Eligible {
		fail(409, "Helm recovery preflight changed or is ineligible; refresh before recovery")
		return
	}
	secrets := clients.Clientset.CoreV1().Secrets(ns)
	exact, err := secrets.Get(ctx, p.Latest.SecretName, metav1.GetOptions{})
	if err != nil {
		historyError(err)
		return
	}
	if exact.UID != history[0].UID || exact.ResourceVersion != history[0].ResourceVersion {
		fail(409, "Latest Helm revision changed")
		return
	}
	if _, err := decodeRecoverySecret(exact, ns, name); err != nil {
		historyError(err)
		return
	}
	fresh, latestHistory, err := recoveryHistory(ctx, clients, ns, name)
	if err != nil {
		historyError(err)
		return
	}
	if !fresh.Eligible || !recoveryMatches(fresh, body) || !recoverySameHistory(history, latestHistory) {
		fail(409, "Helm history changed; refresh before recovery")
		return
	}
	// This guards replacement/update of this Secret, not creation of another
	// revision by external writers. The operator must stop those writers first.
	uid, rv := exact.UID, exact.ResourceVersion
	err = secrets.Delete(ctx, exact.Name, metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &uid, ResourceVersion: &rv}})
	if err != nil {
		historyError(err)
		return
	}
	_, err = secrets.Get(ctx, exact.Name, metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		if err != nil {
			historyError(err)
		} else {
			fail(409, "Deletion not verified; Secret still exists")
		}
		return
	}
	if s.dp != nil {
		_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, active, ns)
		_ = s.dp.InvalidateSecretsSnapshot(ctx, active, ns)
	}
	writeJSON(w, 200, map[string]any{"active": active, "item": map[string]string{"status": "ok", "message": "Deleted only the verified pending Helm revision Secret. No workloads were changed; inspect history before resuming writers."}})
}
