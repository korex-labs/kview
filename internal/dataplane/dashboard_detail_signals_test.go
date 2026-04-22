package dataplane

import (
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
)

func TestDetectPodDetailSignals_YoungFrequentRestarts(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	tests := []struct {
		name    string
		details dto.PodDetailsDTO
		wantSig bool
		wantSev string
	}{
		{
			name: "young pod with 6 total restarts raises signal",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", AgeSec: int64(5 * 60)},
				Containers: []dto.PodContainerDTO{
					{Name: "app", RestartCount: 6, LastTerminationReason: "Error"},
				},
			},
			wantSig: true,
			wantSev: "high",
		},
		{
			name: "young pod with 4 total restarts stays silent",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", AgeSec: int64(5 * 60)},
				Containers: []dto.PodContainerDTO{
					{Name: "app", RestartCount: 4},
				},
			},
			wantSig: false,
		},
		{
			name: "older pod with 6 restarts is left to the list-level signal",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", AgeSec: int64((3 * time.Hour).Seconds())},
				Containers: []dto.PodContainerDTO{
					{Name: "app", RestartCount: 6},
				},
			},
			wantSig: false,
		},
		{
			name: "young pod with restarts split across multiple containers aggregates",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", AgeSec: int64(10 * 60)},
				Containers: []dto.PodContainerDTO{
					{Name: "app", RestartCount: 3},
					{Name: "side", RestartCount: 3},
				},
			},
			wantSig: true,
			wantSev: "high",
		},
		{
			name: "pod without containers produces no signal",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", AgeSec: int64(5 * 60)},
			},
			wantSig: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			got := DetectPodDetailSignals(now, "team-a", tt.details, nil)
			var got1 *ClusterDashboardSignal
			for i := range got {
				if got[i].SignalType == "pod_young_frequent_restarts" {
					got1 = &got[i]
					break
				}
			}
			if tt.wantSig && got1 == nil {
				t.Fatalf("expected pod_young_frequent_restarts signal, got none (all: %+v)", got)
			}
			if !tt.wantSig && got1 != nil {
				t.Fatalf("did not expect pod_young_frequent_restarts signal, got %+v", got1)
			}
			if got1 != nil {
				if got1.Severity != tt.wantSev {
					t.Fatalf("severity: want %q, got %q", tt.wantSev, got1.Severity)
				}
				if got1.ResourceKind != "Pod" || got1.ResourceName != "api-0" {
					t.Fatalf("identity mismatch: %+v", got1)
				}
				if got1.LikelyCause == "" || got1.SuggestedAction == "" {
					t.Fatalf("expected registry-provided advice, got %+v", got1)
				}
			}
		})
	}
}

func TestDetectPodDetailSignals_SucceededWithIssues(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	tests := []struct {
		name    string
		details dto.PodDetailsDTO
		events  []dto.EventDTO
		wantSig bool
	}{
		{
			name: "succeeded with warning events triggers confusion hint",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "job-1", Phase: "Succeeded"},
			},
			events:  []dto.EventDTO{{Type: "Warning", Reason: "BackOff"}},
			wantSig: true,
		},
		{
			name: "succeeded with pod completed condition stays quiet",
			details: dto.PodDetailsDTO{
				Summary:    dto.PodSummaryDTO{Name: "job-1", Phase: "Succeeded"},
				Conditions: []dto.PodConditionDTO{{Type: "Ready", Status: "False", Reason: "PodCompleted"}},
			},
			wantSig: false,
		},
		{
			name: "succeeded with non-completion unhealthy condition triggers hint",
			details: dto.PodDetailsDTO{
				Summary:    dto.PodSummaryDTO{Name: "job-1", Phase: "Succeeded"},
				Conditions: []dto.PodConditionDTO{{Type: "Ready", Status: "False", Reason: "ContainersNotReady"}},
			},
			wantSig: true,
		},
		{
			name: "succeeded with waiting container (with reason) triggers hint",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "job-1", Phase: "Succeeded"},
				Containers: []dto.PodContainerDTO{
					{Name: "init", State: "Waiting", Reason: "CrashLoopBackOff"},
				},
			},
			wantSig: true,
		},
		{
			name: "succeeded and clean produces no signal",
			details: dto.PodDetailsDTO{
				Summary:    dto.PodSummaryDTO{Name: "job-1", Phase: "Succeeded"},
				Conditions: []dto.PodConditionDTO{{Type: "Ready", Status: "True"}},
			},
			wantSig: false,
		},
		{
			name: "non-succeeded phase produces no hint",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "job-1", Phase: "Running"},
			},
			events:  []dto.EventDTO{{Type: "Warning", Reason: "BackOff"}},
			wantSig: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			got := DetectPodDetailSignals(now, "team-a", tt.details, tt.events)
			var hit *ClusterDashboardSignal
			for i := range got {
				if got[i].SignalType == "pod_succeeded_with_issues" {
					hit = &got[i]
					break
				}
			}
			if tt.wantSig && hit == nil {
				t.Fatalf("expected pod_succeeded_with_issues, got none (all: %+v)", got)
			}
			if !tt.wantSig && hit != nil {
				t.Fatalf("did not expect pod_succeeded_with_issues, got %+v", hit)
			}
			if hit != nil && hit.Severity != "low" {
				t.Fatalf("expected low severity confusion hint, got %+v", hit)
			}
		})
	}
}

