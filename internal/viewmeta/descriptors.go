package viewmeta

type AccessReviewResource struct {
	Group    string `json:"group"`
	Resource string `json:"resource"`
}

type ResourceDescriptor struct {
	Key           string               `json:"key"`
	Label         string               `json:"label"`
	ClusterScoped bool                 `json:"clusterScoped"`
	Icon          string               `json:"icon"`
	Access        AccessReviewResource `json:"access"`
	ListView      ListViewDescriptor   `json:"listView"`
}

type ListViewDescriptor struct {
	QuickFilters QuickFilterPolicy `json:"quickFilters"`
	DefaultSort  SortPolicy        `json:"defaultSort"`
	FilterLabel  string            `json:"filterLabel"`
	Identity     []string          `json:"identity"`
	SearchFields []string          `json:"searchFields"`
}

type QuickFilterPolicy struct {
	Search bool `json:"search"`
	Tag    bool `json:"tag"`
}

type SortPolicy struct {
	Field     string `json:"field"`
	Direction string `json:"direction"`
}

type SidebarGroup struct {
	ID    string   `json:"id"`
	Label string   `json:"label"`
	Icon  string   `json:"icon"`
	Items []string `json:"items"`
}

type DescriptorBundle struct {
	Resources     []ResourceDescriptor `json:"resources"`
	SidebarGroups []SidebarGroup       `json:"sidebarGroups"`
}

