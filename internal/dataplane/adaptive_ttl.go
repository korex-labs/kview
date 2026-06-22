package dataplane

import "time"

type SchedulerClusterPressureSnapshot struct {
	Cluster            string `json:"cluster"`
	Running            int    `json:"running"`
	Queued             int    `json:"queued"`
	LowPriorityQueued  int    `json:"lowPriorityQueued"`
	LongestQueueWaitMs int64  `json:"longestQueueWaitMs"`
	MaxSlots           int    `json:"maxSlots"`
}

func effectiveSnapshotTTL(base time.Duration, source string, priority WorkPriority, kind ResourceKind, health SchedulerHealthSnapshot, pressure SchedulerClusterPressureSnapshot) time.Duration {
	if base <= 0 {
		return base
	}
	if !sourceUsesAdaptiveTTL(source, priority) {
		return base
	}
	multiplier := 1
	switch health.BackgroundAdmission {
	case SchedulerBackgroundAdmissionPaused:
		multiplier = 4
	case SchedulerBackgroundAdmissionLimited:
		multiplier = 2
	}
	if pressure.Queued > 0 || (pressure.MaxSlots > 0 && pressure.Running >= pressure.MaxSlots) {
		multiplier++
	}
	if pressure.LowPriorityQueued > 0 || pressure.LongestQueueWaitMs >= 2000 {
		multiplier++
	}
	if schedulerKindIsExpensive(kind) && multiplier > 1 {
		multiplier++
	}
	if multiplier <= 1 {
		return base
	}
	if multiplier > 8 {
		multiplier = 8
	}
	return base * time.Duration(multiplier)
}

func sourceUsesAdaptiveTTL(source string, priority WorkPriority) bool {
	if priority >= WorkPriorityLow {
		return true
	}
	switch source {
	case WorkSourceObserver, WorkSourceEnrichment, WorkSourceAllContexts:
		return true
	default:
		return false
	}
}

func schedulerKindIsExpensive(kind ResourceKind) bool {
	switch kind {
	case ResourceKindClusterCustomResources,
		ResourceKindCustomResources,
		ResourceKindCRDs,
		ResourceKindConfigMaps,
		ResourceKindSecrets,
		ResourceKindClusterRoles,
		ResourceKindClusterRoleBindings,
		ResourceKindRoles,
		ResourceKindRoleBindings:
		return true
	default:
		return false
	}
}