func TestDetectPodDetailSignals_MissingSecretReference(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	tests := []struct {
		name       string
		details    dto.PodDetailsDTO
		events     []dto.EventDTO
		wantSig    bool
		wantActual string
	}{
		{
			name: "secret volume missing event raises signal",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", Phase: "Pending"},
				Resources: dto.PodResourcesDTO{
					Volumes: []dto.VolumeDTO{{Name: "credentials", Type: "Secret", Source: "api-secret"}},
				},
			},
			events: []dto.EventDTO{{
				Type:    "Warning",
				Reason:  "FailedMount",
				Message: `MountVolume.SetUp failed for volume "credentials": secret "api-secret" not found`,
			}},
			wantSig:    true,
			wantActual: "api-secret",
		},
		{
			name: "image pull secret retrieval event raises signal",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", Phase: "Pending"},
				Resources: dto.PodResourcesDTO{
					ImagePullSecrets: []string{"registry-cred"},
				},
			},
			events: []dto.EventDTO{{
				Type:    "Warning",
				Reason:  "FailedToRetrieveImagePullSecret",
				Message: `Unable to retrieve some image pull secrets (registry-cred); attempting to pull the image may not succeed.`,
			}},
			wantSig:    true,
			wantActual: "registry-cred",
		},
		{
			name: "secret env var missing event raises signal",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", Phase: "Pending"},
				Containers: []dto.PodContainerDTO{{
					Name: "app",
					Env:  []dto.EnvVarDTO{{Name: "TOKEN", Source: "Secret", SourceRef: "env-secret:token"}},
				}},
			},
			events: []dto.EventDTO{{
				Type:    "Warning",
				Reason:  "CreateContainerConfigError",
				Message: `Error: secret "env-secret" not found`,
			}},
			wantSig:    true,
			wantActual: "env-secret",
		},
		{
			name: "event for unreferenced secret stays silent",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", Phase: "Pending"},
				Resources: dto.PodResourcesDTO{
					Volumes: []dto.VolumeDTO{{Name: "credentials", Type: "Secret", Source: "api-secret"}},
				},
			},
			events: []dto.EventDTO{{
				Type:    "Warning",
				Reason:  "FailedMount",
				Message: `secret "other-secret" not found`,
			}},
			wantSig: false,
		},
		{
			name: "normal warning without missing language stays silent",
			details: dto.PodDetailsDTO{
				Summary: dto.PodSummaryDTO{Name: "api-0", Phase: "Pending"},
				Resources: dto.PodResourcesDTO{
					ImagePullSecrets: []string{"registry-cred"},
				},
			},
			events: []dto.EventDTO{{
				Type:    "Warning",
				Reason:  "BackOff",
				Message: `Back-off pulling image while using secret registry-cred`,
			}},
			wantSig: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			got := DetectPodDetailSignals(now, "team-a", tt.details, tt.events)
			var hit *ClusterDashboardSignal
			for i := range got {
				if got[i].SignalType == "pod_missing_secret_reference" {
					hit = &got[i]
					break
				}
			}
			if tt.wantSig && hit == nil {
				t.Fatalf("expected pod_missing_secret_reference, got none (all: %+v)", got)
			}
			if !tt.wantSig && hit != nil {
				t.Fatalf("did not expect pod_missing_secret_reference, got %+v", hit)
			}
			if hit != nil {
				if hit.Severity != "high" {
					t.Fatalf("expected high severity, got %+v", hit)
				}
				if hit.ActualData != tt.wantActual {
					t.Fatalf("actual data: want %q, got %q", tt.wantActual, hit.ActualData)
				}
				if hit.LikelyCause == "" || hit.SuggestedAction == "" {
					t.Fatalf("expected registry advice, got %+v", hit)
				}
			}
		})
	}
}

