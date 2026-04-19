package jobs

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
	kubepods "github.com/korex-labs/kview/internal/kube/resource/pods"
	svcs "github.com/korex-labs/kview/internal/kube/resource/services"
)

func GetJobDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.JobDetailsDTO, error) {
	job, err := c.Clientset.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	jobCopy := job.DeepCopy()
	jobCopy.ManagedFields = nil
	b, err := json.Marshal(jobCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	if !job.CreationTimestamp.IsZero() {
		age = int64(now.Sub(job.CreationTimestamp.Time).Seconds())
	}

	selector := jobSelector(job)

	startTime := TimeFrom(job.Status.StartTime)
	completionTime := TimeFrom(job.Status.CompletionTime)
	durationSec := JobDurationSec(job)

	summary := dto.JobSummaryDTO{
		Name:           job.Name,
		Namespace:      job.Namespace,
		Owner:          mapJobOwner(job.OwnerReferences),
		Status:         JobStatus(job),
		Active:         job.Status.Active,
		Succeeded:      job.Status.Succeeded,
		Failed:         job.Status.Failed,
		Completions:    job.Spec.Completions,
		Parallelism:    job.Spec.Parallelism,
		BackoffLimit:   job.Spec.BackoffLimit,
		StartTime:      startTime,
		CompletionTime: completionTime,
		DurationSec:    durationSec,
		AgeSec:         age,
	}

	conditions := make([]dto.JobConditionDTO, 0, len(job.Status.Conditions))
	for _, cond := range job.Status.Conditions {
		lt := int64(0)
		if !cond.LastTransitionTime.IsZero() {
			lt = cond.LastTransitionTime.Unix()
		}
		conditions = append(conditions, dto.JobConditionDTO{
			Type:               string(cond.Type),
			Status:             string(cond.Status),
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: lt,
		})
	}

	pods, readyPods, err := listJobPods(ctx, c, job, selector)
	if err != nil {
		return nil, err
	}

	linked := dto.JobPodsSummaryDTO{
		Total: int32(len(pods)),
		Ready: readyPods,
	}

	metadata := dto.JobMetadataDTO{
		Labels:      job.Labels,
		Annotations: job.Annotations,
	}

	return &dto.JobDetailsDTO{
		Summary:    summary,
		Conditions: conditions,
		Pods:       pods,
		LinkedPods: linked,
		Metadata:   metadata,
		Selector:   selector,
		YAML:       string(y),
	}, nil
}

func jobSelector(job *batchv1.Job) string {
	if job.Spec.Selector != nil {
		if sel, err := metav1.LabelSelectorAsSelector(job.Spec.Selector); err == nil {
			return sel.String()
		}
	}
	if len(job.Spec.Template.Labels) > 0 {
		return labels.Set(job.Spec.Template.Labels).String()
	}
	return ""
}

func listJobPods(ctx context.Context, c *cluster.Clients, job *batchv1.Job, selector string) ([]dto.JobPodDTO, int32, error) {
	listOpts := metav1.ListOptions{}
	if selector != "" {
		listOpts.LabelSelector = selector
	}
	pods, err := c.Clientset.CoreV1().Pods(job.Namespace).List(ctx, listOpts)
	if err != nil {
		return nil, 0, err
	}

	now := time.Now()
	out := make([]dto.JobPodDTO, 0, len(pods.Items))
	var readyPods int32
	for _, p := range pods.Items {
		if !isPodOwnedByJobRef(&p, job) {
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

		out = append(out, dto.JobPodDTO{
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

func isPodOwnedByJobRef(pod *corev1.Pod, job *batchv1.Job) bool {
	for _, ref := range pod.OwnerReferences {
		if ref.Kind != "Job" {
			continue
		}
		if ref.UID == job.UID || ref.Name == job.Name {
			return true
		}
	}
	return false
}

func mapJobOwner(refs []metav1.OwnerReference) *dto.OwnerReferenceDTO {
	for _, ref := range refs {
		if ref.Kind == "CronJob" && (ref.Controller == nil || *ref.Controller) && ref.Name != "" {
			return &dto.OwnerReferenceDTO{
				Kind: ref.Kind,
				Name: ref.Name,
			}
		}
	}
	return nil
}
