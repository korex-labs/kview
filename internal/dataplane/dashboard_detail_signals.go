package dataplane

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
)

// Detail-level signal detectors operate on a single resource's detail DTO
// (e.g. PodDetailsDTO, DeploymentDetailsDTO) rather than on the cached
// namespace snapshot set used by the dashboard aggregator.
//
// They exist so that resource drawers can surface backend-derived signals
// that the UI previously computed client-side ("Pod is restarting frequently
// in N minutes", "Deployment has been unavailable for X minutes", etc.)
// without duplicating threshold/heuristic logic in the UI. See
// docs/UI_UX_GUIDE.md "Signals-first Drawer Content".
//
// These detectors return []ClusterDashboardSignal built via dashboardSignalItem
// so the resulting objects share the shape and metadata (LikelyCause,
// SuggestedAction, Scope, …) of the dashboard-aggregate signals and can be
// rendered by the same UI components.

// DetectPodDetailSignals returns per-resource signals derived from a pod's
// detail DTO plus its recent events. The caller provides `now` explicitly so
// tests can freeze time.
//
// The detectors here are deliberately conservative: they only emit signals
// when the detail view has enough information to support a specific, helpful
// message. List-level signals (e.g. chronic pod_restarts) are still produced
// by the namespace aggregator and combined with these by the per-resource
// signals endpoint.
func DetectPodDetailSignals(now time.Time, namespace string, details dto.PodDetailsDTO, events []dto.EventDTO) []ClusterDashboardSignal {
	var out []ClusterDashboardSignal
	if s := detectPodYoungFrequentRestartsSignal(namespace, details); s != nil {
		out = append(out, *s)
	}
	if s := detectPodSucceededWithIssuesSignal(namespace, details, events); s != nil {
		out = append(out, *s)
	}
	if s := detectPodMissingSecretReferenceSignal(namespace, details, events); s != nil {
		out = append(out, *s)
	}
	return out
}

// DetectDeploymentDetailSignals returns per-resource signals derived from a
// deployment's detail DTO. The caller provides `now` so tests can freeze time
// and so the detector can measure condition transition age deterministically.
func DetectDeploymentDetailSignals(now time.Time, namespace string, details dto.DeploymentDetailsDTO) []ClusterDashboardSignal {
	var out []ClusterDashboardSignal
	if s := detectDeploymentUnavailableSignal(now, namespace, details); s != nil {
		out = append(out, *s)
	}
	if s := detectMissingTemplateReferenceSignal("Deployment", namespace, details.Summary.Name, details.Spec.MissingReferences); s != nil {
		out = append(out, *s)
	}
	return out
}

func DetectDaemonSetDetailSignals(namespace string, details dto.DaemonSetDetailsDTO) []ClusterDashboardSignal {
	if s := detectMissingTemplateReferenceSignal("DaemonSet", namespace, details.Summary.Name, details.Spec.MissingReferences); s != nil {
		return []ClusterDashboardSignal{*s}
	}
	return nil
}

func DetectStatefulSetDetailSignals(namespace string, details dto.StatefulSetDetailsDTO) []ClusterDashboardSignal {
	if s := detectMissingTemplateReferenceSignal("StatefulSet", namespace, details.Summary.Name, details.Spec.MissingReferences); s != nil {
		return []ClusterDashboardSignal{*s}
	}
	return nil
}

func DetectReplicaSetDetailSignals(namespace string, details dto.ReplicaSetDetailsDTO) []ClusterDashboardSignal {
	if s := detectMissingTemplateReferenceSignal("ReplicaSet", namespace, details.Summary.Name, details.Spec.MissingReferences); s != nil {
		return []ClusterDashboardSignal{*s}
	}
	return nil
}

func DetectJobDetailSignals(namespace string, details dto.JobDetailsDTO) []ClusterDashboardSignal {
	if s := detectMissingTemplateReferenceSignal("Job", namespace, details.Summary.Name, details.Spec.MissingReferences); s != nil {
		return []ClusterDashboardSignal{*s}
	}
	return nil
}

