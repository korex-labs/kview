package cluster

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"
)

// ErrUnknownContext is returned when a context name is not found in the kubeconfig.
var ErrUnknownContext = errors.New("unknown context")

type ContextInfo struct {
	Name      string `json:"name"`
	Cluster   string `json:"cluster"`
	AuthInfo  string `json:"authInfo"`
	Namespace string `json:"namespace,omitempty"`
}

type Manager struct {
	mu sync.RWMutex

	rawConfig api.Config

	activeContext string

	clients map[string]*Clients

	kubeconfigFiles []string
	kubeconfigSet   bool

	logger Logger
}

// Logger is a minimal logger interface used by the cluster manager.
type Logger interface {
	Printf(format string, args ...any)
}

type stdLogger struct{}

func (stdLogger) Printf(format string, args ...any) {
	log.Printf(format, args...)
}

type Clients struct {
	RestConfig *rest.Config
	Clientset  *kubernetes.Clientset
	Discovery  discovery.DiscoveryInterface

	metricsMu     sync.Mutex
	metricsClient metricsclientset.Interface
	metricsErr    error
}

// MetricsClient returns a lazily-initialized clientset for metrics.k8s.io.
// The first caller builds the client from the stored RestConfig; subsequent
// callers reuse the cached instance (or cached error). This avoids paying
// any cost for the metrics API in clusters or operator flows that never
// touch metrics.
func (c *Clients) MetricsClient() (metricsclientset.Interface, error) {
	if c == nil {
		return nil, fmt.Errorf("nil clients")
	}
	c.metricsMu.Lock()
	defer c.metricsMu.Unlock()
	if c.metricsClient != nil || c.metricsErr != nil {
		return c.metricsClient, c.metricsErr
	}
	if c.RestConfig == nil {
		c.metricsErr = fmt.Errorf("nil rest config")
		return nil, c.metricsErr
	}
	client, err := metricsclientset.NewForConfig(c.RestConfig)
	if err != nil {
		c.metricsErr = fmt.Errorf("new metrics client: %w", err)
		return nil, c.metricsErr
	}
	c.metricsClient = client
	return c.metricsClient, nil
}

func defaultKubeconfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kube", "config")
}

func kubeconfigLocations(configPath string) ([]string, bool) {
	value := configPath
	if value == "" {
		value = os.Getenv("KUBECONFIG")
	}
	if value == "" {
		return []string{defaultKubeconfigPath()}, false
	}

	sep := string(os.PathListSeparator)
	if strings.Contains(value, sep) {
		parts := strings.Split(value, sep)
		locations := make([]string, 0, len(parts))
		for _, part := range parts {
			if part == "" {
				continue
			}
			locations = append(locations, part)
		}
		return locations, true
	}

	return []string{value}, true
}

func expandKubeconfigLocations(l Logger, locations []string) []string {
	files := []string{}
	for _, location := range locations {
		info, err := os.Stat(location)
		if err != nil {
			if os.IsNotExist(err) {
				l.Printf("kubeconfig: skip location %q: not found", location)
				continue
			}
			l.Printf("kubeconfig: skip location %q: %v", location, err)
			continue
		}

		if info.IsDir() {
			entries, err := os.ReadDir(location)
			if err != nil {
				l.Printf("kubeconfig: skip directory %q: %v", location, err)
				continue
			}
			names := make([]string, 0, len(entries))
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				names = append(names, entry.Name())
			}
			sort.Strings(names)
			for _, name := range names {
				files = append(files, filepath.Join(location, name))
			}
			continue
		}

		files = append(files, location)
	}
	return files
}

func buildLoadingRules(files []string, kubeconfigSet bool) *clientcmd.ClientConfigLoadingRules {
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	if kubeconfigSet || len(files) > 0 {
		rules.Precedence = files
		rules.ExplicitPath = ""
	}
	rules.WarnIfAllMissing = false
	return rules
}

func loadMergedKubeconfig(files []string, kubeconfigSet bool) (*api.Config, []string, error) {
	loadingRules := buildLoadingRules(files, kubeconfigSet)
	effectiveFiles := loadingRules.GetLoadingPrecedence()

	merged, err := loadingRules.Load()
	if err != nil {
		return nil, nil, err
	}
	if err := clientcmd.ResolveLocalPaths(merged); err != nil {
		log.Printf("kubeconfig: resolve paths warning: %v", err)
	}

	return merged, effectiveFiles, nil
}

func NewManager() (*Manager, error) {
	return NewManagerWithLogger(stdLogger{})
}

// NewManagerWithLogger allows callers to capture kubeconfig discovery logs.
func NewManagerWithLogger(l Logger) (*Manager, error) {
	return NewManagerWithLoggerAndConfig(l, "")
}

// NewManagerWithLoggerAndConfig allows callers to provide an explicit
// kubeconfig file or directory. A non-empty configPath overrides KUBECONFIG.
func NewManagerWithLoggerAndConfig(l Logger, configPath string) (*Manager, error) {
	locations, kubeconfigSet := kubeconfigLocations(configPath)
	l.Printf("kubeconfig: discovered locations: %v", locations)
	files := expandKubeconfigLocations(l, locations)
	l.Printf("kubeconfig: files to read: %v", files)

	cfg, effectiveFiles, err := loadMergedKubeconfig(files, kubeconfigSet)
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w", err)
	}

	m := &Manager{
		rawConfig:       *cfg,
		activeContext:   cfg.CurrentContext,
		clients:         map[string]*Clients{},
		kubeconfigFiles: effectiveFiles,
		kubeconfigSet:   kubeconfigSet,
		logger:          l,
	}
	return m, nil
}

