package actions

import (
	"strings"
	"testing"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func makeSourceJob(name string, labels, templateLabels map[string]string) *batchv1.Job {
	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "default",
			Labels:    labels,
		},
		Spec: batchv1.JobSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: templateLabels},
			},
		},
	}
}

func TestNewJobFromJob_SelectorCleared(t *testing.T) {
	sel := metav1.LabelSelector{MatchLabels: map[string]string{"job-name": "my-job"}}
	manual := true
	source := makeSourceJob("my-job", nil, nil)
	source.Spec.Selector = &sel
	source.Spec.ManualSelector = &manual

	job := newJobFromJob(source, "")

	if job.Spec.Selector != nil {
		t.Fatal("Selector should be cleared")
	}
	if job.Spec.ManualSelector != nil {
		t.Fatal("ManualSelector should be cleared")
	}
}

func TestNewJobFromJob_ControllerLabelsStripped(t *testing.T) {
	source := makeSourceJob("my-job", nil, map[string]string{
		"app":                                "worker",
		"controller-uid":                     "abc",
		"batch.kubernetes.io/controller-uid": "abc",
		"job-name":                           "my-job",
		"batch.kubernetes.io/job-name":       "my-job",
	})

	job := newJobFromJob(source, "")

	for _, key := range []string{
		"controller-uid",
		"batch.kubernetes.io/controller-uid",
		"job-name",
		"batch.kubernetes.io/job-name",
	} {
		if _, ok := job.Spec.Template.Labels[key]; ok {
			t.Fatalf("template label %q should be removed", key)
		}
	}
	if job.Spec.Template.Labels["app"] != "worker" {
		t.Fatal("unrelated template label should be preserved")
	}
}

func TestNewJobFromJob_KviewLabels(t *testing.T) {
	source := makeSourceJob("my-job", nil, nil)

	job := newJobFromJob(source, "")

	if job.Labels["kview.korex-labs.io/manual-run"] != "true" {
		t.Fatal("expected manual-run=true label")
	}
	if job.Labels["kview.korex-labs.io/source-kind"] != "job" {
		t.Fatalf("source-kind: got %q, want job", job.Labels["kview.korex-labs.io/source-kind"])
	}
	if job.Labels["kview.korex-labs.io/source-name"] != "my-job" {
		t.Fatalf("source-name: got %q, want my-job", job.Labels["kview.korex-labs.io/source-name"])
	}
	if job.Annotations["kview.korex-labs.io/created-at"] == "" {
		t.Fatal("expected created-at annotation")
	}
}

func TestNewJobFromJob_RunIDSet(t *testing.T) {
	source := makeSourceJob("my-job", nil, nil)

	job := newJobFromJob(source, "run-xyz")

	if job.Labels["kview.korex-labs.io/run-id"] != "run-xyz" {
		t.Fatalf("run-id label: got %q, want run-xyz", job.Labels["kview.korex-labs.io/run-id"])
	}
	if job.Annotations["kview.korex-labs.io/run-id"] != "run-xyz" {
		t.Fatalf("run-id annotation: got %q, want run-xyz", job.Annotations["kview.korex-labs.io/run-id"])
	}
	if job.Spec.Template.Labels["kview.korex-labs.io/run-id"] != "run-xyz" {
		t.Fatalf("template run-id: got %q, want run-xyz", job.Spec.Template.Labels["kview.korex-labs.io/run-id"])
	}
}

func TestNewJobFromJob_RunIDEmpty(t *testing.T) {
	source := makeSourceJob("my-job", nil, nil)

	job := newJobFromJob(source, "")

	if _, ok := job.Labels["kview.korex-labs.io/run-id"]; ok {
		t.Fatal("run-id label should not be set when runID is empty")
	}
}

func TestNewJobFromJob_GenerateName(t *testing.T) {
	source := makeSourceJob("my-job", nil, nil)
	job := newJobFromJob(source, "")
	if !strings.HasPrefix(job.GenerateName, "my-job-rerun-") {
		t.Fatalf("GenerateName: got %q, want prefix my-job-rerun-", job.GenerateName)
	}
}

func TestNewJobFromCronJob_KviewLabels(t *testing.T) {
	source := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: "nightly", Namespace: "default"},
		Spec: batchv1.CronJobSpec{
			JobTemplate: batchv1.JobTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "cron"}},
				Spec: batchv1.JobSpec{
					Template: corev1.PodTemplateSpec{
						ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "cron"}},
					},
				},
			},
		},
	}

	job := newJobFromCronJob(source, "")

	if job.Labels["kview.korex-labs.io/source-kind"] != "cronjob" {
		t.Fatalf("source-kind: got %q, want cronjob", job.Labels["kview.korex-labs.io/source-kind"])
	}
	if job.Labels["kview.korex-labs.io/source-name"] != "nightly" {
		t.Fatalf("source-name: got %q, want nightly", job.Labels["kview.korex-labs.io/source-name"])
	}
	if !strings.HasPrefix(job.GenerateName, "nightly-manual-") {
		t.Fatalf("GenerateName: got %q, want prefix nightly-manual-", job.GenerateName)
	}
}

func TestNewJobFromCronJob_SelectorCleared(t *testing.T) {
	source := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: "nightly", Namespace: "default"},
		Spec: batchv1.CronJobSpec{
			JobTemplate: batchv1.JobTemplateSpec{
				Spec: batchv1.JobSpec{
					Template: corev1.PodTemplateSpec{
						ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{
							"job-name":       "nightly-abc",
							"controller-uid": "uid123",
						}},
					},
				},
			},
		},
	}

	job := newJobFromCronJob(source, "")

	if job.Spec.Selector != nil {
		t.Fatal("Selector should be nil")
	}
	for _, key := range []string{"job-name", "controller-uid"} {
		if _, ok := job.Spec.Template.Labels[key]; ok {
			t.Fatalf("template label %q should be stripped", key)
		}
	}
}

var cleanGenerateNameCases = []struct {
	in   string
	want string
}{
	{"my-job", "my-job-"},
	{"My_Job!", "my-job-"},
	{"UPPER", "upper-"},
	{"a--b", "a-b-"},
	{"123", "123-"},
	{"", "job-"},
	{strings.Repeat("a", 60), strings.Repeat("a", 50) + "-"},
}

func TestCleanGenerateName(t *testing.T) {
	for _, tc := range cleanGenerateNameCases {
		got := cleanGenerateName(tc.in)
		if got != tc.want {
			t.Errorf("cleanGenerateName(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