func TestDetectDeploymentDetailSignals_Unavailable(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	fresh := now.Add(-2 * time.Minute).Unix()
	stale := now.Add(-15 * time.Minute).Unix()

	tests := []struct {
		name    string
		details dto.DeploymentDetailsDTO
		wantSig bool
		wantSev string
	}{
		{
			name: "available=false for 15m raises high-severity signal",
			details: dto.DeploymentDetailsDTO{
				Summary: dto.DeploymentSummaryDTO{Name: "web", Desired: 3, Available: 0, AgeSec: 3600},
				Conditions: []dto.DeploymentConditionDTO{
					{Type: "Available", Status: "False", Reason: "MinimumReplicasUnavailable", LastTransitionTime: stale},
				},
			},
			wantSig: true,
			wantSev: "high",
		},
		{
			name: "available=false for only 2m stays silent",
			details: dto.DeploymentDetailsDTO{
				Summary: dto.DeploymentSummaryDTO{Name: "web", Desired: 3, Available: 0, AgeSec: 120},
				Conditions: []dto.DeploymentConditionDTO{
					{Type: "Available", Status: "False", LastTransitionTime: fresh},
				},
			},
			wantSig: false,
		},
		{
			name: "available=true suppresses signal even with zero available replicas logged",
			details: dto.DeploymentDetailsDTO{
				Summary: dto.DeploymentSummaryDTO{Name: "web", Desired: 3, Available: 3},
				Conditions: []dto.DeploymentConditionDTO{
					{Type: "Available", Status: "True", LastTransitionTime: stale},
				},
			},
			wantSig: false,
		},
		{
			name: "no available condition falls back to age-based best-effort (medium)",
			details: dto.DeploymentDetailsDTO{
				Summary: dto.DeploymentSummaryDTO{Name: "web", Desired: 3, Available: 0, AgeSec: int64((30 * time.Minute).Seconds())},
			},
			wantSig: true,
			wantSev: "medium",
		},
		{
			name: "no available condition and young deployment stays silent",
			details: dto.DeploymentDetailsDTO{
				Summary: dto.DeploymentSummaryDTO{Name: "web", Desired: 3, Available: 0, AgeSec: 60},
			},
			wantSig: false,
		},
		{
			name: "desired=0 deployment never signals",
			details: dto.DeploymentDetailsDTO{
				Summary: dto.DeploymentSummaryDTO{Name: "web", Desired: 0, Available: 0, AgeSec: 999999},
				Conditions: []dto.DeploymentConditionDTO{
					{Type: "Available", Status: "False", LastTransitionTime: stale},
				},
			},
			wantSig: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			got := DetectDeploymentDetailSignals(now, "team-a", tt.details)
			var hit *ClusterDashboardSignal
			for i := range got {
				if got[i].SignalType == "deployment_unavailable" {
					hit = &got[i]
					break
				}
			}
			if tt.wantSig && hit == nil {
				t.Fatalf("expected deployment_unavailable, got none (all: %+v)", got)
			}
			if !tt.wantSig && hit != nil {
				t.Fatalf("did not expect deployment_unavailable, got %+v", hit)
			}
			if hit == nil {
				return
			}
			if hit.Severity != tt.wantSev {
				t.Fatalf("severity: want %q, got %q", tt.wantSev, hit.Severity)
			}
			if hit.ResourceKind != "Deployment" || hit.ResourceName != "web" {
				t.Fatalf("identity mismatch: %+v", hit)
			}
			if hit.LikelyCause == "" || hit.SuggestedAction == "" {
				t.Fatalf("expected registry-provided advice, got %+v", hit)
			}
		})
	}
}