func DetectCronJobDetailSignals(namespace string, details dto.CronJobDetailsDTO) []ClusterDashboardSignal {
	if s := detectMissingTemplateReferenceSignal("CronJob", namespace, details.Summary.Name, details.Spec.MissingReferences); s != nil {
		return []ClusterDashboardSignal{*s}
	}
	return nil
}

func detectPodYoungFrequentRestartsSignal(namespace string, details dto.PodDetailsDTO) *ClusterDashboardSignal {
	summary := details.Summary
	if summary.Name == "" {
		return nil
	}
	containers := details.Containers
	if len(containers) == 0 {
		return nil
	}

	ageSec := summary.AgeSec
	if ageSec < 0 {
		ageSec = 0
	}
	// Only fire when the pod is "young" enough; chronic restarts on older pods
	// are covered by the list-level pod_restarts signal.
	if ageSec > int64(signalPodYoungRestartDuration.Seconds()) {
		return nil
	}

	var totalRestarts int32
	for _, c := range containers {
		if c.RestartCount > 0 {
			totalRestarts += c.RestartCount
		}
	}
	if totalRestarts < signalRestartMinThreshold {
		return nil
	}

	highRestart := make([]dto.PodContainerDTO, 0, len(containers))
	for _, c := range containers {
		if c.RestartCount >= signalRestartMinThreshold {
			highRestart = append(highRestart, c)
		}
	}

	mins := int64(0)
	if ageSec > 0 {
		mins = ageSec / 60
	}
	reason := fmt.Sprintf("Pod is restarting frequently (%d restarts in %dm).", totalRestarts, mins)

	sig := dashboardSignalItem(
		"pod_young_frequent_restarts", "Pod",
		namespace, summary.Name,
		"high", 86,
		reason, "high", "pods",
	)
	sig.ActualData = fmt.Sprintf("%d total restarts in %dm", totalRestarts, mins)
	if reasons := podTerminationReasonsSummary(highRestart, 3); reasons != "" {
		sig.CalculatedData = fmt.Sprintf("last termination: %s", reasons)
	}
	return &sig
}

func detectPodSucceededWithIssuesSignal(namespace string, details dto.PodDetailsDTO, events []dto.EventDTO) *ClusterDashboardSignal {
	summary := details.Summary
	if summary.Name == "" {
		return nil
	}
	if !strings.EqualFold(summary.Phase, "Succeeded") {
		return nil
	}

	issues := make([]string, 0, 3)

	for _, cond := range details.Conditions {
		if strings.EqualFold(cond.Reason, "PodCompleted") {
			continue
		}
		if cond.Status != "True" {
			issues = append(issues, fmt.Sprintf("condition %s=%s", cond.Type, cond.Status))
			break
		}
	}
	for _, c := range details.Containers {
		if strings.EqualFold(c.State, "Waiting") && c.Reason != "" {
			issues = append(issues, fmt.Sprintf("container %s waiting (%s)", c.Name, c.Reason))
			break
		}
	}
	warningEvents := 0
	for _, e := range events {
		if strings.EqualFold(e.Type, "Warning") {
			warningEvents++
		}
	}
	if warningEvents > 0 {
		issues = append(issues, fmt.Sprintf("%d Warning event(s)", warningEvents))
	}

	if len(issues) == 0 {
		return nil
	}

	reason := "Pod phase is Succeeded, but some conditions, container states, or events indicate issues."
	sig := dashboardSignalItem(
		"pod_succeeded_with_issues", "Pod",
		namespace, summary.Name,
		"low", 30,
		reason, "medium", "pods",
	)
	sig.ActualData = "phase Succeeded · " + strings.Join(issues, ", ")
	return &sig
}

