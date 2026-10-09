package jobs

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
)

func TestMapJobsSuccessfulTerminalRequiresObservedCondition(t *testing.T) {
	one := int32(1)
	for _, tc := range []struct {
		name   string
		status batchv1.JobStatus
		want   bool
	}{
		{name: "inferred completion is not terminal", status: batchv1.JobStatus{Succeeded: 1}},
		{name: "inactive is not terminal"},
		{name: "failed is not terminal", status: batchv1.JobStatus{Failed: 1}},
		{name: "complete false", status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{{Type: batchv1.JobComplete, Status: corev1.ConditionFalse}}}},
		{name: "complete unknown", status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{{Type: batchv1.JobComplete, Status: corev1.ConditionUnknown}}}},
		{name: "observed complete", status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{{Type: batchv1.JobComplete, Status: corev1.ConditionTrue}}}, want: true},
		{name: "conflicting failed condition", status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{{Type: batchv1.JobComplete, Status: corev1.ConditionTrue}, {Type: batchv1.JobFailed, Status: corev1.ConditionTrue}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := MapJobs([]batchv1.Job{{Spec: batchv1.JobSpec{Completions: &one}, Status: tc.status}}, time.Unix(100, 0))
			if len(result) != 1 || result[0].SuccessfulTerminal != tc.want {
				t.Fatalf("result=%+v", result)
			}
			data, err := json.Marshal(result[0])
			if err != nil {
				t.Fatal(err)
			}
			var restored dto.JobDTO
			if err := json.Unmarshal(data, &restored); err != nil {
				t.Fatal(err)
			}
			if restored.SuccessfulTerminal != tc.want {
				t.Fatalf("persistence lost terminal evidence: %s", data)
			}
		})
	}
	var legacy dto.JobDTO
	if err := json.Unmarshal([]byte(`{"name":"legacy","status":"Complete"}`), &legacy); err != nil || legacy.SuccessfulTerminal {
		t.Fatalf("legacy must fail open: %+v %v", legacy, err)
	}
}
