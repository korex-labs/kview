package customresources

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/rest"
)

const ExactKindDefaultLimit = 200
const ExactKindMaxLimit = 500
const exactKindMaxBody = 8 << 20

// ExactKindOptions deliberately requires an explicit scope and, for namespaced
// kinds, one namespace. A request reads one page; continuation is client-driven.
type ExactKindOptions struct {
	Group, Version, Resource, Scope, Namespace, Continue string
	Limit                                                int
}

func (o ExactKindOptions) Validate() error {
	if o.Group == "" || len(validation.IsDNS1123Subdomain(o.Group)) != 0 || len(validation.IsDNS1035Label(o.Version)) != 0 || len(validation.IsDNS1035Label(o.Resource)) != 0 {
		return apierrors.NewBadRequest("invalid exact custom resource group/version/resource")
	}
	if o.Scope != "Namespaced" && o.Scope != "Cluster" {
		return apierrors.NewBadRequest("scope must be Namespaced or Cluster")
	}
	if (o.Scope == "Namespaced" && (o.Namespace == "" || len(validation.IsDNS1123Label(o.Namespace)) != 0)) || (o.Scope == "Cluster" && o.Namespace != "") {
		return apierrors.NewBadRequest("namespace must be specified only for Namespaced scope")
	}
	if o.Limit < 0 || o.Limit > ExactKindMaxLimit || len(o.Continue) > 16384 {
		return apierrors.NewBadRequest("invalid page limit or continuation")
	}
	return nil
}

