package customresourcedefinitions

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/discovery"
	kubescheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
)

const maxDiscoveryGroups = 64
const maxDiscoveryCandidates = 64

// DiscoverRestrictedTypes builds an incomplete type index, NOT a CRD list.
// Call only after CRD list is forbidden. All requests use the caller's config;
// no cross-request hints, privileged clients or discovery permission inference.
// Sequential requests bound concurrency to one, with no automatic retries.
func DiscoverRestrictedTypes(ctx context.Context, cfg *rest.Config, namespaced bool) ([]dto.CRDListItemDTO, *dto.CustomResourceDiscoveryMeta) {
	report := &dto.CustomResourceDiscoveryMeta{Source: "discovery+crdGet", ListDenied: true, UniverseUnknown: true, CandidateLimit: maxDiscoveryCandidates}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cfg = rest.CopyConfig(cfg)
	cfg.Timeout = 3 * time.Second
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		report.Errors++
		return nil, report
	}
	var groups metav1.APIGroupList
	if err := dc.RESTClient().Get().AbsPath("/apis").MaxRetries(0).Do(ctx).Into(&groups); err != nil {
		report.Errors++
		return nil, report
	}
	if len(groups.Groups) > maxDiscoveryGroups {
		report.Truncated = true
		groups.Groups = groups.Groups[:maxDiscoveryGroups]
	}
	var out []dto.CRDListItemDTO
	seen := map[string]bool{}
	for _, group := range groups.Groups {
		if ctx.Err() != nil {
			report.Errors++
			break
		}
		gv, err := schema.ParseGroupVersion(group.PreferredVersion.GroupVersion)
		if err != nil || gv.Group != group.Name || len(validation.IsDNS1123Subdomain(gv.Group)) != 0 || len(validation.IsDNS1035Label(gv.Version)) != 0 {
			report.Errors++
			continue
		}
		var resources metav1.APIResourceList
		err = dc.RESTClient().Get().AbsPath("/apis", gv.Group, gv.Version).MaxRetries(0).Do(ctx).Into(&resources)
		if err != nil || resources.GroupVersion != gv.String() {
			report.Errors++
			continue
		}
		for _, resource := range resources.APIResources {
			// Exclude known built-ins only as a probe-budget optimization. Unknown
			// and aggregated APIs still require exact CRD proof, never a denylist.
			if kubescheme.Scheme.Recognizes(gv.WithKind(resource.Kind)) {
				continue
			}
			if (resource.Group != "" && resource.Group != gv.Group) || (resource.Version != "" && resource.Version != gv.Version) {
				continue
			}
			if resource.Namespaced != namespaced || resource.Kind == "" || strings.Contains(resource.Name, "/") || len(validation.IsDNS1035Label(resource.Name)) != 0 {
				continue
			}
			listable := false
			for _, verb := range resource.Verbs {
				if verb == "list" {
					listable = true
				}
			}
			if !listable {
				continue
			}
			name := resource.Name + "." + gv.Group
			if seen[name] {
				continue
			}
			seen[name] = true
			if report.Candidates == maxDiscoveryCandidates {
				report.Truncated = true
				return out, report
			}
			report.Candidates++
			getCtx, stop := context.WithTimeout(ctx, 3*time.Second)
			raw, err := dc.RESTClient().Get().AbsPath("/apis", crdGVR.Group, crdGVR.Version, crdGVR.Resource, name).MaxRetries(0).Do(getCtx).Raw()
			stop()
			obj := &unstructured.Unstructured{}
			if err == nil {
				err = json.Unmarshal(raw, &obj.Object)
			}
			if err != nil {
				switch {
				case apierrors.IsForbidden(err), apierrors.IsUnauthorized(err):
					report.Denied++
				case apierrors.IsNotFound(err):
					report.NotFound++
				default:
					report.Errors++
				}
				if ctx.Err() != nil || apierrors.IsUnauthorized(err) {
					return out, report
				}
				continue
			}
			item := mapCRDListItem(*obj, time.Now())
			scope := "Cluster"
			if namespaced {
				scope = "Namespaced"
			}
			if obj.GetAPIVersion() != "apiextensions.k8s.io/v1" || obj.GetKind() != "CustomResourceDefinition" || item.Name != name || item.Group != gv.Group || item.Plural != resource.Name || item.Kind != resource.Kind || item.Scope != scope {
				report.Errors++
				continue
			}
			// Only request a version both advertised now and authoritatively served.
			// Preferred discovery version may differ from the CRD's storage version.
			served := false
			versions, _, _ := unstructured.NestedSlice(obj.Object, "spec", "versions")
			for _, version := range versions {
				vm, ok := version.(map[string]interface{})
				if !ok {
					continue
				}
				name, _, _ := unstructured.NestedString(vm, "name")
				enabled, _, _ := unstructured.NestedBool(vm, "served")
				if name == gv.Version && enabled {
					served = true
				}
			}
			if !served {
				report.Errors++
				continue
			}
			item.StorageVersion = gv.Version
			out = append(out, item)
			report.Confirmed++
		}
	}
	return out, report
}
