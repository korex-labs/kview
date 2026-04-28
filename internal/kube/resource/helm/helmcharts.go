package helm

import (
	"context"
	"sort"
	"strings"

	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// ListHelmCharts returns logical chart groupings across all namespaces.
// Each entry represents a unique chart name with version rollups in details.
func ListHelmCharts(_ context.Context, c *cluster.Clients) ([]dto.HelmChartDTO, error) {
	// Query Helm secrets across all namespaces.
	d := driver.NewSecrets(c.Clientset.CoreV1().Secrets(""))
	store := storage.Init(d)
	store.Log = func(_ string, _ ...interface{}) {}

	allReleases, err := store.ListReleases()
	if err != nil {
		return nil, err
	}

	// Deduplicate to latest revision per release.
	latest := latestRevisions(allReleases)

	type versionKey struct {
		version string
	}
	type versionAgg struct {
		appVersion     string
		releases       int
		namespaces     map[string]bool
		statuses       map[string]bool
		needsAttention int
	}
	type chartAgg struct {
		releases       int
		namespaces     map[string]bool
		statuses       map[string]bool
		needsAttention int
		versions       map[versionKey]*versionAgg
	}

	groups := make(map[string]*chartAgg)
	for _, rel := range latest {
		key := chartKeyFromRelease(rel)
		agg, ok := groups[key.name]
		if !ok {
			agg = &chartAgg{
				namespaces: make(map[string]bool),
				statuses:   make(map[string]bool),
				versions:   make(map[versionKey]*versionAgg),
			}
			groups[key.name] = agg
		}
		agg.releases++
		ns := rel.Namespace
		if ns != "" {
			agg.namespaces[ns] = true
		}
		vk := versionKey{version: key.version}
		vagg, ok := agg.versions[vk]
		if !ok {
			vagg = &versionAgg{namespaces: make(map[string]bool), statuses: make(map[string]bool)}
			agg.versions[vk] = vagg
		}
		vagg.releases++
		if ns != "" {
			vagg.namespaces[ns] = true
		}
		if rel.Chart != nil && rel.Chart.Metadata != nil && vagg.appVersion == "" {
			vagg.appVersion = rel.Chart.Metadata.AppVersion
		}
		if rel.Info != nil {
			status := strings.TrimSpace(rel.Info.Status.String())
			if status != "" {
				agg.statuses[status] = true
				vagg.statuses[status] = true
				if status != "deployed" {
					agg.needsAttention++
					vagg.needsAttention++
				}
			}
		}
	}

	out := make([]dto.HelmChartDTO, 0, len(groups))
	for name, agg := range groups {
		nsList := make([]string, 0, len(agg.namespaces))
		for ns := range agg.namespaces {
			nsList = append(nsList, ns)
		}
		sort.Strings(nsList)
		statuses := make([]string, 0, len(agg.statuses))
		for status := range agg.statuses {
			statuses = append(statuses, status)
		}
		sort.Strings(statuses)

		versions := make([]dto.HelmChartVersionDTO, 0, len(agg.versions))
		for key, vagg := range agg.versions {
			vns := make([]string, 0, len(vagg.namespaces))
			for ns := range vagg.namespaces {
				vns = append(vns, ns)
			}
			sort.Strings(vns)
			vstatuses := make([]string, 0, len(vagg.statuses))
			for status := range vagg.statuses {
				vstatuses = append(vstatuses, status)
			}
			sort.Strings(vstatuses)
			versions = append(versions, dto.HelmChartVersionDTO{
				ChartVersion:   key.version,
				AppVersion:     vagg.appVersion,
				Releases:       vagg.releases,
				Namespaces:     vns,
				Statuses:       vstatuses,
				NeedsAttention: vagg.needsAttention,
			})
		}
		sort.Slice(versions, func(i, j int) bool {
			return versions[i].ChartVersion < versions[j].ChartVersion
		})

		chartVersion := ""
		appVersion := ""
		if len(versions) == 1 {
			chartVersion = versions[0].ChartVersion
			appVersion = versions[0].AppVersion
		} else if len(versions) > 1 {
			chartVersion = "multiple"
			appVersion = "multiple"
		}

		out = append(out, dto.HelmChartDTO{
			ChartName:      name,
			ChartVersion:   chartVersion,
			AppVersion:     appVersion,
			Releases:       agg.releases,
			Namespaces:     nsList,
			Statuses:       statuses,
			NeedsAttention: agg.needsAttention,
			Versions:       versions,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].ChartName < out[j].ChartName
	})

	return out, nil
}

func chartKeyFromRelease(rel *release.Release) struct {
	name    string
	version string
} {
	name := "unknown"
	version := ""
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		name = rel.Chart.Metadata.Name
		version = rel.Chart.Metadata.Version
	}
	return struct {
		name    string
		version string
	}{name: name, version: version}
}
