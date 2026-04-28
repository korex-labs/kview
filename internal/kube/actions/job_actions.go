package actions

import (
	"context"
	"fmt"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleJobDelete deletes the job.
func HandleJobDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "batch", "jobs", "job",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.BatchV1().Jobs(ns).Delete(ctx, name, opts)
		},
	)
}

// BuildJobRerun returns a fresh Job from an existing Job's spec.
func BuildJobRerun(ctx context.Context, c *cluster.Clients, namespace, name, runID string) (*batchv1.Job, error) {
	source, err := c.Clientset.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return newJobFromJob(source, runID), nil
}

// BuildCronJobRun returns a one-off Job from a CronJob's job template.
func BuildCronJobRun(ctx context.Context, c *cluster.Clients, namespace, name, runID string) (*batchv1.Job, error) {
	source, err := c.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return newJobFromCronJob(source, runID), nil
}

// HandleJobRerun creates a fresh Job from an existing Job's spec.
func HandleJobRerun(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if err := validateNamespacedTarget(req, "batch", "jobs"); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	job, err := BuildJobRerun(ctx, c, req.Namespace, req.Name, "")
	if err != nil {
		return nil, err
	}

	created, err := c.Clientset.BatchV1().Jobs(req.Namespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		return nil, err
	}

	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Started job %s/%s", created.Namespace, created.Name),
		Details: map[string]any{
			"namespace": created.Namespace,
			"jobName":   created.Name,
			"source":    req.Name,
		},
	}, nil
}

func newJobFromJob(source *batchv1.Job, runID string) *batchv1.Job {
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: cleanGenerateName(source.Name + "-rerun-"),
			Namespace:    source.Namespace,
			Labels:       copyStringMap(source.Labels),
			Annotations:  copyStringMap(source.Annotations),
		},
		Spec: *source.Spec.DeepCopy(),
	}
	clearManualJobSelector(job)
	stampManualRun(job, "Job", source.Name, runID)
	return job
}

func newJobFromCronJob(source *batchv1.CronJob, runID string) *batchv1.Job {
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: cleanGenerateName(source.Name + "-manual-"),
			Namespace:    source.Namespace,
			Labels:       copyStringMap(source.Spec.JobTemplate.Labels),
			Annotations:  copyStringMap(source.Spec.JobTemplate.Annotations),
		},
		Spec: *source.Spec.JobTemplate.Spec.DeepCopy(),
	}
	clearManualJobSelector(job)
	stampManualRun(job, "CronJob", source.Name, runID)
	return job
}

func clearManualJobSelector(job *batchv1.Job) {
	job.Spec.Selector = nil
	job.Spec.ManualSelector = nil
	job.Spec.Template.Labels = copyStringMap(job.Spec.Template.Labels)
	delete(job.Spec.Template.Labels, "controller-uid")
	delete(job.Spec.Template.Labels, "batch.kubernetes.io/controller-uid")
	delete(job.Spec.Template.Labels, "job-name")
	delete(job.Spec.Template.Labels, "batch.kubernetes.io/job-name")
}

func stampManualRun(job *batchv1.Job, sourceKind, sourceName, runID string) {
	if job.Labels == nil {
		job.Labels = map[string]string{}
	}
	if job.Annotations == nil {
		job.Annotations = map[string]string{}
	}
	job.Labels["kview.korex-labs.io/manual-run"] = "true"
	job.Labels["kview.korex-labs.io/source-kind"] = strings.ToLower(sourceKind)
	job.Labels["kview.korex-labs.io/source-name"] = sourceName
	job.Annotations["kview.korex-labs.io/source-kind"] = sourceKind
	job.Annotations["kview.korex-labs.io/source-name"] = sourceName
	job.Annotations["kview.korex-labs.io/created-at"] = time.Now().UTC().Format(time.RFC3339)
	if runID != "" {
		job.Labels["kview.korex-labs.io/run-id"] = runID
		job.Annotations["kview.korex-labs.io/run-id"] = runID
	}
	if job.Spec.Template.Labels == nil {
		job.Spec.Template.Labels = map[string]string{}
	}
	job.Spec.Template.Labels["kview.korex-labs.io/manual-run"] = "true"
	if runID != "" {
		job.Spec.Template.Labels["kview.korex-labs.io/run-id"] = runID
	}
}

func cleanGenerateName(prefix string) string {
	prefix = strings.ToLower(prefix)
	var b strings.Builder
	lastDash := false
	for _, r := range prefix {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "job"
	}
	if len(out) > 50 {
		out = strings.TrimRight(out[:50], "-")
	}
	return out + "-"
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