func detectPodMissingSecretReferenceSignal(namespace string, details dto.PodDetailsDTO, events []dto.EventDTO) *ClusterDashboardSignal {
	summary := details.Summary
	if summary.Name == "" {
		return nil
	}
	refs := podSecretReferences(details)
	if len(refs) == 0 || len(events) == 0 {
		return nil
	}

	missing := map[string]struct{}{}
	var evidence string
	for _, event := range events {
		if !strings.EqualFold(event.Type, "Warning") {
			continue
		}
		if !eventLooksLikeMissingSecret(event) {
			continue
		}
		for secretName := range refs {
			if eventMentionsSecretName(event, secretName) {
				missing[secretName] = struct{}{}
				if evidence == "" {
					evidence = strings.TrimSpace(event.Message)
					if evidence == "" {
						evidence = strings.TrimSpace(event.Reason)
					}
				}
			}
		}
	}
	if len(missing) == 0 {
		return nil
	}

	names := make([]string, 0, len(missing))
	for name := range missing {
		names = append(names, name)
	}
	sort.Strings(names)

	reason := fmt.Sprintf("Pod references missing Secret(s): %s.", strings.Join(names, ", "))
	sig := dashboardSignalItem(
		"pod_missing_secret_reference", "Pod",
		namespace, summary.Name,
		"high", 84,
		reason, "high", "pods",
	)
	sig.ActualData = strings.Join(names, ", ")
	if evidence != "" {
		sig.CalculatedData = evidence
	}
	return &sig
}

func podSecretReferences(details dto.PodDetailsDTO) map[string]struct{} {
	refs := map[string]struct{}{}
	for _, volume := range details.Resources.Volumes {
		if strings.EqualFold(volume.Type, "Secret") && strings.TrimSpace(volume.Source) != "" {
			refs[strings.TrimSpace(volume.Source)] = struct{}{}
		}
	}
	for _, secretName := range details.Resources.ImagePullSecrets {
		if strings.TrimSpace(secretName) != "" {
			refs[strings.TrimSpace(secretName)] = struct{}{}
		}
	}
	for _, container := range details.Containers {
		for _, env := range container.Env {
			if !strings.EqualFold(env.Source, "Secret") {
				continue
			}
			secretName := strings.TrimSpace(strings.SplitN(env.SourceRef, ":", 2)[0])
			if secretName != "" {
				refs[secretName] = struct{}{}
			}
		}
	}
	return refs
}

func eventLooksLikeMissingSecret(event dto.EventDTO) bool {
	reason := strings.ToLower(event.Reason)
	message := strings.ToLower(event.Message)
	if !strings.Contains(reason+" "+message, "secret") {
		return false
	}
	return strings.Contains(reason, "failed") ||
		strings.Contains(message, "not found") ||
		strings.Contains(message, "couldn't find") ||
		strings.Contains(message, "could not find") ||
		strings.Contains(message, "failed to retrieve") ||
		strings.Contains(message, "failed to fetch")
}

func eventMentionsSecretName(event dto.EventDTO, secretName string) bool {
	needle := strings.ToLower(strings.TrimSpace(secretName))
	if needle == "" {
		return false
	}
	text := strings.ToLower(event.Reason + " " + event.Message)
	return strings.Contains(text, needle)
}

