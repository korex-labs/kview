package helm

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"helm.sh/helm/v3/pkg/release"
	syaml "sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func GetHelmReleaseDetails(_ context.Context, c *cluster.Clients, namespace, releaseName string) (*dto.HelmReleaseDetailsDTO, error) {
	store := helmSecretStorage(c, namespace)

	history, err := store.History(releaseName)
	if err != nil {
		return nil, fmt.Errorf("helm release %q not found: %w", releaseName, err)
	}

	if len(history) == 0 {
		return nil, fmt.Errorf("helm release %q not found", releaseName)
	}

	// Sort history by revision descending (newest first).
	sort.Slice(history, func(i, j int) bool {
		return history[i].Version > history[j].Version
	})

	latest := history[0]

	// Build history DTOs.
	historyDTOs := make([]dto.HelmReleaseRevision, 0, len(history))
	for _, rel := range history {
		rev := dto.HelmReleaseRevision{
			Revision: rel.Version,
			Status:   releaseStatus(rel),
			Updated:  releaseUpdated(rel),
		}
		if rel.Chart != nil && rel.Chart.Metadata != nil {
			rev.Chart = chartString(rel)
			rev.ChartVersion = rel.Chart.Metadata.Version
			rev.AppVersion = rel.Chart.Metadata.AppVersion
		}
		if rel.Info != nil {
			rev.Description = rel.Info.Description
		}
		historyDTOs = append(historyDTOs, rev)
	}

	// Build summary.
	summary := dto.HelmReleaseSummaryDTO{
		Name:           latest.Name,
		Namespace:      namespace,
		Revision:       latest.Version,
		StorageBackend: "Secret",
		Status:         releaseStatus(latest),
		Updated:        releaseUpdated(latest),
	}
	if latest.Namespace != "" {
		summary.Namespace = latest.Namespace
	}
	if latest.Chart != nil && latest.Chart.Metadata != nil {
		summary.Chart = chartString(latest)
		summary.ChartName = latest.Chart.Metadata.Name
		summary.ChartVersion = latest.Chart.Metadata.Version
		summary.AppVersion = latest.Chart.Metadata.AppVersion
	}
	if latest.Info != nil {
		summary.Description = latest.Info.Description
		if !latest.Info.FirstDeployed.IsZero() {
			summary.FirstDeployed = latest.Info.FirstDeployed.Unix()
		}
		if !latest.Info.LastDeployed.IsZero() {
			summary.LastDeployed = latest.Info.LastDeployed.Unix()
		}
	}

	// Notes.
	notes := ""
	if latest.Info != nil {
		notes = latest.Info.Notes
	}

	// Values: marshal user-supplied config as YAML.
	values := ""
	if len(latest.Config) > 0 {
		valBytes, err := syaml.Marshal(latest.Config)
		if err == nil {
			values = string(valBytes)
		}
	}

	// Manifest.
	manifest := latest.Manifest

	// Hooks.
	hooks := buildHookDTOs(latest.Hooks)

	// YAML: serialize a cleaned-up release representation.
	yamlStr := buildReleaseYAML(latest)

	return &dto.HelmReleaseDetailsDTO{
		Summary:  summary,
		History:  historyDTOs,
		Notes:    notes,
		Values:   values,
		Manifest: manifest,
		Hooks:    hooks,
		Yaml:     yamlStr,
	}, nil
}

func buildHookDTOs(hooks []*release.Hook) []dto.HelmHookDTO {
	if len(hooks) == 0 {
		return nil
	}
	out := make([]dto.HelmHookDTO, 0, len(hooks))
	for _, h := range hooks {
		events := make([]string, 0, len(h.Events))
		for _, e := range h.Events {
			events = append(events, string(e))
		}
		policies := make([]string, 0, len(h.DeletePolicies))
		for _, p := range h.DeletePolicies {
			policies = append(policies, string(p))
		}
		out = append(out, dto.HelmHookDTO{
			Name:           h.Name,
			Kind:           h.Kind,
			Events:         events,
			Weight:         h.Weight,
			DeletePolicies: policies,
		})
	}
	return out
}

// releaseYAMLView is a cleaned-up representation of a release for YAML display.
// Excludes chart templates to avoid massive payloads.
type releaseYAMLView struct {
	Name      string                 `json:"name"`
	Namespace string                 `json:"namespace"`
	Revision  int                    `json:"revision"`
	Status    string                 `json:"status"`
	Chart     string                 `json:"chart"`
	Config    map[string]interface{} `json:"config,omitempty"`
	Info      *releaseInfoView       `json:"info,omitempty"`
}

type releaseInfoView struct {
	FirstDeployed string `json:"firstDeployed,omitempty"`
	LastDeployed  string `json:"lastDeployed,omitempty"`
	Description   string `json:"description,omitempty"`
	Notes         string `json:"notes,omitempty"`
	Status        string `json:"status"`
}

func buildReleaseYAML(rel *release.Release) string {
	view := releaseYAMLView{
		Name:      rel.Name,
		Namespace: rel.Namespace,
		Revision:  rel.Version,
		Status:    releaseStatus(rel),
		Chart:     chartString(rel),
		Config:    rel.Config,
	}
	if rel.Info != nil {
		view.Info = &releaseInfoView{
			Description: rel.Info.Description,
			Notes:       rel.Info.Notes,
			Status:      rel.Info.Status.String(),
		}
		if !rel.Info.FirstDeployed.IsZero() {
			view.Info.FirstDeployed = rel.Info.FirstDeployed.Format("2006-01-02T15:04:05Z07:00")
		}
		if !rel.Info.LastDeployed.IsZero() {
			view.Info.LastDeployed = rel.Info.LastDeployed.Format("2006-01-02T15:04:05Z07:00")
		}
	}

	yamlBytes, err := syaml.Marshal(view)
	if err != nil {
		return ""
	}
	yamlStr := string(yamlBytes)
	if strings.TrimSpace(rel.Manifest) == "" {
		return yamlStr
	}
	return strings.TrimRight(yamlStr, "\n") + "\nmanifest: |\n" + indentYAMLLiteralBlock(rel.Manifest)
}

func indentYAMLLiteralBlock(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.TrimRight(value, "\n") + "\n"

	lines := strings.SplitAfter(value, "\n")
	var b strings.Builder
	for _, line := range lines {
		if line == "" {
			continue
		}
		b.WriteString("  ")
		b.WriteString(line)
	}
	return b.String()
}
