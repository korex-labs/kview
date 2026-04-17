package daemonsets

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
	deployments "github.com/alex-mamchenkov/kview/internal/kube/resource/deployments"
	kubepods "github.com/alex-mamchenkov/kview/internal/kube/resource/pods"
)

func GetDaemonSetDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.DaemonSetDetailsDTO, error) {
	set, err := c.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := daemonSetYAML(set)
	if err != nil {
		return nil, err
	}

	now := time.Now()

	selector := ""
	if set.Spec.Selector != nil {
		if sel, err := metav1.LabelSelectorAsSelector(set.Spec.Selector); err == nil {
			selector = sel.String()
		}
	}

	age := int64(0)
	if !set.CreationTimestamp.IsZero() {
		age = int64(now.Sub(set.CreationTimestamp.Time).Seconds())
	}

	strategy := string(set.Spec.UpdateStrategy.Type)
	if strategy == "" {
		strategy = "RollingUpdate"
	}

	maxUnavailable := ""
	maxSurge := ""
	if set.Spec.UpdateStrategy.RollingUpdate != nil {
		if set.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable != nil {
			maxUnavailable = kubepods.IntOrString(*set.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable)
		}
		if set.Spec.UpdateStrategy.RollingUpdate.MaxSurge != nil {
			maxSurge = kubepods.IntOrString(*set.Spec.UpdateStrategy.RollingUpdate.MaxSurge)
		}
	}

	summary := dto.DaemonSetSummaryDTO{
		Name:           set.Name,
		Namespace:      set.Namespace,
		UpdateStrategy: strategy,
		MaxUnavailable: maxUnavailable,
		MaxSurge:       maxSurge,
		Selector:       selector,
		Desired:        set.Status.DesiredNumberScheduled,
		Current:        set.Status.CurrentNumberScheduled,
		Ready:          set.Status.NumberReady,
		Updated:        set.Status.UpdatedNumberScheduled,
		Available:      set.Status.NumberAvailable,
		AgeSec:         age,
	}

	conditions := make([]dto.DaemonSetConditionDTO, 0, len(set.Status.Conditions))
	for _, cond := range set.Status.Conditions {
		lt := int64(0)
		if !cond.LastTransitionTime.IsZero() {
			lt = cond.LastTransitionTime.Unix()
		}
		conditions = append(conditions, dto.DaemonSetConditionDTO{
			Type:               string(cond.Type),
			Status:             string(cond.Status),
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: lt,
		})
	}

	pods, err := listDaemonSetPods(ctx, c, set, selector)
	if err != nil {
		return nil, err
	}

	spec := dto.DaemonSetSpecDTO{
		PodTemplate: dto.PodTemplateSummaryDTO{
			Containers:       deployments.MapContainerSummaries(set.Spec.Template.Spec.Containers),
			InitContainers:   deployments.MapContainerSummaries(set.Spec.Template.Spec.InitContainers),
			ImagePullSecrets: kubepods.MapImagePullSecrets(set.Spec.Template.Spec.ImagePullSecrets),
		},
		Scheduling: dto.DaemonSetSchedulingDTO{
			NodeSelector:              set.Spec.Template.Spec.NodeSelector,
			AffinitySummary:           kubepods.SummarizeAffinity(set.Spec.Template.Spec.Affinity),
			Tolerations:               kubepods.MapTolerations(set.Spec.Template.Spec.Tolerations),
			TopologySpreadConstraints: kubepods.MapTopologySpread(set.Spec.Template.Spec.TopologySpreadConstraints),
		},
		Volumes: kubepods.MapVolumes(set.Spec.Template.Spec.Volumes),
		Metadata: dto.DaemonSetTemplateMetadataDTO{
			Labels:      set.Spec.Template.Labels,
			Annotations: set.Spec.Template.Annotations,
		},
	}

	metadata := dto.DaemonSetMetadataDTO{
		Labels:      set.Labels,
		Annotations: set.Annotations,
	}

	return &dto.DaemonSetDetailsDTO{
		Summary:    summary,
		Conditions: conditions,
		Pods:       pods,
		Spec:       spec,
		Metadata:   metadata,
		YAML:       string(y),
	}, nil
}

func GetDaemonSetYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	set, err := c.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := daemonSetYAML(set)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func listDaemonSetPods(ctx context.Context, c *cluster.Clients, set *appsv1.DaemonSet, selector string) ([]dto.DaemonSetPodDTO, error) {
	pods, err := kubepods.ListPodsBySelector(ctx, c, set.Namespace, selector)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.DaemonSetPodDTO, 0, len(pods))
	for _, p := range pods {
		if !isPodOwnedByDaemonSetRef(&p, set) {
			continue
		}

		var readyCount, totalCount int
		var restarts int32
		for _, cs := range p.Status.ContainerStatuses {
			totalCount++
			if cs.Ready {
				readyCount++
			}
			restarts += cs.RestartCount
		}
		age := int64(0)
		if !p.CreationTimestamp.IsZero() {
			age = int64(now.Sub(p.CreationTimestamp.Time).Seconds())
		}
		out = append(out, dto.DaemonSetPodDTO{
			Name:     p.Name,
			Phase:    string(p.Status.Phase),
			Ready:    kubepods.FmtReady(readyCount, totalCount),
			Restarts: restarts,
			Node:     p.Spec.NodeName,
			AgeSec:   age,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func isPodOwnedByDaemonSetRef(pod *corev1.Pod, set *appsv1.DaemonSet) bool {
	for _, ref := range pod.OwnerReferences {
		if ref.Kind != "DaemonSet" {
			continue
		}
		if ref.UID == set.UID || ref.Name == set.Name {
			return true
		}
	}
	return false
}

func daemonSetYAML(set *appsv1.DaemonSet) ([]byte, error) {
	setCopy := set.DeepCopy()
	setCopy.ManagedFields = nil
	b, err := json.Marshal(setCopy)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}