var resources = []ResourceDescriptor{
	{Key: "dashboard", Label: "Dashboard", ClusterScoped: true, Icon: "dashboard", Access: AccessReviewResource{Group: "", Resource: "namespaces"}},
	{Key: "pods", Label: "Pods", ClusterScoped: false, Icon: "pods", Access: AccessReviewResource{Group: "", Resource: "pods"}},
	{Key: "deployments", Label: "Deployments", ClusterScoped: false, Icon: "deployments", Access: AccessReviewResource{Group: "apps", Resource: "deployments"}},
	{Key: "daemonsets", Label: "Daemon Sets", ClusterScoped: false, Icon: "daemonsets", Access: AccessReviewResource{Group: "apps", Resource: "daemonsets"}},
	{Key: "statefulsets", Label: "Stateful Sets", ClusterScoped: false, Icon: "statefulsets", Access: AccessReviewResource{Group: "apps", Resource: "statefulsets"}},
	{Key: "replicasets", Label: "Replica Sets", ClusterScoped: false, Icon: "replicasets", Access: AccessReviewResource{Group: "apps", Resource: "replicasets"}},
	{Key: "services", Label: "Services", ClusterScoped: false, Icon: "services", Access: AccessReviewResource{Group: "", Resource: "services"}},
	{Key: "ingresses", Label: "Ingresses", ClusterScoped: false, Icon: "ingresses", Access: AccessReviewResource{Group: "networking.k8s.io", Resource: "ingresses"}},
	{Key: "networkpolicies", Label: "Network Policies", ClusterScoped: false, Icon: "networkpolicies", Access: AccessReviewResource{Group: "networking.k8s.io", Resource: "networkpolicies"}},
	{Key: "jobs", Label: "Jobs", ClusterScoped: false, Icon: "jobs", Access: AccessReviewResource{Group: "batch", Resource: "jobs"}},
	{Key: "cronjobs", Label: "Cron Jobs", ClusterScoped: false, Icon: "cronjobs", Access: AccessReviewResource{Group: "batch", Resource: "cronjobs"}},
	{Key: "horizontalpodautoscalers", Label: "HPA", ClusterScoped: false, Icon: "horizontalpodautoscalers", Access: AccessReviewResource{Group: "autoscaling", Resource: "horizontalpodautoscalers"}},
	{Key: "configmaps", Label: "Config Maps", ClusterScoped: false, Icon: "configmaps", Access: AccessReviewResource{Group: "", Resource: "configmaps"}},
	{Key: "secrets", Label: "Secrets", ClusterScoped: false, Icon: "secrets", Access: AccessReviewResource{Group: "", Resource: "secrets"}},
	{Key: "serviceaccounts", Label: "Service Accounts", ClusterScoped: false, Icon: "serviceaccounts", Access: AccessReviewResource{Group: "", Resource: "serviceaccounts"}},
	{Key: "roles", Label: "Roles", ClusterScoped: false, Icon: "roles", Access: AccessReviewResource{Group: "rbac.authorization.k8s.io", Resource: "roles"}},
	{Key: "rolebindings", Label: "Role Bindings", ClusterScoped: false, Icon: "rolebindings", Access: AccessReviewResource{Group: "rbac.authorization.k8s.io", Resource: "rolebindings"}},
	{Key: "clusterroles", Label: "Cluster Roles", ClusterScoped: true, Icon: "clusterroles", Access: AccessReviewResource{Group: "rbac.authorization.k8s.io", Resource: "clusterroles"}},
	{Key: "clusterrolebindings", Label: "Cluster Role Bindings", ClusterScoped: true, Icon: "clusterrolebindings", Access: AccessReviewResource{Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings"}},
	{Key: "persistentvolumeclaims", Label: "Persistent Volume Claims", ClusterScoped: false, Icon: "persistentvolumeclaims", Access: AccessReviewResource{Group: "", Resource: "persistentvolumeclaims"}},
	{Key: "persistentvolumes", Label: "Persistent Volumes", ClusterScoped: true, Icon: "persistentvolumes", Access: AccessReviewResource{Group: "", Resource: "persistentvolumes"}},
	{Key: "nodes", Label: "Nodes", ClusterScoped: true, Icon: "nodes", Access: AccessReviewResource{Group: "", Resource: "nodes"}},
	{Key: "namespaces", Label: "Namespaces", ClusterScoped: true, Icon: "namespaces", Access: AccessReviewResource{Group: "", Resource: "namespaces"}},
	{Key: "customresourcedefinitions", Label: "Custom Resource Definitions", ClusterScoped: true, Icon: "customresourcedefinitions", Access: AccessReviewResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}},
	{Key: "customresources", Label: "Custom Namespace Resources", ClusterScoped: false, Icon: "customresources", Access: AccessReviewResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}},
	{Key: "clusterresources", Label: "Custom Cluster Resources", ClusterScoped: true, Icon: "clusterresources", Access: AccessReviewResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}},
	{Key: "helm", Label: "Helm Releases", ClusterScoped: false, Icon: "helm", Access: AccessReviewResource{Group: "", Resource: "secrets"}},
	{Key: "helmcharts", Label: "Helm Charts", ClusterScoped: true, Icon: "helmcharts", Access: AccessReviewResource{Group: "", Resource: "secrets"}},
	{Key: "resourcequotas", Label: "Resource Quotas", ClusterScoped: false, Icon: "resourcequotas", Access: AccessReviewResource{Group: "", Resource: "resourcequotas"}},
	{Key: "limitranges", Label: "Limit Ranges", ClusterScoped: false, Icon: "limitranges", Access: AccessReviewResource{Group: "", Resource: "limitranges"}},
}

var sidebarGroups = []SidebarGroup{
	{ID: "workloads", Label: "Workloads", Icon: "workloads", Items: []string{"pods", "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs", "horizontalpodautoscalers"}},
	{ID: "networking", Label: "Networking", Icon: "networking", Items: []string{"services", "ingresses"}},
	{ID: "policy", Label: "Policy", Icon: "policy", Items: []string{"networkpolicies", "resourcequotas", "limitranges"}},
	{ID: "configuration", Label: "Configuration", Icon: "configuration", Items: []string{"configmaps", "secrets"}},
	{ID: "rbac", Label: "Access Control", Icon: "access-control", Items: []string{"serviceaccounts", "roles", "rolebindings", "clusterroles", "clusterrolebindings"}},
	{ID: "storage", Label: "Storage", Icon: "storage", Items: []string{"persistentvolumeclaims", "persistentvolumes"}},
	{ID: "helm", Label: "Helm", Icon: "helm", Items: []string{"helm", "helmcharts"}},
	{ID: "extensions", Label: "Extensions", Icon: "extensions", Items: []string{"customresources", "clusterresources", "customresourcedefinitions"}},
	{ID: "cluster", Label: "Cluster", Icon: "cluster", Items: []string{"dashboard", "nodes", "namespaces"}},
}

