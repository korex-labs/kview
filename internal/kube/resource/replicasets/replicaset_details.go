package replicasets

import (
	"context"
	"sort"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/dto"
	deployments "github.com/korex-labs/kview/internal/kube/resource/deployments"
	kubepods "github.com/korex-labs/kview/internal/kube/resource/pods"
	svcs "github.com/korex-labs/kview/internal/kube/resource/services"
)

func GetReplicaSetDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.ReplicaSetDetailsDTO, error) {
	rs, err := c.Clientset.AppsV1().ReplicaSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	rsCopy := rs.DeepCopy()
	rsCopy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(rsCopy, "apps/v1", "ReplicaSet")
	if err != nil {
		return nil, err
	}

	now := time.Now()
	selector := ""
	if rs.Spec.Selector != nil {
		if sel, err := metav1.LabelSelectorAsSelector(rs.Spec.Selector); err == nil {
			selector = sel.String()
		}
	}

	desired := int32(0)
	if rs.Spec.Replicas != nil {
		desired = *rs.Spec.Replicas
	}

	age := int64(0)
	if !rs.CreationTimestamp.IsZero() {
		age = int64(now.Sub(rs.CreationTimestamp.Time).Seconds())
	}

	summary := dto.ReplicaSetSummaryDTO{
		Name:      rs.Name,
		Namespace: rs.Namespace,
		Owner:     mapReplicaSetOwner(rs.OwnerReferences),
		Revision:  deployments.ParseRevision(rs.Annotations["deployment.kubernetes.io/revision"]),
		Selector:  selector,
		Desired:   desired,
		Current:   rs.Status.Replicas,
		Ready:     rs.Status.ReadyReplicas,
		AgeSec:    age,
	}

	conditions := make([]dto.ReplicaSetConditionDTO, 0, len(rs.Status.Conditions))
	for _, cond := range rs.Status.Conditions {
		lt := int64(0)
		if !cond.LastTransitionTime.IsZero() {
			lt = cond.LastTransitionTime.Unix()
		}
		conditions = append(conditions, dto.ReplicaSetConditionDTO{
			Type:               string(cond.Type),
			Status:             string(cond.Status),
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: lt,
		})
	}

	pods, readyPods, err := listReplicaSetPods(ctx, c, rs, selector)
	if err != nil {
		return nil, err
	}

	spec := dto.ReplicaSetSpecDTO{
		PodTemplate: dto.PodTemplateSummaryDTO{
			Containers: deployments.MapContainerSummaries(rs.Spec.Template.Spec.Containers),
		},
		Scheduling: dto.ReplicaSetSchedulingDTO{
			NodeSelector:    rs.Spec.Template.Spec.NodeSelector,
			AffinitySummary: kubepods.SummarizeAffinity(rs.Spec.Template.Spec.Affinity),
			Tolerations:     kubepods.MapTolerations(rs.Spec.Template.Spec.Tolerations),
		},
		Volumes: kubepods.MapVolumes(rs.Spec.Template.Spec.Volumes),
		Metadata: dto.ReplicaSetMetadataDTO{
			Labels:      rs.Spec.Template.Labels,
			Annotations: rs.Spec.Template.Annotations,
		},
	}

	linked := dto.ReplicaSetPodsSummaryDTO{
		Total: int32(len(pods)),
		Ready: readyPods,
	}

	return &dto.ReplicaSetDetailsDTO{
		Summary:    summary,
		Conditions: conditions,
		Pods:       pods,
		Spec:       spec,
		LinkedPods: linked,
		YAML:       string(y),
	}, nil
}

func listReplicaSetPods(ctx context.Context, c *cluster.Clients, rs *appsv1.ReplicaSet, selector string) ([]dto.ReplicaSetPodDTO, int32, error) {
	listOpts := metav1.ListOptions{}
	if selector != "" {
		listOpts.LabelSelector = selector
	}
	pods, err := c.Clientset.CoreV1().Pods(rs.Namespace).List(ctx, listOpts)
	if err != nil {
		return nil, 0, err
	}

	now := time.Now()
	out := make([]dto.ReplicaSetPodDTO, 0, len(pods.Items))
	var readyPods int32
	for _, p := range pods.Items {
		if !kubepods.IsPodOwnedBy(&p, "ReplicaSet", rs.UID, rs.Name) {
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
		if svcs.IsPodReady(&p) {
			readyPods++
		}
		age := int64(0)
		if !p.CreationTimestamp.IsZero() {
			age = int64(now.Sub(p.CreationTimestamp.Time).Seconds())
		}
		out = append(out, dto.ReplicaSetPodDTO{
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
	return out, readyPods, nil
}
