package helm

import (
	"bytes"
	"context"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	yamlutil "k8s.io/apimachinery/pkg/runtime/serializer/yaml"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

var builtInManifestKinds = map[string]struct{}{
	"ClusterRole":              {},
	"ClusterRoleBinding":       {},
	"ConfigMap":                {},
	"CronJob":                  {},
	"CustomResourceDefinition": {},
	"DaemonSet":                {},
	"Deployment":               {},
	"HorizontalPodAutoscaler":  {},
	"Ingress":                  {},
	"Job":                      {},
	"Namespace":                {},
	"Node":                     {},
	"PersistentVolume":         {},
	"PersistentVolumeClaim":    {},
	"Pod":                      {},
	"ReplicaSet":               {},
	"Role":                     {},
	"RoleBinding":              {},
	"Secret":                   {},
	"Service":                  {},
	"ServiceAccount":           {},
	"StatefulSet":              {},
}

// ListManifestCustomResources extracts custom resource references from the
// stored manifests of latest Helm release revisions in a namespace.
func ListManifestCustomResources(ctx context.Context, c *cluster.Clients, namespace string, crds []dto.CRDListItemDTO) ([]dto.CustomResourceInstanceDTO, error) {
	store := helmSecretStorage(c, namespace)
	releases, err := store.ListReleases()
	if err != nil {
		return nil, err
	}

	var out []dto.CustomResourceInstanceDTO
	for _, rel := range latestRevisions(releases) {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		defaultNamespace := namespace
		if rel.Namespace != "" {
			defaultNamespace = rel.Namespace
		}
		out = append(out, ManifestCustomResources(rel.Manifest, defaultNamespace, crds)...)
	}
	return dedupeManifestCustomResources(out), nil
}

func ManifestCustomResources(manifest, defaultNamespace string, crds []dto.CRDListItemDTO) []dto.CustomResourceInstanceDTO {
	if strings.TrimSpace(manifest) == "" {
		return nil
	}

	crdIndex := make(map[string]dto.CRDListItemDTO, len(crds))
	for _, crd := range crds {
		if crd.Group == "" || crd.Kind == "" {
			continue
		}
		crdIndex[crd.Group+"/"+crd.Kind] = crd
	}

	decoder := yamlutil.NewDecodingSerializer(unstructured.UnstructuredJSONScheme)
	var out []dto.CustomResourceInstanceDTO
	for _, doc := range bytes.Split([]byte(manifest), []byte("\n---")) {
		trimmed := strings.TrimSpace(string(doc))
		if trimmed == "" {
			continue
		}

		obj := &unstructured.Unstructured{}
		_, gvk, err := decoder.Decode([]byte(trimmed), nil, obj)
		if err != nil || gvk == nil || gvk.Kind == "" || obj.GetName() == "" {
			continue
		}
		if _, builtIn := builtInManifestKinds[gvk.Kind]; builtIn {
			continue
		}
		if gvk.Group == "" {
			continue
		}

		crd, knownCRD := crdIndex[gvk.Group+"/"+gvk.Kind]
		if knownCRD && crd.Scope != "Namespaced" {
			continue
		}
		if !knownCRD && !looksLikeCustomAPIGroup(gvk.Group) {
			continue
		}

		namespace := obj.GetNamespace()
		if namespace == "" {
			namespace = defaultNamespace
		}
		if namespace == "" {
			continue
		}

		resource := ""
		version := gvk.Version
		if knownCRD {
			resource = crd.Plural
			if crd.StorageVersion != "" {
				version = crd.StorageVersion
			}
		}

		out = append(out, dto.CustomResourceInstanceDTO{
			Name:           obj.GetName(),
			Namespace:      namespace,
			Kind:           gvk.Kind,
			Group:          gvk.Group,
			Version:        version,
			Resource:       resource,
			SignalSeverity: "unknown",
			StatusSummary:  "Referenced by Helm manifest",
		})
	}
	return dedupeManifestCustomResources(out)
}

func looksLikeCustomAPIGroup(group string) bool {
	return strings.Contains(group, ".") && !strings.HasSuffix(group, ".k8s.io")
}

func dedupeManifestCustomResources(items []dto.CustomResourceInstanceDTO) []dto.CustomResourceInstanceDTO {
	if len(items) <= 1 {
		return items
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]dto.CustomResourceInstanceDTO, 0, len(items))
	for _, item := range items {
		key := item.Group + "/" + item.Kind + "/" + item.Namespace + "/" + item.Name
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	return out
}