// ListExactKind validates a single CRD GET and negotiates a Table from exactly the
// requested served GVR. No discovery, storage substitution, cache, or object GETs.
func ListExactKind(ctx context.Context, cfg *rest.Config, o ExactKindOptions) (*dto.CustomResourceKindList, error) {
	if err := o.Validate(); err != nil {
		return nil, err
	}
	if o.Limit == 0 {
		o.Limit = ExactKindDefaultLimit
	}
	client, err := rest.HTTPClientFor(cfg)
	if err != nil {
		return nil, err
	}
	get := func(path string, q url.Values, accept string) ([]byte, int, error) {
		endpoint := strings.TrimRight(cfg.Host, "/") + path
		if len(q) > 0 {
			endpoint += "?" + q.Encode()
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Accept", accept)
		resp, err := client.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(io.LimitReader(resp.Body, exactKindMaxBody+1))
		if err != nil {
			return nil, resp.StatusCode, err
		}
		if len(body) > exactKindMaxBody {
			return nil, resp.StatusCode, fmt.Errorf("custom resource response exceeds 8 MiB")
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			var status metav1.Status
			if json.Unmarshal(body, &status) == nil && status.Kind == "Status" {
				status.Code = int32(resp.StatusCode)
				return nil, resp.StatusCode, &apierrors.StatusError{ErrStatus: status}
			}
			return nil, resp.StatusCode, apierrors.NewGenericServerResponse(resp.StatusCode, "get", gvr(o.Group, o.Version, o.Resource).GroupResource(), "", "upstream request failed", 0, false)
		}
		return body, resp.StatusCode, nil
	}
	raw, _, err := get("/apis/apiextensions.k8s.io/v1/customresourcedefinitions/"+o.Resource+"."+o.Group, nil, "application/json")
	if err != nil {
		return nil, err
	}
	var crd unstructured.Unstructured
	if err = json.Unmarshal(raw, &crd); err != nil {
		return nil, fmt.Errorf("invalid CRD response: %w", err)
	}
	field := func(parts ...string) string { s, _, _ := unstructured.NestedString(crd.Object, parts...); return s }
	if crd.GetName() != o.Resource+"."+o.Group || field("spec", "group") != o.Group || field("spec", "names", "plural") != o.Resource || field("spec", "scope") != o.Scope {
		return nil, apierrors.NewBadRequest("CRD identity or scope does not match request")
	}
	kind := field("spec", "names", "kind")
	if kind == "" {
		return nil, fmt.Errorf("CRD has no kind")
	}
	listKind, found, err := unstructured.NestedString(crd.Object, "spec", "names", "listKind")
	if err != nil || (found && listKind == "") {
		return nil, fmt.Errorf("CRD has invalid listKind")
	}
	if !found {
		listKind = kind + "List"
	}
	versions, _, _ := unstructured.NestedSlice(crd.Object, "spec", "versions")
	served := false
	for _, v := range versions {
		m, ok := v.(map[string]any)
		if ok && m["name"] == o.Version && m["served"] == true {
			served = true
		}
	}
	if !served {
		return nil, apierrors.NewBadRequest("requested CRD version is not served")
	}
	path := "/apis/" + o.Group + "/" + o.Version + "/"
	if o.Scope == "Namespaced" {
		path += "namespaces/" + o.Namespace + "/"
	}
	path += o.Resource
	q := url.Values{"limit": {strconv.Itoa(o.Limit)}, "includeObject": {"Object"}}
	if o.Continue != "" {
		q.Set("continue", o.Continue)
	}
	raw, code, err := get(path, q, "application/json;as=Table;g=meta.k8s.io;v=v1,application/json")
	fallback := ""
	if code == http.StatusNotAcceptable || code == http.StatusUnsupportedMediaType {
		fallback = "tableNegotiationUnsupported"
		q.Del("includeObject")
		raw, _, err = get(path, q, "application/json")
	}
	if err != nil {
		return nil, err
	}
	var header metav1.TypeMeta
	if err = json.Unmarshal(raw, &header); err != nil {
		return nil, fmt.Errorf("invalid custom resource page: %w", err)
	}
	out := &dto.CustomResourceKindList{Group: o.Group, Version: o.Version, Resource: o.Resource, Scope: o.Scope, Namespace: o.Namespace, Kind: kind, Items: []dto.CustomResourceKindRow{}, Meta: dto.CustomResourceKindMeta{Limit: o.Limit, Pages: 1}}
	if header.Kind == "Table" && header.APIVersion == "meta.k8s.io/v1" {
		var table metav1.Table
		if err = json.Unmarshal(raw, &table); err != nil {
			return nil, fmt.Errorf("invalid Table: %w", err)
		}
		if len(table.ColumnDefinitions) > 64 || (len(table.Rows) > 0 && len(table.ColumnDefinitions) == 0) {
			return nil, fmt.Errorf("invalid or excessive Table columns")
		}
		out.Columns = table.ColumnDefinitions
		out.Meta.ColumnSource = "table"
		out.Meta.Continue = table.Continue
		out.Meta.ResourceVersion = table.ResourceVersion
		rows := table.Rows
		if len(rows) > o.Limit {
			rows = rows[:o.Limit]
			out.Meta.Truncated = true
			out.Meta.Continue = ""
		}
		for _, r := range rows {
			row := exactKindRow(r.Object.Raw, o, kind)
			row.Cells = make([]any, len(out.Columns))
			copy(row.Cells, r.Cells)
			if len(r.Cells) != len(out.Columns) {
				out.Meta.IncompleteCellRows++
			}
			out.Items = append(out.Items, row)
		}
	} else {
		if header.Kind != listKind || header.APIVersion != o.Group+"/"+o.Version {
			return nil, fmt.Errorf("unexpected custom resource list identity")
		}
		var list struct {
			Metadata metav1.ListMeta   `json:"metadata"`
			Items    []json.RawMessage `json:"items"`
		}
		if err = json.Unmarshal(raw, &list); err != nil {
			return nil, fmt.Errorf("invalid custom resource list: %w", err)
		}
		out.Meta.ColumnSource = "standard"
		if fallback == "" {
			fallback = "serverReturnedObjectList"
		}
		out.Meta.FallbackReason = fallback
		out.Meta.Continue = list.Metadata.Continue
		out.Meta.ResourceVersion = list.Metadata.ResourceVersion
		out.Columns = []metav1.TableColumnDefinition{{Name: "Name", Type: "string"}, {Name: "Namespace", Type: "string"}, {Name: "Age", Type: "integer", Description: "Age in seconds"}}
		items := list.Items
		if len(items) > o.Limit {
			items = items[:o.Limit]
			out.Meta.Truncated = true
			out.Meta.Continue = ""
		}
		for _, obj := range items {
			row := exactKindRow(obj, o, kind)
			row.Cells = []any{nil, nil, nil}
			if row.IdentityKnown {
				row.Cells = []any{row.Name, row.Namespace, nil}
				if row.AgeKnown {
					row.Cells[2] = row.AgeSec
				}
			}
			if !row.IdentityKnown || !row.AgeKnown {
				out.Meta.IncompleteCellRows++
			}
			out.Items = append(out.Items, row)
		}
	}
	if out.Columns == nil {
		out.Columns = []metav1.TableColumnDefinition{}
	}
	for _, row := range out.Items {
		if !row.IdentityKnown {
			out.Meta.UnknownIdentityRows++
		}
	}
	out.Meta.Truncated = out.Meta.Truncated || out.Meta.Continue != ""
	out.Meta.Partial = out.Meta.Truncated || out.Meta.UnknownIdentityRows > 0 || out.Meta.IncompleteCellRows > 0
	return out, nil
}

func exactKindRow(raw []byte, o ExactKindOptions, kind string) dto.CustomResourceKindRow {
	row := dto.CustomResourceKindRow{CustomResourceInstanceDTO: dto.CustomResourceInstanceDTO{Group: o.Group, Version: o.Version, Resource: o.Resource, Kind: kind, SignalSeverity: "unknown", StatusSummary: "Object identity unavailable", Provenance: dto.CustomResourceProvenanceKubernetes}}
	var obj unstructured.Unstructured
	if len(raw) == 0 || json.Unmarshal(raw, &obj) != nil {
		return row
	}
	metadataOnly := obj.GetKind() == "PartialObjectMetadata" && obj.GetAPIVersion() == "meta.k8s.io/v1"
	namespace, _, namespaceErr := unstructured.NestedString(obj.Object, "metadata", "namespace")
	if (!metadataOnly && (obj.GetKind() != kind || obj.GetAPIVersion() != o.Group+"/"+o.Version)) || len(validation.IsDNS1123Subdomain(obj.GetName())) != 0 || obj.GetUID() == "" || namespaceErr != nil || namespace != o.Namespace {
		return row
	}
	row.Name = obj.GetName()
	row.Namespace = obj.GetNamespace()
	row.UID = string(obj.GetUID())
	row.IdentityKnown = true
	if ts := obj.GetCreationTimestamp(); !ts.IsZero() {
		row.AgeKnown = true
		row.AgeSec = int64(time.Since(ts.Time).Seconds())
	}
	if metadataOnly {
		row.StatusSummary = "Status not included in Table response"
	} else {
		row.SignalSeverity, row.StatusSummary = crSignal(obj.Object)
	}
	return row
}
