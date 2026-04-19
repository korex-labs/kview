package helm

import (
	"context"
	"sort"

	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func helmSecretStorage(c *cluster.Clients, namespace string) *storage.Storage {
	d := driver.NewSecrets(c.Clientset.CoreV1().Secrets(namespace))
	store := storage.Init(d)
	store.Log = func(_ string, _ ...interface{}) {}
	return store
}

func chartString(rel *release.Release) string {
	if rel.Chart == nil || rel.Chart.Metadata == nil {
		return ""
	}
	m := rel.Chart.Metadata
	if m.Version != "" {
		return m.Name + "-" + m.Version
	}
	return m.Name
}

func releaseStatus(rel *release.Release) string {
	if rel.Info == nil {
		return "unknown"
	}
	return rel.Info.Status.String()
}

func releaseUpdated(rel *release.Release) int64 {
	if rel.Info == nil || rel.Info.LastDeployed.IsZero() {
		return 0
	}
	return rel.Info.LastDeployed.Unix()
}

// latestRevisions groups releases by name and returns only the latest revision per release.
func latestRevisions(releases []*release.Release) []*release.Release {
	latest := make(map[string]*release.Release)
	for _, r := range releases {
		if cur, ok := latest[r.Name]; !ok || r.Version > cur.Version {
			latest[r.Name] = r
		}
	}
	out := make([]*release.Release, 0, len(latest))
	for _, r := range latest {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out
}

func releaseToListDTO(rel *release.Release, namespace string) dto.HelmReleaseDTO {
	d := dto.HelmReleaseDTO{
		Name:           rel.Name,
		Namespace:      namespace,
		Status:         releaseStatus(rel),
		Revision:       rel.Version,
		Chart:          chartString(rel),
		Updated:        releaseUpdated(rel),
		StorageBackend: "Secret",
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		d.ChartName = rel.Chart.Metadata.Name
		d.ChartVersion = rel.Chart.Metadata.Version
		d.AppVersion = rel.Chart.Metadata.AppVersion
	}
	if rel.Info != nil {
		d.Description = rel.Info.Description
	}
	return d
}

func ListHelmReleases(_ context.Context, c *cluster.Clients, namespace string) ([]dto.HelmReleaseDTO, error) {
	store := helmSecretStorage(c, namespace)

	releases, err := store.ListReleases()
	if err != nil {
		return nil, err
	}

	latest := latestRevisions(releases)

	out := make([]dto.HelmReleaseDTO, 0, len(latest))
	for _, rel := range latest {
		ns := namespace
		if rel.Namespace != "" {
			ns = rel.Namespace
		}
		out = append(out, releaseToListDTO(rel, ns))
	}

	return out, nil
}
