package kube

import (
	"context"
	"fmt"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	syaml "sigs.k8s.io/yaml"

	"kview/internal/cluster"
)

// helmActionConfig builds a Helm action.Configuration bound to a specific
// context's rest.Config and namespace.
func helmActionConfig(restCfg *rest.Config, namespace string) (*action.Configuration, error) {
	cfg := new(action.Configuration)
	getter := &staticRESTClientGetter{restConfig: restCfg, namespace: namespace}
	if err := cfg.Init(getter, namespace, "secrets", func(_ string, _ ...interface{}) {}); err != nil {
		return nil, fmt.Errorf("helm config init: %w", err)
	}
	return cfg, nil
}

// staticRESTClientGetter implements genericclioptions.RESTClientGetter
// using an already-built rest.Config. This preserves exec-based auth (OIDC).
type staticRESTClientGetter struct {
	restConfig *rest.Config
	namespace  string
}

func (g *staticRESTClientGetter) ToRESTConfig() (*rest.Config, error) {
	return g.restConfig, nil
}

func (g *staticRESTClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	dc, err := discovery.NewDiscoveryClientForConfig(g.restConfig)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(dc), nil
}

func (g *staticRESTClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(dc), nil
}

func (g *staticRESTClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return &staticClientConfig{namespace: g.namespace}
}

// staticClientConfig is a minimal clientcmd.ClientConfig that only returns namespace.
type staticClientConfig struct {
	namespace string
}

func (c *staticClientConfig) RawConfig() (clientcmdapi.Config, error) {
	return clientcmdapi.Config{}, nil
}

func (c *staticClientConfig) ClientConfig() (*rest.Config, error) {
	return nil, fmt.Errorf("not supported")
}

func (c *staticClientConfig) Namespace() (string, bool, error) {
	return c.namespace, false, nil
}

func (c *staticClientConfig) ConfigAccess() clientcmd.ConfigAccess {
	return nil
}

// ---------- Helm Uninstall ----------

type HelmUninstallRequest struct {
	Namespace   string `json:"namespace"`
	Release     string `json:"release"`
	KeepHistory bool   `json:"keepHistory"`
}

type HelmActionResult struct {
	Status  string         `json:"status"`
	Message string         `json:"message,omitempty"`
	Details map[string]any `json:"details,omitempty"`
}

func HelmUninstall(_ context.Context, c *cluster.Clients, req HelmUninstallRequest) (*HelmActionResult, error) {
	cfg, err := helmActionConfig(c.RestConfig, req.Namespace)
	if err != nil {
		return nil, err
	}

	uninstall := action.NewUninstall(cfg)
	uninstall.KeepHistory = req.KeepHistory

	resp, err := uninstall.Run(req.Release)
	if err != nil {
		return nil, err
	}

	info := ""
	if resp != nil && resp.Info != "" {
		info = resp.Info
	}

	return &HelmActionResult{
		Status:  "ok",
		Message: "uninstalled",
		Details: map[string]any{
			"release": req.Release,
			"info":    info,
		},
	}, nil
}

// ---------- Helm Upgrade ----------

type HelmUpgradeRequest struct {
	Namespace  string `json:"namespace"`
	Release    string `json:"release"`
	Chart      string `json:"chart"`
	Version    string `json:"version"`
	ValuesYaml string `json:"valuesYaml"`
	Force      bool   `json:"force"`
}

func HelmUpgrade(_ context.Context, c *cluster.Clients, req HelmUpgradeRequest) (*HelmActionResult, error) {
	cfg, err := helmActionConfig(c.RestConfig, req.Namespace)
	if err != nil {
		return nil, err
	}

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = req.Namespace
	upgrade.Force = req.Force
	if req.Version != "" {
		upgrade.Version = req.Version
	}

	vals, err := parseValuesYaml(req.ValuesYaml)
	if err != nil {
		return nil, fmt.Errorf("invalid valuesYaml: %w", err)
	}

	chartPath, err := upgrade.ChartPathOptions.LocateChart(req.Chart, cli.New())
	if err != nil {
		return nil, fmt.Errorf("locate chart: %w", err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("load chart: %w", err)
	}

	rel, err := upgrade.Run(req.Release, ch, vals)
	if err != nil {
		return nil, err
	}

	return &HelmActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("upgraded to revision %d", rel.Version),
		Details: map[string]any{
			"release":  rel.Name,
			"revision": rel.Version,
			"status":   releaseStatus(rel),
			"force":    req.Force,
		},
	}, nil
}

// ---------- Helm Install ----------

type HelmInstallRequest struct {
	Namespace       string `json:"namespace"`
	Release         string `json:"release"`
	Chart           string `json:"chart"`
	Version         string `json:"version"`
	ValuesYaml      string `json:"valuesYaml"`
	CreateNamespace bool   `json:"createNamespace"`
}

