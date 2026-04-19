package cronjobs

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
	deployments "github.com/korex-labs/kview/internal/kube/resource/deployments"
	jobs "github.com/korex-labs/kview/internal/kube/resource/jobs"
	pods "github.com/korex-labs/kview/internal/kube/resource/pods"
)

func GetCronJobDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.CronJobDetailsDTO, error) {
	cronJob, err := c.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	cronCopy := cronJob.DeepCopy()
	cronCopy.ManagedFields = nil
	b, err := json.Marshal(cronCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	if !cronJob.CreationTimestamp.IsZero() {
		age = int64(now.Sub(cronJob.CreationTimestamp.Time).Seconds())
	}

	suspend := false
	if cronJob.Spec.Suspend != nil {
		suspend = *cronJob.Spec.Suspend
	}

	timeZone := ""
	if cronJob.Spec.TimeZone != nil {
		timeZone = *cronJob.Spec.TimeZone
	}

	summary := dto.CronJobSummaryDTO{
		Name:               cronJob.Name,
		Namespace:          cronJob.Namespace,
		Schedule:           cronJob.Spec.Schedule,
		ScheduleHint:       cronScheduleHint(cronJob.Spec.Schedule),
		TimeZone:           timeZone,
		ConcurrencyPolicy:  string(cronJob.Spec.ConcurrencyPolicy),
		Suspend:            suspend,
		Active:             int32(len(cronJob.Status.Active)),
		LastScheduleTime:   jobs.TimeFrom(cronJob.Status.LastScheduleTime),
		LastSuccessfulTime: jobs.TimeFrom(cronJob.Status.LastSuccessfulTime),
		AgeSec:             age,
	}

	policy := dto.CronJobPolicyDTO{
		StartingDeadlineSeconds:    cronJob.Spec.StartingDeadlineSeconds,
		SuccessfulJobsHistoryLimit: cronJob.Spec.SuccessfulJobsHistoryLimit,
		FailedJobsHistoryLimit:     cronJob.Spec.FailedJobsHistoryLimit,
	}

	template := cronJob.Spec.JobTemplate.Spec.Template
	spec := dto.CronJobSpecDTO{
		JobTemplate: dto.PodTemplateSummaryDTO{
			Containers:       deployments.MapContainerSummaries(template.Spec.Containers),
			InitContainers:   deployments.MapContainerSummaries(template.Spec.InitContainers),
			ImagePullSecrets: pods.MapImagePullSecrets(template.Spec.ImagePullSecrets),
		},
		Scheduling: dto.CronJobSchedulingDTO{
			NodeSelector:              template.Spec.NodeSelector,
			AffinitySummary:           pods.SummarizeAffinity(template.Spec.Affinity),
			Tolerations:               pods.MapTolerations(template.Spec.Tolerations),
			TopologySpreadConstraints: pods.MapTopologySpread(template.Spec.TopologySpreadConstraints),
		},
		Volumes: pods.MapVolumes(template.Spec.Volumes),
		Metadata: dto.CronJobTemplateMetadataDTO{
			Labels:      template.Labels,
			Annotations: template.Annotations,
		},
	}

	metadata := dto.CronJobMetadataDTO{
		Labels:      cronJob.Labels,
		Annotations: cronJob.Annotations,
	}

	allJobs := []dto.CronJobJobDTO{}
	jobsForbidden := false

	jobList, err := c.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		if apierrors.IsForbidden(err) {
			jobsForbidden = true
		}
		// If forbidden or other error, leave allJobs empty
	} else {
		// Filter jobs owned by this CronJob using OwnerReferences first, then label fallback
		owned := filterOwnedJobs(jobList.Items, cronJob.Name)
		allJobs = mapAllJobs(owned, now)

		if len(allJobs) > 0 {
			summary.LastRunStatus = allJobs[0].Status
		}
	}

	return &dto.CronJobDetailsDTO{
		Summary:       summary,
		Policy:        policy,
		AllJobs:       allJobs,
		JobsForbidden: jobsForbidden,
		Spec:          spec,
		Metadata:      metadata,
		YAML:          string(y),
	}, nil
}

// filterOwnedJobs returns jobs owned by the named CronJob.
// Primary: OwnerReferences with kind=CronJob and matching name.
// Fallback: cronjob-name label.
func filterOwnedJobs(items []batchv1.Job, cronJobName string) []batchv1.Job {
	var owned []batchv1.Job
	seen := map[string]bool{}

	for i := range items {
		job := &items[i]
		for _, ref := range job.OwnerReferences {
			if ref.Kind == "CronJob" && ref.Name == cronJobName {
				owned = append(owned, *job)
				seen[job.Name] = true
				break
			}
		}
	}

	// Fallback: label match for jobs not already matched
	for i := range items {
		job := &items[i]
		if seen[job.Name] {
			continue
		}
		if job.Labels["cronjob-name"] == cronJobName {
			owned = append(owned, *job)
		}
	}

	return owned
}

