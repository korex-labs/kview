package jobs

import (
	"context"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func ListJobs(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.JobDTO, error) {
	jobs, err := c.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.JobDTO, 0, len(jobs.Items))
	for _, job := range jobs.Items {
		age := int64(0)
		if !job.CreationTimestamp.IsZero() {
			age = int64(now.Sub(job.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.JobDTO{
			Name:        job.Name,
			Namespace:   job.Namespace,
			Active:      job.Status.Active,
			Succeeded:   job.Status.Succeeded,
			Failed:      job.Status.Failed,
			DurationSec: JobDurationSec(&job),
			AgeSec:      age,
			Status:      JobStatus(&job),
		})
	}

	return out, nil
}

func JobStatus(job *batchv1.Job) string {
	if jobHasCondition(job, batchv1.JobFailed, corev1.ConditionTrue) || job.Status.Failed > 0 {
		return "Failed"
	}
	if jobHasCondition(job, batchv1.JobComplete, corev1.ConditionTrue) {
		return "Complete"
	}
	if job.Spec.Completions != nil && job.Status.Succeeded >= *job.Spec.Completions && job.Status.Succeeded > 0 {
		return "Complete"
	}
	if job.Status.Active > 0 {
		return "Running"
	}
	if job.Status.Succeeded > 0 && job.Status.Failed == 0 {
		return "Complete"
	}
	return "Unknown"
}

func jobHasCondition(job *batchv1.Job, condType batchv1.JobConditionType, status corev1.ConditionStatus) bool {
	for _, cond := range job.Status.Conditions {
		if cond.Type == condType && cond.Status == status {
			return true
		}
	}
	return false
}

func JobDurationSec(job *batchv1.Job) int64 {
	start := TimeFrom(job.Status.StartTime)
	complete := TimeFrom(job.Status.CompletionTime)
	if start > 0 && complete > 0 && complete >= start {
		return complete - start
	}
	return 0
}

func TimeFrom(t *metav1.Time) int64 {
	if t == nil || t.IsZero() {
		return 0
	}
	return t.Unix()
}
