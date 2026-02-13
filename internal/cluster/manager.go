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
}

type Clients struct {
	RestConfig *rest.Config
	Clientset  *kubernetes.Clientset
	Discovery  discovery.DiscoveryInterface
}

func defaultKubeconfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kube", "config")
}

func kubeconfigLocations() []string {
	envValue := os.Getenv("KUBECONFIG")
	if envValue == "" {
		return []string{defaultKubeconfigPath()}
	}

	sep := string(os.PathListSeparator)
	if strings.Contains(envValue, sep) {
		parts := strings.Split(envValue, sep)
		locations := make([]string, 0, len(parts))
		for _, part := range parts {
			if part == "" {
				continue
			}
			locations = append(locations, part)
		}
		return locations
	}

	return []string{envValue}
}

func expandKubeconfigLocations(locations []string) []string {
	files := []string{}
	for _, location := range locations {
		info, err := os.Stat(location)
		if err != nil {
			if os.IsNotExist(err) {
				log.Printf("kubeconfig: skip location %q: not found", location)
				continue
			}
			log.Printf("kubeconfig: skip location %q: %v", location, err)
			continue
		}

		if info.IsDir() {
			entries, err := os.ReadDir(location)
			if err != nil {
				log.Printf("kubeconfig: skip directory %q: %v", location, err)
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

func buildLoadingRules(files []string) *clientcmd.ClientConfigLoadingRules {
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	if len(files) > 0 {
		rules.Precedence = files
		rules.ExplicitPath = ""
	}
	rules.WarnIfAllMissing = false
	return rules
}

func loadMergedKubeconfig(files []string) (*api.Config, []string, error) {
	loadingRules := buildLoadingRules(files)
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
	locations := kubeconfigLocations()
	log.Printf("kubeconfig: discovered locations: %v", locations)
	files := expandKubeconfigLocations(locations)
	log.Printf("kubeconfig: files to read: %v", files)

	cfg, effectiveFiles, err := loadMergedKubeconfig(files)
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w", err)
	}

	m := &Manager{
		rawConfig:       *cfg,
		activeContext:   cfg.CurrentContext,
		clients:         map[string]*Clients{},
		kubeconfigFiles: effectiveFiles,
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
	loadingRules := buildLoadingRules(m.kubeconfigFiles)
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
	loadingRules := buildLoadingRules(m.kubeconfigFiles)
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