// mapAllJobs converts all jobs to DTOs with full status info, sorted by start time descending.
func mapAllJobs(items []batchv1.Job, now time.Time) []dto.CronJobJobDTO {
	if len(items) == 0 {
		return nil
	}
	out := make([]dto.CronJobJobDTO, 0, len(items))
	for i := range items {
		job := &items[i]
		if job.Name == "" {
			continue
		}
		start := jobs.TimeFrom(job.Status.StartTime)
		if start == 0 && !job.CreationTimestamp.IsZero() {
			start = job.CreationTimestamp.Unix()
		}
		completion := jobs.TimeFrom(job.Status.CompletionTime)
		duration := jobs.JobDurationSec(job)
		ageSec := int64(0)
		if !job.CreationTimestamp.IsZero() {
			ageSec = int64(now.Sub(job.CreationTimestamp.Time).Seconds())
		}

		item := dto.CronJobJobDTO{
			Name:           job.Name,
			Status:         jobs.JobStatus(job),
			StartTime:      start,
			CompletionTime: completion,
			DurationSec:    duration,
			AgeSec:         ageSec,
		}
		out = append(out, item)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].StartTime == out[j].StartTime {
			return out[i].Name > out[j].Name
		}
		return out[i].StartTime > out[j].StartTime
	})
	return out
}

// cronScheduleHint returns a human-readable description for common cron schedule patterns.
func cronScheduleHint(schedule string) string {
	parts := strings.Fields(schedule)
	if len(parts) != 5 {
		return ""
	}
	minute, hour, dom, month, dow := parts[0], parts[1], parts[2], parts[3], parts[4]

	// Every N minutes: */N * * * *
	if strings.HasPrefix(minute, "*/") && hour == "*" && dom == "*" && month == "*" && dow == "*" {
		n := strings.TrimPrefix(minute, "*/")
		if _, err := strconv.Atoi(n); err == nil {
			return "Every " + n + " minutes"
		}
	}

	// Hourly: 0 * * * *
	if minute == "0" && hour == "*" && dom == "*" && month == "*" && dow == "*" {
		return "Hourly"
	}

	// Every N hours: 0 */N * * *
	if minute == "0" && strings.HasPrefix(hour, "*/") && dom == "*" && month == "*" && dow == "*" {
		n := strings.TrimPrefix(hour, "*/")
		if _, err := strconv.Atoi(n); err == nil {
			return "Every " + n + " hours"
		}
	}

	allStar := dom == "*" && month == "*"

	// Daily: 0 H * * *
	if dom == "*" && month == "*" && dow == "*" {
		if _, err := strconv.Atoi(minute); err == nil {
			if _, err2 := strconv.Atoi(hour); err2 == nil {
				return fmt.Sprintf("Daily at %s:%s", zeroPad(hour), zeroPad(minute))
			}
		}
	}

	// Weekly: 0 H * * D
	if allStar && dow != "*" {
		if _, err := strconv.Atoi(minute); err == nil {
			if _, err2 := strconv.Atoi(hour); err2 == nil {
				dayName := dowName(dow)
				return fmt.Sprintf("Weekly on %s at %s:%s", dayName, zeroPad(hour), zeroPad(minute))
			}
		}
	}

	// Monthly: M H D * *
	if month == "*" && dow == "*" && dom != "*" {
		if _, err := strconv.Atoi(minute); err == nil {
			if _, err2 := strconv.Atoi(hour); err2 == nil {
				if _, err3 := strconv.Atoi(dom); err3 == nil {
					return fmt.Sprintf("Monthly on the %s at %s:%s", ordinal(dom), zeroPad(hour), zeroPad(minute))
				}
			}
		}
	}

	return ""
}

func zeroPad(s string) string {
	if len(s) == 1 {
		return "0" + s
	}
	return s
}

func dowName(d string) string {
	switch d {
	case "0", "7":
		return "Sunday"
	case "1":
		return "Monday"
	case "2":
		return "Tuesday"
	case "3":
		return "Wednesday"
	case "4":
		return "Thursday"
	case "5":
		return "Friday"
	case "6":
		return "Saturday"
	default:
		return d
	}
}

func ordinal(s string) string {
	n, err := strconv.Atoi(s)
	if err != nil {
		return s
	}
	suffix := "th"
	if n%100 >= 11 && n%100 <= 13 {
		suffix = "th"
	} else {
		switch n % 10 {
		case 1:
			suffix = "st"
		case 2:
			suffix = "nd"
		case 3:
			suffix = "rd"
		}
	}
	return fmt.Sprintf("%d%s", n, suffix)
}
