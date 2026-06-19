package dataplane

import "testing"

func TestDataplanePolicyForProfile_TunesAdaptiveBackground(t *testing.T) {
	focused := DataplanePolicyForProfile(DataplaneProfileFocused)
	if focused.NamespaceEnrichment.Sweep.Enabled {
		t.Fatalf("focused profile should keep sweep disabled")
	}
	if focused.NamespaceEnrichment.MaxParallel != 2 {
		t.Fatalf("focused max parallel = %d", focused.NamespaceEnrichment.MaxParallel)
	}

	balanced := DataplanePolicyForProfile(DataplaneProfileBalanced)
	if !balanced.NamespaceEnrichment.Sweep.Enabled {
		t.Fatalf("balanced profile should enable conservative idle sweep")
	}
	if balanced.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle != 1 || balanced.NamespaceEnrichment.Sweep.MaxNamespacesPerHour != 12 {
		t.Fatalf("balanced sweep too broad: %+v", balanced.NamespaceEnrichment.Sweep)
	}
	if balanced.BackgroundBudget.MaxBackgroundConcurrentPerCluster != 2 {
		t.Fatalf("balanced background concurrency = %d", balanced.BackgroundBudget.MaxBackgroundConcurrentPerCluster)
	}

	wide := DataplanePolicyForProfile(DataplaneProfileWide)
	if wide.NamespaceEnrichment.MaxTargets <= balanced.NamespaceEnrichment.MaxTargets {
		t.Fatalf("wide should cover more targets than balanced: wide=%d balanced=%d", wide.NamespaceEnrichment.MaxTargets, balanced.NamespaceEnrichment.MaxTargets)
	}
	if wide.BackgroundBudget.MaxBackgroundConcurrentPerCluster != 3 {
		t.Fatalf("wide background concurrency = %d", wide.BackgroundBudget.MaxBackgroundConcurrentPerCluster)
	}

	diagnostic := DataplanePolicyForProfile(DataplaneProfileDiagnostic)
	if !diagnostic.NamespaceEnrichment.Sweep.IncludeSystemNamespaces {
		t.Fatalf("diagnostic sweep should include system namespaces")
	}
	if diagnostic.BackgroundBudget.MaxBackgroundConcurrentPerCluster <= wide.BackgroundBudget.MaxBackgroundConcurrentPerCluster {
		t.Fatalf("diagnostic should allow more background work than wide: diagnostic=%d wide=%d", diagnostic.BackgroundBudget.MaxBackgroundConcurrentPerCluster, wide.BackgroundBudget.MaxBackgroundConcurrentPerCluster)
	}
}

func TestApplyDataplaneProfile_PreservesOperatorTunedSections(t *testing.T) {
	current := DefaultDataplanePolicy()
	current.Persistence.Enabled = false
	current.Persistence.MaxAgeHours = 12
	current.AllContextEnrichment.Enabled = true
	current.AllContextEnrichment.MaxContextsPerCycle = 2
	current.Metrics.Enabled = false
	current.Signals.Detectors.PodRestarts.RestartCount = 9

	next := ApplyDataplaneProfile(current, DataplaneProfileWide)
	if next.Profile != DataplaneProfileWide {
		t.Fatalf("profile = %s", next.Profile)
	}
	if next.Persistence.Enabled || next.Persistence.MaxAgeHours != 12 {
		t.Fatalf("persistence not preserved: %+v", next.Persistence)
	}
	if !next.AllContextEnrichment.Enabled || next.AllContextEnrichment.MaxContextsPerCycle != 2 {
		t.Fatalf("all-context settings not preserved: %+v", next.AllContextEnrichment)
	}
	if next.Metrics.Enabled {
		t.Fatalf("metrics setting not preserved: %+v", next.Metrics)
	}
	if next.Signals.Detectors.PodRestarts.RestartCount != 9 {
		t.Fatalf("signal settings not preserved: %+v", next.Signals.Detectors.PodRestarts)
	}
	if !next.NamespaceEnrichment.Sweep.Enabled || next.NamespaceEnrichment.MaxTargets != 80 {
		t.Fatalf("wide profile defaults not applied: %+v", next.NamespaceEnrichment)
	}
}

func TestDataplanePolicyBundle_ContextProfileAppliesProfileDefaults(t *testing.T) {
	global := DataplanePolicyForProfile(DataplaneProfileFocused)
	global.Persistence.MaxAgeHours = 24
	wide := DataplaneProfileWide
	bundle := DataplanePolicyBundle{
		Version: "v1",
		Global:  global,
		ContextOverrides: map[string]DataplanePolicyOverride{
			"prod": {Profile: &wide},
		},
	}

	effective := bundle.EffectivePolicy("prod")
	if effective.Profile != DataplaneProfileWide {
		t.Fatalf("profile = %s", effective.Profile)
	}
	if effective.NamespaceEnrichment.MaxTargets != 80 || !effective.NamespaceEnrichment.Sweep.Enabled {
		t.Fatalf("wide defaults not applied to context profile override: %+v", effective.NamespaceEnrichment)
	}
	if effective.Persistence.MaxAgeHours != 24 {
		t.Fatalf("global operator persistence should be preserved, got %+v", effective.Persistence)
	}
}
