package dataplane

type signalResourceMetadataKey struct {
	kind      string
	namespace string
	name      string
}

type signalResourceMetadata struct {
	labels      map[string]string
	annotations map[string]string
}

func enrichDashboardSignalMetadata(items []ClusterDashboardSignal, snapshots dashboardSnapshotSet) []ClusterDashboardSignal {
	if len(items) == 0 {
		return nil
	}
	index := make(map[signalResourceMetadataKey]signalResourceMetadata)
	add := func(kind, namespace, name string, labels, annotations map[string]string) {
		if name == "" || (len(labels) == 0 && len(annotations) == 0) {
			return
		}
		index[signalResourceMetadataKey{kind: kind, namespace: namespace, name: name}] = signalResourceMetadata{
			labels:      labels,
			annotations: annotations,
		}
	}
	for _, item := range snapshots.pods.Items {
		add("Pod", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.deps.Items {
		add("Deployment", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.jobs.Items {
		add("Job", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.cjs.Items {
		add("CronJob", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.hpas.Items {
		add("HorizontalPodAutoscaler", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.svcs.Items {
		add("Service", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.ings.Items {
		add("Ingress", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.pvcs.Items {
		add("PersistentVolumeClaim", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.pvs.Items {
		add("PersistentVolume", "", item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.roles.Items {
		add("Role", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.roleBindings.Items {
		add("RoleBinding", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.resourceQuotas.Items {
		add("ResourceQuota", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.cms.Items {
		add("ConfigMap", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.secs.Items {
		add("Secret", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.sas.Items {
		add("ServiceAccount", item.Namespace, item.Name, item.Labels, item.Annotations)
	}
	for _, item := range snapshots.helmReleases.Items {
		add("HelmRelease", item.Namespace, item.Name, item.Labels, nil)
	}
	return enrichSignalsFromMetadataIndex(items, index)
}

func namespaceSignalMetadataIndex(snapshot NamespaceSnapshot) map[signalResourceMetadataKey]signalResourceMetadata {
	index := make(map[signalResourceMetadataKey]signalResourceMetadata, len(snapshot.Items))
	for _, item := range snapshot.Items {
		index[signalResourceMetadataKey{kind: "Namespace", name: item.Name}] = signalResourceMetadata{labels: item.Labels, annotations: item.Annotations}
	}
	return index
}

func enrichSignalsFromMetadataIndex(items []ClusterDashboardSignal, index map[signalResourceMetadataKey]signalResourceMetadata) []ClusterDashboardSignal {
	for i := range items {
		kind := items[i].ResourceKind
		if kind == "" {
			kind = items[i].Kind
		}
		name := items[i].ResourceName
		if name == "" {
			name = items[i].Name
		}
		namespace := items[i].Namespace
		if kind == "PersistentVolume" || kind == "Node" || kind == "Namespace" {
			namespace = ""
		}
		metadata, ok := index[signalResourceMetadataKey{kind: kind, namespace: namespace, name: name}]
		if !ok {
			continue
		}
		items[i].MatchLabels = cloneSignalMetadataMap(metadata.labels)
		items[i].MatchAnnotations = cloneSignalMetadataMap(metadata.annotations)
	}
	return items
}

func enrichNodeSignalMetadata(items []ClusterDashboardSignal, snapshot NodesSnapshot) []ClusterDashboardSignal {
	index := make(map[signalResourceMetadataKey]signalResourceMetadata, len(snapshot.Items))
	for _, item := range snapshot.Items {
		index[signalResourceMetadataKey{kind: "Node", name: item.Name}] = signalResourceMetadata{labels: item.Labels, annotations: item.Annotations}
	}
	return enrichSignalsFromMetadataIndex(items, index)
}

func enrichPersistentVolumeSignalMetadata(items []ClusterDashboardSignal, snapshot PersistentVolumesSnapshot) []ClusterDashboardSignal {
	index := make(map[signalResourceMetadataKey]signalResourceMetadata, len(snapshot.Items))
	for _, item := range snapshot.Items {
		index[signalResourceMetadataKey{kind: "PersistentVolume", name: item.Name}] = signalResourceMetadata{labels: item.Labels, annotations: item.Annotations}
	}
	return enrichSignalsFromMetadataIndex(items, index)
}

func AttachSignalMatchMetadata(items []ClusterDashboardSignal, labels, annotations map[string]string) []ClusterDashboardSignal {
	for i := range items {
		items[i].MatchLabels = cloneSignalMetadataMap(labels)
		items[i].MatchAnnotations = cloneSignalMetadataMap(annotations)
	}
	return items
}

func cloneSignalMetadataMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
