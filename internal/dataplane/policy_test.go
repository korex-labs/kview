package dataplane

import (
	"sync"
	"testing"
)

func TestValidateDataplanePolicyDoesNotMutateInputMaps(t *testing.T) {
	in := DataplanePolicy{
		Profile: DataplaneProfileFocused,
		Snapshots: SnapshotPolicy{
			TTLSeconds: map[string]int{
				string(ResourceKindPods): 30,
			},
		},
		NamespaceEnrichment: NamespaceEnrichmentPolicy{
			WarmResourceKinds: []string{string(ResourceKindPods)},
		},
	}

	got := ValidateDataplanePolicy(in)

	if _, ok := in.Snapshots.TTLSeconds[string(ResourceKindNamespaces)]; ok {
		t.Fatalf("ValidateDataplanePolicy mutated input TTL map: %#v", in.Snapshots.TTLSeconds)
	}
	got.Snapshots.TTLSeconds[string(ResourceKindPods)] = 99
	got.NamespaceEnrichment.WarmResourceKinds[0] = string(ResourceKindDeployments)
	if in.Snapshots.TTLSeconds[string(ResourceKindPods)] != 30 {
		t.Fatalf("validated TTL map aliases input map: %#v", in.Snapshots.TTLSeconds)
	}
	if in.NamespaceEnrichment.WarmResourceKinds[0] != string(ResourceKindPods) {
		t.Fatalf("validated warm resource kinds aliases input slice: %#v", in.NamespaceEnrichment.WarmResourceKinds)
	}
}

func TestManagerPolicyReturnsIsolatedCopy(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	m := dm.(*manager)

	policy := m.Policy()
	policy.Snapshots.TTLSeconds[string(ResourceKindPods)] = 999
	policy.NamespaceEnrichment.WarmResourceKinds[0] = string(ResourceKindServices)

	got := m.Policy()
	if got.Snapshots.TTLSeconds[string(ResourceKindPods)] == 999 {
		t.Fatalf("Policy returned map that aliases manager state: %#v", got.Snapshots.TTLSeconds)
	}
	if got.NamespaceEnrichment.WarmResourceKinds[0] == string(ResourceKindServices) {
		t.Fatalf("Policy returned slice that aliases manager state: %#v", got.NamespaceEnrichment.WarmResourceKinds)
	}
}

func TestManagerPolicyConcurrentAccess(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	m := dm.(*manager)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				policy := m.Policy()
				policy.Snapshots.TTLSeconds[string(ResourceKindPods)] = 5 + ((i + j) % 120)
				policy.NamespaceEnrichment.WarmResourceKinds = append(policy.NamespaceEnrichment.WarmResourceKinds, string(ResourceKindDeployments))
				m.SetPolicy(policy)
			}
		}(i)
	}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				policy := m.Policy()
				_ = policy.SnapshotTTL(ResourceKindPods)
			}
		}()
	}
	wg.Wait()
}

func TestPolicyBundleInheritanceAndContextMetricsDisable(t *testing.T) {
	disabled := false
	bundle := ValidateDataplanePolicyBundle(DataplanePolicyBundle{
		Global: DefaultDataplanePolicy(),
		ContextOverrides: map[string]DataplanePolicyOverride{
			"dev": {
				Metrics: &MetricsPolicyOverride{
					Enabled: &disabled,
				},
			},
		},
	})
	dev := bundle.EffectivePolicy("dev")
	prod := bundle.EffectivePolicy("prod")
	if dev.Metrics.Enabled {
		t.Fatalf("expected metrics disabled in dev override")
	}
	if !prod.Metrics.Enabled {
		t.Fatalf("expected metrics enabled for inherited context")
	}
}

func TestPolicyBundleOverrideClearingByNilTTL(t *testing.T) {
	v := 17
	bundle := ValidateDataplanePolicyBundle(DataplanePolicyBundle{
		Global: DefaultDataplanePolicy(),
		ContextOverrides: map[string]DataplanePolicyOverride{
			"ctx": {
				Snapshots: &SnapshotPolicyOverride{
					TTLSeconds: map[string]*int{
						string(ResourceKindPods): &v,
					},
				},
			},
		},
	})
	override := bundle.EffectivePolicy("ctx")
	if got := override.Snapshots.TTLSeconds[string(ResourceKindPods)]; got != 17 {
		t.Fatalf("expected overridden pod TTL=17, got %d", got)
	}
	bundle.ContextOverrides["ctx"] = DataplanePolicyOverride{
		Snapshots: &SnapshotPolicyOverride{
			TTLSeconds: map[string]*int{
				string(ResourceKindPods): nil,
			},
		},
	}
	cleared := ValidateDataplanePolicyBundle(bundle).EffectivePolicy("ctx")
	if got := cleared.Snapshots.TTLSeconds[string(ResourceKindPods)]; got == 17 {
		t.Fatalf("expected cleared override to inherit global pod TTL, got %d", got)
	}
}