func TestDetectPodDetailSignals_EmptyPodIsSafe(t *testing.T) {
	// A zero-valued PodDetailsDTO (no name) must not produce any signal and
	// must not panic, since detectors may be invoked before the detail
	// response is populated.
	got := DetectPodDetailSignals(time.Unix(1, 0), "", dto.PodDetailsDTO{}, nil)
	if len(got) != 0 {
		t.Fatalf("expected no signals for empty pod, got %+v", got)
	}
}

func TestDetectDeploymentDetailSignals_EmptyDeploymentIsSafe(t *testing.T) {
	got := DetectDeploymentDetailSignals(time.Unix(1, 0), "", dto.DeploymentDetailsDTO{})
	if len(got) != 0 {
		t.Fatalf("expected no signals for empty deployment, got %+v", got)
	}
}

func TestDetectDeploymentDetailSignals_MissingTemplateReferences(t *testing.T) {
	got := DetectDeploymentDetailSignals(time.Unix(1, 0), "team-a", dto.DeploymentDetailsDTO{
		Summary: dto.DeploymentSummaryDTO{Name: "web", Namespace: "team-a", Desired: 1, Available: 1},
		Spec: dto.DeploymentSpecDTO{
			MissingReferences: []dto.DeploymentMissingReferenceDTO{
				{Kind: "Secret", Name: "registry-cred", Source: "imagePullSecret"},
				{Kind: "ConfigMap", Name: "app-config", Source: "volume/config"},
			},
		},
	})

	var hit *ClusterDashboardSignal
	for i := range got {
		if got[i].SignalType == "deployment_missing_template_reference" {
			hit = &got[i]
			break
		}
	}
	if hit == nil {
		t.Fatalf("expected deployment_missing_template_reference, got %+v", got)
	}
	if hit.ResourceKind != "Deployment" || hit.ResourceName != "web" || hit.Namespace != "team-a" {
		t.Fatalf("identity mismatch: %+v", hit)
	}
	if !strings.Contains(hit.ActualData, "secret/registry-cred") || !strings.Contains(hit.ActualData, "configmap/app-config") {
		t.Fatalf("actual data did not include missing refs: %+v", hit)
	}
}

func TestDashboardSignalDefinitionRegistry_NewDetailSignalsRegistered(t *testing.T) {
	cases := []struct {
		signalType     string
		wantLabel      string
		wantCalculated string
	}{
		{"pod_young_frequent_restarts", "Pods restarting frequently in short lifetime", "pod accumulated at least 5 restarts while age is 30 minutes or less"},
		{"pod_succeeded_with_issues", "Pods Succeeded with recorded issues", "phase Succeeded while conditions, container states, or Warning events indicate problems"},
		{"deployment_unavailable", "Deployments unavailable for extended time", "Available=False for more than 10 minutes, or no available replicas for a mature deployment"},
		{"deployment_missing_template_reference", "Deployments with missing template references", "deployment pod template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.signalType, func(t *testing.T) {
			def := dashboardSignalDefinitionForType(tc.signalType)
			if def.Type != tc.signalType {
				t.Fatalf("missing registry entry for %q: %+v", tc.signalType, def)
			}
			if def.Label != tc.wantLabel {
				t.Fatalf("%s label: want %q, got %q", tc.signalType, tc.wantLabel, def.Label)
			}
			if def.CalculatedData != tc.wantCalculated {
				t.Fatalf("%s calculated data mismatch: %+v", tc.signalType, def)
			}
			if def.LikelyCause == "" || def.SuggestedAction == "" {
				t.Fatalf("%s missing advice: %+v", tc.signalType, def)
			}
		})
	}
}