func Bundle() DescriptorBundle {
	resourceCopy := append([]ResourceDescriptor(nil), resources...)
	for i := range resourceCopy {
		resourceCopy[i].ListView = ListViewDescriptor{
			QuickFilters: QuickFilterPolicy{Search: resourceCopy[i].Key != "dashboard", Tag: resourceCopy[i].Key != "dashboard"},
			DefaultSort:  defaultSortForResource(resourceCopy[i].Key),
			FilterLabel:  filterLabelForResource(resourceCopy[i].Key),
			Identity:     identityFieldsForResource(resourceCopy[i].Key),
			SearchFields: searchFieldsForResource(resourceCopy[i].Key),
		}
	}
	groupCopy := make([]SidebarGroup, 0, len(sidebarGroups))
	for _, group := range sidebarGroups {
		group.Items = append([]string(nil), group.Items...)
		groupCopy = append(groupCopy, group)
	}
	return DescriptorBundle{Resources: resourceCopy, SidebarGroups: groupCopy}
}

func identityFieldsForResource(key string) []string {
	switch key {
	case "helmcharts":
		return []string{"chartName"}
	case "customresources", "clusterresources":
		return []string{"kind", "name"}
	default:
		return []string{"name"}
	}
}

func searchFieldsForResource(key string) []string {
	switch key {
	case "helmcharts":
		return []string{"chartName", "chartVersion", "appVersion", "statuses", "derivedSource"}
	case "helm":
		return []string{"name", "chart", "chartVersion", "appVersion", "status", "signalSeverity", "listSignalSeverity"}
	case "customresources", "clusterresources":
		return []string{"name", "kind", "group", "signalSeverity", "statusSummary"}
	case "customresourcedefinitions":
		return []string{"name", "group", "kind", "scope", "signalSeverity", "listSignalSeverity"}
	case "pods":
		return []string{"name", "nodeName", "phase", "status", "signalSeverity", "listSignalSeverity"}
	case "nodes":
		return []string{"name", "role", "roles", "status", "source", "signalSeverity", "listSignalSeverity"}
	default:
		return []string{"name", "status", "phase", "type", "signalSeverity", "listSignalSeverity"}
	}
}

func filterLabelForResource(key string) string {
	switch key {
	case "horizontalpodautoscalers":
		return "Filter (name/target/metric/signal)"
	case "clusterrolebindings":
		return "Filter (name/role/signal)"
	case "networkpolicies":
		return "Filter (name/selector/type)"
	case "persistentvolumes":
		return "Filter (name/status/signal/storageClass/claim)"
	case "jobs":
		return "Filter (name/status)"
	case "ingresses":
		return "Filter (name/class/signal/host)"
	case "statefulsets":
		return "Filter (name/service)"
	case "customresources", "clusterresources":
		return "Filter (name/kind/group/status)"
	case "clusterroles":
		return "Filter (name/signal)"
	case "deployments", "daemonsets":
		return "Filter (name/strategy)"
	case "services":
		return "Filter (name/type/signal/exposure)"
	case "helmcharts":
		return "Filter (chart/version/status/source)"
	case "helm":
		return "Filter (name / chart / signal / version)"
	case "nodes":
		return "Filter (name/role/status/signal/source)"
	case "namespaces":
		return "Filter (name, status, signals, workload, quota)"
	case "configmaps", "roles", "rolebindings":
		return "Filter (name/signal)"
	case "resourcequotas":
		return "Filter (name/key)"
	case "secrets":
		return "Filter (name/type/signal)"
	case "limitranges":
		return "Filter (name/type)"
	case "replicasets":
		return "Filter (name/owner)"
	case "cronjobs":
		return "Filter (name/schedule)"
	case "persistentvolumeclaims":
		return "Filter (name/status/signal/storageClass/volume)"
	case "pods":
		return "Filter (name/node/status)"
	case "serviceaccounts":
		return "Filter (name/token/pullSecret)"
	default:
		return "Filter"
	}
}

func defaultSortForResource(key string) SortPolicy {
	switch key {
	case "customresources", "clusterresources":
		return SortPolicy{Field: "kind", Direction: "asc"}
	case "helmcharts":
		return SortPolicy{Field: "chartName", Direction: "asc"}
	default:
		return SortPolicy{Field: "name", Direction: "asc"}
	}
}