func TestPolicyBundleManualProfileDisablesObserversAndEnrichment(t *testing.T) {
	profile := DataplaneProfileManual
	bundle := ValidateDataplanePolicyBundle(DataplanePolicyBundle{
		Global: DefaultDataplanePolicy(),
		ContextOverrides: map[string]DataplanePolicyOverride{
			"manual-ctx": {
				Profile: &profile,
			},
		},
	})
	got := bundle.EffectivePolicy("manual-ctx")
	if got.Profile != DataplaneProfileManual {
		t.Fatalf("expected manual profile, got %q", got.Profile)
	}
	if got.Observers.Enabled {
		t.Fatalf("expected observers disabled for manual profile")
	}
	if got.NamespaceEnrichment.Enabled {
		t.Fatalf("expected namespace enrichment disabled for manual profile")
	}
	if got.NamespaceEnrichment.Sweep.Enabled {
		t.Fatalf("expected namespace sweep disabled for manual profile")
	}
}

func TestValidateDataplanePolicy_MigratesLegacyThresholdsToSignalDetectors(t *testing.T) {
	in := DefaultDataplanePolicy()
	in.Dashboard.RestartElevatedThreshold = 7
	in.Metrics.ContainerNearLimitPct = 91
	in.Metrics.NodePressurePct = 89
	in.Signals.QuotaWarnPercent = 77
	in.Signals.QuotaCriticalPercent = 93
	in.Signals.Detectors = SignalDetectorsPolicy{}

	got := ValidateDataplanePolicy(in)
	if got.Signals.Detectors.PodRestarts.RestartCount != 7 {
		t.Fatalf("expected restart detector threshold 7, got %d", got.Signals.Detectors.PodRestarts.RestartCount)
	}
	if got.Signals.Detectors.ContainerNearLimit.Percent != 91 {
		t.Fatalf("expected container_near_limit threshold 91, got %d", got.Signals.Detectors.ContainerNearLimit.Percent)
	}
	if got.Signals.Detectors.NodeResourcePressure.Percent != 89 {
		t.Fatalf("expected node_resource_pressure threshold 89, got %d", got.Signals.Detectors.NodeResourcePressure.Percent)
	}
	if got.Signals.Detectors.ResourceQuotaPressure.WarnPercent != 77 || got.Signals.Detectors.ResourceQuotaPressure.CriticalPercent != 93 {
		t.Fatalf("expected quota detector thresholds 77/93, got %+v", got.Signals.Detectors.ResourceQuotaPressure)
	}
}

func TestValidateDataplanePolicy_PrefersDetectorThresholdsOverLegacyFields(t *testing.T) {
	in := DefaultDataplanePolicy()
	in.Dashboard.RestartElevatedThreshold = 4
	in.Metrics.ContainerNearLimitPct = 80
	in.Metrics.NodePressurePct = 80
	in.Signals.QuotaWarnPercent = 60
	in.Signals.QuotaCriticalPercent = 70
	in.Signals.Detectors.PodRestarts.RestartCount = 9
	in.Signals.Detectors.ContainerNearLimit.Percent = 96
	in.Signals.Detectors.NodeResourcePressure.Percent = 94
	in.Signals.Detectors.ResourceQuotaPressure.WarnPercent = 88
	in.Signals.Detectors.ResourceQuotaPressure.CriticalPercent = 97

	got := ValidateDataplanePolicy(in)
	if got.Signals.Detectors.PodRestarts.RestartCount != 9 ||
		got.Signals.Detectors.ContainerNearLimit.Percent != 96 ||
		got.Signals.Detectors.NodeResourcePressure.Percent != 94 ||
		got.Signals.Detectors.ResourceQuotaPressure.WarnPercent != 88 ||
		got.Signals.Detectors.ResourceQuotaPressure.CriticalPercent != 97 {
		t.Fatalf("expected detector thresholds to win, got %+v", got.Signals.Detectors)
	}
	// Legacy fields are mirrored from detector config for compatibility.
	if got.Dashboard.RestartElevatedThreshold != 9 ||
		got.Metrics.ContainerNearLimitPct != 96 ||
		got.Metrics.NodePressurePct != 94 ||
		got.Signals.QuotaWarnPercent != 88 ||
		got.Signals.QuotaCriticalPercent != 97 {
		t.Fatalf("expected legacy mirrors to match detector config, got dashboard=%d metrics=%d/%d quota=%d/%d",
			got.Dashboard.RestartElevatedThreshold,
			got.Metrics.ContainerNearLimitPct,
			got.Metrics.NodePressurePct,
			got.Signals.QuotaWarnPercent,
			got.Signals.QuotaCriticalPercent,
		)
	}
}