func (m *Manager) ListContexts() []ContextInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]ContextInfo, 0, len(m.rawConfig.Contexts))
	for name, ctx := range m.rawConfig.Contexts {
		out = append(out, ContextInfo{
			Name:      name,
			Cluster:   ctx.Cluster,
			AuthInfo:  ctx.AuthInfo,
			Namespace: ctx.Namespace,
		})
	}
	return out
}

func (m *Manager) ContextInfo(name string) (ContextInfo, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ctx, ok := m.rawConfig.Contexts[name]
	if !ok {
		return ContextInfo{}, false
	}
	return ContextInfo{
		Name:      name,
		Cluster:   ctx.Cluster,
		AuthInfo:  ctx.AuthInfo,
		Namespace: ctx.Namespace,
	}, true
}

func (m *Manager) ActiveContext() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.activeContext
}

func (m *Manager) SetActiveContext(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.rawConfig.Contexts[name]; !ok {
		return fmt.Errorf("%w: %s", ErrUnknownContext, name)
	}
	m.activeContext = name
	return nil
}

func (m *Manager) GetClients(ctx context.Context) (*Clients, string, error) {
	m.mu.RLock()
	active := m.activeContext
	if c, ok := m.clients[active]; ok {
		m.mu.RUnlock()
		return c, active, nil
	}
	m.mu.RUnlock()

	// Build rest.Config for the active context (supports exec plugins => OIDC-friendly)
	overrides := &clientcmd.ConfigOverrides{CurrentContext: active}
	loadingRules := buildLoadingRules(m.kubeconfigFiles, m.kubeconfigSet)
	cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)

	restCfg, err := cc.ClientConfig()
	if err != nil {
		return nil, active, fmt.Errorf("build rest config: %w", err)
	}

	ensureExecEnv(restCfg, m.kubeconfigFiles)

	clientset, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, active, fmt.Errorf("new clientset: %w", err)
	}

	disc, err := discovery.NewDiscoveryClientForConfig(restCfg)
	if err != nil {
		return nil, active, fmt.Errorf("new discovery: %w", err)
	}

	clients := &Clients{
		RestConfig: restCfg,
		Clientset:  clientset,
		Discovery:  disc,
	}

	m.mu.Lock()
	m.clients[active] = clients
	m.mu.Unlock()

	return clients, active, nil
}

// GetClientsForContext returns clients for a specific context name without
// touching the active context. Returns an error if contextName is unknown.
func (m *Manager) GetClientsForContext(ctx context.Context, contextName string) (*Clients, string, error) {
	m.mu.RLock()
	if _, ok := m.rawConfig.Contexts[contextName]; !ok {
		m.mu.RUnlock()
		return nil, contextName, fmt.Errorf("%w: %s", ErrUnknownContext, contextName)
	}
	if c, ok := m.clients[contextName]; ok {
		m.mu.RUnlock()
		return c, contextName, nil
	}
	m.mu.RUnlock()

	overrides := &clientcmd.ConfigOverrides{CurrentContext: contextName}
	loadingRules := buildLoadingRules(m.kubeconfigFiles, m.kubeconfigSet)
	cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)

	restCfg, err := cc.ClientConfig()
	if err != nil {
		return nil, contextName, fmt.Errorf("build rest config: %w", err)
	}

	ensureExecEnv(restCfg, m.kubeconfigFiles)

	clientset, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, contextName, fmt.Errorf("new clientset: %w", err)
	}

	disc, err := discovery.NewDiscoveryClientForConfig(restCfg)
	if err != nil {
		return nil, contextName, fmt.Errorf("new discovery: %w", err)
	}

	clients := &Clients{
		RestConfig: restCfg,
		Clientset:  clientset,
		Discovery:  disc,
	}

	m.mu.Lock()
	m.clients[contextName] = clients
	m.mu.Unlock()

	return clients, contextName, nil
}

func ensureExecEnv(restCfg *rest.Config, kubeconfigFiles []string) {
	if restCfg == nil || restCfg.ExecProvider == nil {
		return
	}

	known := map[string]struct{}{}
	for _, env := range restCfg.ExecProvider.Env {
		if env.Name != "" {
			known[env.Name] = struct{}{}
		}
	}
	for _, kv := range os.Environ() {
		if key, _, ok := strings.Cut(kv, "="); ok && key != "" {
			known[key] = struct{}{}
		}
	}

	addEnv := func(name, value string) {
		if name == "" || value == "" {
			return
		}
		if _, ok := known[name]; ok {
			return
		}
		restCfg.ExecProvider.Env = append(restCfg.ExecProvider.Env, api.ExecEnvVar{
			Name:  name,
			Value: value,
		})
		known[name] = struct{}{}
	}

	if len(kubeconfigFiles) > 0 {
		addEnv("KUBECONFIG", strings.Join(kubeconfigFiles, string(os.PathListSeparator)))
	}

	addEnv("BROWSER", defaultBrowserCommand())

	cacheHome := defaultCacheHome()
	addEnv("XDG_CACHE_HOME", cacheHome)
	addEnv("KUBECACHEDIR", defaultKubeCacheDir(cacheHome))
}

func defaultBrowserCommand() string {
	switch runtime.GOOS {
	case "linux":
		return "xdg-open"
	case "darwin":
		return "open"
	case "windows":
		return "rundll32"
	default:
		return ""
	}
}

func defaultCacheHome() string {
	if v := os.Getenv("XDG_CACHE_HOME"); v != "" {
		return v
	}
	if dir, err := os.UserCacheDir(); err == nil && dir != "" {
		return dir
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".cache")
	}
	return ""
}

func defaultKubeCacheDir(cacheHome string) string {
	if v := os.Getenv("KUBECACHEDIR"); v != "" {
		return v
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".kube", "cache")
	}
	if cacheHome != "" {
		return filepath.Join(cacheHome, "kube")
	}
	return ""
}