func HelmInstall(_ context.Context, c *cluster.Clients, req HelmInstallRequest) (*HelmActionResult, error) {
	cfg, err := helmActionConfig(c.RestConfig, req.Namespace)
	if err != nil {
		return nil, err
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = req.Release
	install.Namespace = req.Namespace
	install.CreateNamespace = req.CreateNamespace
	if req.Version != "" {
		install.Version = req.Version
	}

	vals, err := parseValuesYaml(req.ValuesYaml)
	if err != nil {
		return nil, fmt.Errorf("invalid valuesYaml: %w", err)
	}

	chartPath, err := install.ChartPathOptions.LocateChart(req.Chart, cli.New())
	if err != nil {
		return nil, fmt.Errorf("locate chart: %w", err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("load chart: %w", err)
	}

	rel, err := install.Run(ch, vals)
	if err != nil {
		return nil, err
	}

	return &HelmActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("installed revision %d", rel.Version),
		Details: map[string]any{
			"release":  rel.Name,
			"revision": rel.Version,
			"status":   releaseStatus(rel),
		},
	}, nil
}

// ---------- Helm Reinstall ----------

type HelmReinstallRequest struct {
	Namespace string `json:"namespace"`
	Release   string `json:"release"`
	Force     bool   `json:"force"`
}

func HelmReinstall(ctx context.Context, c *cluster.Clients, req HelmReinstallRequest) (*HelmActionResult, error) {
	cfg, err := helmActionConfig(c.RestConfig, req.Namespace)
	if err != nil {
		return nil, err
	}

	get := action.NewGet(cfg)
	rel, err := get.Run(req.Release)
	if err != nil {
		return nil, err
	}

	if rel.Chart == nil {
		return nil, fmt.Errorf("reinstall unavailable: release has no chart data")
	}

	// --- fallback: no templates → server-side apply stored manifest ---
	if len(rel.Chart.Templates) == 0 {
		if strings.TrimSpace(rel.Manifest) == "" {
			return nil, fmt.Errorf("reinstall unavailable: release has no templates and empty stored manifest")
		}

		applied, skipped, err := ApplyManifest(ctx, c, req.Namespace, rel.Manifest)
		if err != nil {
			return nil, err
		}

		return &HelmActionResult{
			Status:  "ok",
			Message: "reapplied manifest",
			Details: map[string]any{
				"release":  req.Release,
				"revision": rel.Version,
				"applied":  applied,
				"skipped":  skipped,
			},
		}, nil
	}

	// --- normal path: upgrade-based reinstall ---
	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = req.Namespace
	upgrade.ReuseValues = true
	upgrade.ResetValues = false
	upgrade.Force = req.Force
	upgrade.Wait = true
	upgrade.Atomic = true
	upgrade.Timeout = 5 * time.Minute

	upgrade.DryRun = true
	preview, err := upgrade.Run(req.Release, rel.Chart, map[string]any{})
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(preview.Manifest) == "" {
		return nil, fmt.Errorf("reinstall aborted: rendered manifest is empty (would remove resources)")
	}

	upgrade.DryRun = false
	res, err := upgrade.Run(req.Release, rel.Chart, map[string]any{})
	if err != nil {
		return nil, err
	}

	return &HelmActionResult{
		Status:  "ok",
		Message: "reinstalled",
		Details: map[string]any{
			"release":  res.Name,
			"revision": res.Version,
			"status":   releaseStatus(res),
			"force":    req.Force,
		},
	}, nil
}

// ---------- ActionRegistry handlers ----------

// HandleHelmUninstall dispatches the "helm.uninstall" action from the unified ActionRegistry.
func HandleHelmUninstall(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if req.Namespace == "" || req.Name == "" {
		return &ActionResult{Status: "error", Message: "namespace and release name are required"}, nil
	}
	result, err := HelmUninstall(ctx, c, HelmUninstallRequest{
		Namespace:   req.Namespace,
		Release:     req.Name,
		KeepHistory: false,
	})
	if err != nil {
		return nil, err
	}
	return &ActionResult{Status: result.Status, Message: result.Message, Details: result.Details}, nil
}

// HandleHelmReinstall dispatches the "helm.reinstall" action from the unified ActionRegistry.
func HandleHelmReinstall(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if req.Namespace == "" || req.Name == "" {
		return &ActionResult{Status: "error", Message: "namespace and release name are required"}, nil
	}
	force, forceResult := helmBoolParam(req.Params, "force")
	if forceResult != nil {
		return forceResult, nil
	}
	result, err := HelmReinstall(ctx, c, HelmReinstallRequest{
		Namespace: req.Namespace,
		Release:   req.Name,
		Force:     force,
	})
	if err != nil {
		return nil, err
	}
	return &ActionResult{Status: result.Status, Message: result.Message, Details: result.Details}, nil
}

// HandleHelmUpgrade dispatches the "helm.upgrade" action from the unified ActionRegistry.
func HandleHelmUpgrade(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if req.Namespace == "" || req.Name == "" {
		return &ActionResult{Status: "error", Message: "namespace and release name are required"}, nil
	}
	chart, _ := req.Params["chart"].(string)
	if chart == "" {
		return &ActionResult{Status: "error", Message: "params.chart is required"}, nil
	}
	version, _ := req.Params["version"].(string)
	valuesYaml, _ := req.Params["valuesYaml"].(string)
	force, forceResult := helmBoolParam(req.Params, "force")
	if forceResult != nil {
		return forceResult, nil
	}
	result, err := HelmUpgrade(ctx, c, HelmUpgradeRequest{
		Namespace:  req.Namespace,
		Release:    req.Name,
		Chart:      chart,
		Version:    version,
		ValuesYaml: valuesYaml,
		Force:      force,
	})
	if err != nil {
		return nil, err
	}
	return &ActionResult{Status: result.Status, Message: result.Message, Details: result.Details}, nil
}

// ---------- helpers ----------

func helmBoolParam(params map[string]any, key string) (bool, *ActionResult) {
	raw, ok := params[key]
	if !ok {
		return false, nil
	}
	value, ok := raw.(bool)
	if !ok {
		return false, &ActionResult{Status: "error", Message: fmt.Sprintf("params.%s must be a boolean", key)}
	}
	return value, nil
}

func parseValuesYaml(raw string) (map[string]any, error) {
	if raw == "" {
		return map[string]any{}, nil
	}
	var vals map[string]any
	if err := syaml.Unmarshal([]byte(raw), &vals); err != nil {
		return nil, err
	}
	if vals == nil {
		vals = map[string]any{}
	}
	return vals, nil
}
