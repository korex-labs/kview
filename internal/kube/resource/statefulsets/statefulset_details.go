package statefulsets

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/internal/cluster"
	kubepods "github.com/korex-labs/kview/internal/kube/resource/pods"
	deployments "github.com/korex-labs/kview/internal/kube/resource/deployments"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func GetStatefulSetDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.StatefulSetDetailsDTO, error) {
	set, err := c.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := statefulSetYAML(set)
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

	desired := int32(0)
	if set.Spec.Replicas != nil {
		desired = *set.Spec.Replicas
	}

	age := int64(0)
	if !set.CreationTimestamp.IsZero() {
		age = int64(now.Sub(set.CreationTimestamp.Time).Seconds())
	}

	strategy := string(set.Spec.UpdateStrategy.Type)
	if strategy == "" {
		strategy = "RollingUpdate"
	}

	podManagementPolicy := string(set.Spec.PodManagementPolicy)
	if podManagementPolicy == "" {
		podManagementPolicy = "OrderedReady"
	}

	var updatePartition *int32
	if set.Spec.UpdateStrategy.RollingUpdate != nil && set.Spec.UpdateStrategy.RollingUpdate.Partition != nil {
		val := *set.Spec.UpdateStrategy.RollingUpdate.Partition
		updatePartition = &val
	}

	var revisionHistoryLimit *int32
	if set.Spec.RevisionHistoryLimit != nil {
		val := *set.Spec.RevisionHistoryLimit
		revisionHistoryLimit = &val
	}

	summary := dto.StatefulSetSummaryDTO{
		Name:                 set.Name,
		Namespace:            set.Namespace,
		ServiceName:          set.Spec.ServiceName,
		PodManagementPolicy:  podManagementPolicy,
		UpdateStrategy:       strategy,
		UpdatePartition:      updatePartition,
		RevisionHistoryLimit: revisionHistoryLimit,
		Selector:             selector,
		Desired:              desired,
		Current:              set.Status.Replicas,
		Ready:                set.Status.ReadyReplicas,
		Updated:              set.Status.UpdatedReplicas,
		AgeSec:               age,
	}

	conditions := make([]dto.StatefulSetConditionDTO, 0, len(set.Status.Conditions))
	for _, cond := range set.Status.Conditions {
		lt := int64(0)
		if !cond.LastTransitionTime.IsZero() {
			lt = cond.LastTransitionTime.Unix()
		}
		conditions = append(conditions, dto.StatefulSetConditionDTO{
			Type:               string(cond.Type),
			Status:             string(cond.Status),
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: lt,
		})
	}

	pods, err := listStatefulSetPods(ctx, c, set, selector)
	if err != nil {
		return nil, err
	}

	spec := dto.StatefulSetSpecDTO{
		PodTemplate: dto.PodTemplateSummaryDTO{
			Containers:       deployments.MapContainerSummaries(set.Spec.Template.Spec.Containers),
			InitContainers:   deployments.MapContainerSummaries(set.Spec.Template.Spec.InitContainers),
			ImagePullSecrets: kubepods.MapImagePullSecrets(set.Spec.Template.Spec.ImagePullSecrets),
		},
		Scheduling: dto.StatefulSetSchedulingDTO{
			NodeSelector:              set.Spec.Template.Spec.NodeSelector,
			AffinitySummary:           kubepods.SummarizeAffinity(set.Spec.Template.Spec.Affinity),
			Tolerations:               kubepods.MapTolerations(set.Spec.Template.Spec.Tolerations),
			TopologySpreadConstraints: kubepods.MapTopologySpread(set.Spec.Template.Spec.TopologySpreadConstraints),
		},
		Volumes: kubepods.MapVolumes(set.Spec.Template.Spec.Volumes),
		Metadata: dto.StatefulSetTemplateMetadataDTO{
			Labels:      set.Spec.Template.Labels,
			Annotations: set.Spec.Template.Annotations,
		},
	}

	metadata := dto.StatefulSetMetadataDTO{
		Labels:      set.Labels,
		Annotations: set.Annotations,
	}

	return &dto.StatefulSetDetailsDTO{
		Summary:    summary,
		Conditions: conditions,
		Pods:       pods,
		Spec:       spec,
		Metadata:   metadata,
		YAML:       string(y),
	}, nil
}

func GetStatefulSetYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	set, err := c.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := statefulSetYAML(set)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func listStatefulSetPods(ctx context.Context, c *cluster.Clients, set *appsv1.StatefulSet, selector string) ([]dto.StatefulSetPodDTO, error) {
	pods, err := kubepods.ListPodsBySelector(ctx, c, set.Namespace, selector)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.StatefulSetPodDTO, 0, len(pods))
	for _, p := range pods {
		if !isPodOwnedByStatefulSetRef(&p, set) {
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
		out = append(out, dto.StatefulSetPodDTO{
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

func isPodOwnedByStatefulSetRef(pod *corev1.Pod, set *appsv1.StatefulSet) bool {
	for _, ref := range pod.OwnerReferences {
		if ref.Kind != "StatefulSet" {
			continue
		}
		if ref.UID == set.UID || ref.Name == set.Name {
			return true
		}
	}
	return false
}

func statefulSetYAML(set *appsv1.StatefulSet) ([]byte, error) {
	setCopy := set.DeepCopy()
	setCopy.ManagedFields = nil
	b, err := json.Marshal(setCopy)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}