func detectDeploymentUnavailableSignal(now time.Time, namespace string, details dto.DeploymentDetailsDTO) *ClusterDashboardSignal {
	summary := details.Summary
	if summary.Name == "" {
		return nil
	}
	desired := summary.Desired
	available := summary.Available
	if desired <= 0 || available > 0 {
		return nil
	}

	thresholdSec := int64(signalDeploymentUnavailableDuration.Seconds())
	nowSec := now.Unix()

	var availableCond *dto.DeploymentConditionDTO
	for i := range details.Conditions {
		if details.Conditions[i].Type == "Available" {
			availableCond = &details.Conditions[i]
			break
		}
	}

	if availableCond != nil {
		if availableCond.Status != "False" || availableCond.LastTransitionTime <= 0 {
			return nil
		}
		transitionAgeSec := nowSec - availableCond.LastTransitionTime
		if transitionAgeSec <= thresholdSec {
			return nil
		}
		reason := fmt.Sprintf("Deployment has been unavailable for %s.", formatMinutesHuman(transitionAgeSec))
		sig := dashboardSignalItem(
			"deployment_unavailable", "Deployment",
			namespace, summary.Name,
			"high", 88,
			reason, "high", "workloads",
		)
		sig.ActualData = fmt.Sprintf("desired %d, available 0, unavailable for %s", desired, formatMinutesHuman(transitionAgeSec))
		detail := strings.TrimSpace(availableCond.Reason)
		if availableCond.Message != "" {
			if detail != "" {
				detail = detail + " — " + availableCond.Message
			} else {
				detail = availableCond.Message
			}
		}
		if detail != "" {
			sig.CalculatedData = detail
		}
		return &sig
	}

	// No Available condition recorded yet: fall back to age-based best-effort
	// detection, matching the previous UI heuristic.
	if summary.AgeSec <= thresholdSec {
		return nil
	}
	reason := fmt.Sprintf("Deployment has had no available replicas for %s (best-effort detection).", formatMinutesHuman(summary.AgeSec))
	sig := dashboardSignalItem(
		"deployment_unavailable", "Deployment",
		namespace, summary.Name,
		"medium", 72,
		reason, "medium", "workloads",
	)
	sig.ActualData = fmt.Sprintf("desired %d, available 0, age %s", desired, formatMinutesHuman(summary.AgeSec))
	sig.CalculatedData = "no Available condition recorded"
	return &sig
}

func detectMissingTemplateReferenceSignal(kind, namespace, name string, missing []dto.MissingReferenceDTO) *ClusterDashboardSignal {
	if strings.TrimSpace(kind) == "" || strings.TrimSpace(name) == "" || len(missing) == 0 {
		return nil
	}

	refs := make([]string, 0, len(missing))
	descriptions := make([]string, 0, len(missing))
	for _, ref := range missing {
		refKind := strings.TrimSpace(ref.Kind)
		refName := strings.TrimSpace(ref.Name)
		if refKind == "" || refName == "" {
			continue
		}
		refs = append(refs, strings.ToLower(refKind)+"/"+refName)
		if ref.Source != "" {
			descriptions = append(descriptions, fmt.Sprintf("%s %s (%s)", refKind, refName, ref.Source))
		} else {
			descriptions = append(descriptions, fmt.Sprintf("%s %s", refKind, refName))
		}
	}
	if len(refs) == 0 {
		return nil
	}
	sort.Strings(refs)
	sort.Strings(descriptions)

	signalType := strings.ToLower(kind) + "_missing_template_reference"
	reason := fmt.Sprintf("%s pod template references missing object(s): %s.", kind, strings.Join(descriptions, ", "))
	sig := dashboardSignalItem(
		signalType, kind,
		namespace, name,
		"high", 85,
		reason, "high", "workloads",
	)
	sig.ActualData = strings.Join(refs, ", ")
	sig.CalculatedData = "pod template imagePullSecrets and Secret/ConfigMap volumes were checked by the backend"
	return &sig
}

func podTerminationReasonsSummary(containers []dto.PodContainerDTO, limit int) string {
	if limit <= 0 || len(containers) == 0 {
		return ""
	}
	parts := make([]string, 0, limit)
	for _, c := range containers {
		if c.LastTerminationReason == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s: %s", c.Name, c.LastTerminationReason))
		if len(parts) >= limit {
			break
		}
	}
	return strings.Join(parts, ", ")
}

func formatMinutesHuman(ageSec int64) string {
	if ageSec <= 0 {
		return "0m"
	}
	mins := ageSec / 60
	if mins < 60 {
		return fmt.Sprintf("%dm", mins)
	}
	return fmt.Sprintf("%dh %dm", mins/60, mins%60)
}
