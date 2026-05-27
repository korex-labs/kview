package server

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/resource/configmaps"
	"github.com/korex-labs/kview/v5/internal/kube/resource/cronjobs"
	"github.com/korex-labs/kview/v5/internal/kube/resource/daemonsets"
	"github.com/korex-labs/kview/v5/internal/kube/resource/deployments"
	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
	"github.com/korex-labs/kview/v5/internal/kube/resource/horizontalpodautoscalers"
	"github.com/korex-labs/kview/v5/internal/kube/resource/ingresses"
	"github.com/korex-labs/kview/v5/internal/kube/resource/jobs"
	"github.com/korex-labs/kview/v5/internal/kube/resource/persistentvolumeclaims"
	"github.com/korex-labs/kview/v5/internal/kube/resource/pods"
	"github.com/korex-labs/kview/v5/internal/kube/resource/replicasets"
	"github.com/korex-labs/kview/v5/internal/kube/resource/rolebindings"
	"github.com/korex-labs/kview/v5/internal/kube/resource/roles"
	"github.com/korex-labs/kview/v5/internal/kube/resource/secrets"
	"github.com/korex-labs/kview/v5/internal/kube/resource/serviceaccounts"
	"github.com/korex-labs/kview/v5/internal/kube/resource/services"
	"github.com/korex-labs/kview/v5/internal/kube/resource/statefulsets"
)

func runSignalInvestigationHelpers(ctx context.Context, clients *cluster.Clients, ref dataplane.SignalInvestigationResourceRef) []dataplane.SignalInvestigationHelperRun {
	if clients == nil {
		return []dataplane.SignalInvestigationHelperRun{{
			Name:   "resource helpers",
			Status: "unavailable",
			Unknowns: []dataplane.SignalInvestigationItem{{
				Label: "Cluster client",
				Value: "Could not create Kubernetes clients for helper reads.",
			}},
		}}
	}
	return []dataplane.SignalInvestigationHelperRun{
		runSignalEventsHelper(ctx, clients, ref),
		runSignalYAMLHelper(ctx, clients, ref),
		runSignalLogsHelper(ctx, clients, ref),
	}
}

func runSignalEventsHelper(ctx context.Context, clients *cluster.Clients, ref dataplane.SignalInvestigationResourceRef) dataplane.SignalInvestigationHelperRun {
	run := dataplane.SignalInvestigationHelperRun{Name: "events", Status: "ok"}
	if ref.Namespace == "" {
		run.Status = "skipped"
		run.Unknowns = append(run.Unknowns, dataplane.SignalInvestigationItem{
			Label: "Scope",
			Value: "Event helper currently supports namespace-scoped resources.",
		})
		return run
	}
	items, err := kubeevents.ListEventsForObject(ctx, clients, ref.Namespace, ref.Kind, ref.Name)
	if err != nil {
		run.Status = "error"
		run.Unknowns = append(run.Unknowns, dataplane.SignalInvestigationItem{
			Label: "Events",
			Value: err.Error(),
		})
		return run
	}
	warnings := 0
	nextStepSeen := map[string]bool{}
	for _, event := range items {
		if strings.EqualFold(event.Type, "Warning") {
			warnings++
			if len(run.Evidence) < 5 {
				run.Evidence = append(run.Evidence, dataplane.SignalInvestigationItem{
					Label: firstNonEmptyServerString(event.Reason, "Warning event"),
					Value: eventEvidenceText(event.Count, event.LastSeen, event.Message),
				})
			}
			if step := eventTroubleshootingStep(event.Reason, event.Message, ref); step != nil && !nextStepSeen[step.Label] {
				nextStepSeen[step.Label] = true
				run.NextSteps = append(run.NextSteps, *step)
			}
		}
	}
	if len(items) == 0 {
		run.Status = "no_findings"
		return run
	}
	run.Summary = fmt.Sprintf("Found %d event(s), including %d warning event(s), for the primary resource.", len(items), warnings)
	if warnings > 0 {
		if !nextStepSeen["Events"] {
			run.NextSteps = append(run.NextSteps, dataplane.SignalInvestigationItem{
				Label: "Events",
				Value: "Use the resource Events tab to inspect full timing, count, field path, and repeated warning messages.",
			})
		}
	} else {
		run.Status = "no_findings"
		run.Summary = ""
	}
	return run
}

func eventEvidenceText(count int32, lastSeen int64, message string) string {
	parts := make([]string, 0, 3)
	if count > 0 {
		parts = append(parts, fmt.Sprintf("count=%d", count))
	}
	if lastSeen > 0 {
		parts = append(parts, "lastSeen="+time.Unix(lastSeen, 0).UTC().Format(time.RFC3339))
	}
	if strings.TrimSpace(message) != "" {
		parts = append(parts, strings.TrimSpace(message))
	}
	return strings.Join(parts, " · ")
}

func eventTroubleshootingStep(reason, message string, ref dataplane.SignalInvestigationResourceRef) *dataplane.SignalInvestigationItem {
	text := strings.ToLower(strings.TrimSpace(reason + " " + message))
	switch {
	case strings.Contains(text, "failedscheduling") || strings.Contains(text, "insufficient") || strings.Contains(text, "didn't match") || strings.Contains(text, "taint"):
		return &dataplane.SignalInvestigationItem{
			Label: "Scheduling",
			Value: "Check node capacity, taints/tolerations, node selectors, affinity, and namespace ResourceQuota/LimitRange constraints.",
		}
	case strings.Contains(text, "failedmount") || strings.Contains(text, "failedattachvolume") || strings.Contains(text, "mountvolume"):
		return &dataplane.SignalInvestigationItem{
			Label: "Volume mount",
			Value: "Check referenced PVCs, Secrets, ConfigMaps, CSI driver status, and whether the mounted object exists in the same namespace.",
		}
	case strings.Contains(text, "errimagepull") || strings.Contains(text, "imagepullbackoff") || strings.Contains(text, "pull image") || strings.Contains(text, "pulling image"):
		return &dataplane.SignalInvestigationItem{
			Label: "Image pull",
			Value: "Check image name/tag, registry reachability, imagePullSecrets, and whether the service account can read the registry credentials.",
		}
	case strings.Contains(text, "backoff") || strings.Contains(text, "crashloopbackoff"):
		return &dataplane.SignalInvestigationItem{
			Label: "Container restart",
			Value: "Open current and previous container logs; compare termination reason, exit code, command, args, env, and mounted config.",
		}
	case strings.Contains(text, "unhealthy") || strings.Contains(text, "readiness probe") || strings.Contains(text, "liveness probe") || strings.Contains(text, "startup probe"):
		return &dataplane.SignalInvestigationItem{
			Label: "Health probe",
			Value: "Check probe path/port/scheme, container listen address, startup time, and whether dependencies are ready before the probe begins.",
		}
	case strings.Contains(text, "failedcreate") && ref.Kind != "":
		return &dataplane.SignalInvestigationItem{
			Label: "Controller create",
			Value: "Inspect controller events and YAML for invalid pod template fields, quota failures, forbidden service account use, or admission webhook rejection.",
		}
	default:
		return nil
	}
}

func runSignalLogsHelper(ctx context.Context, clients *cluster.Clients, ref dataplane.SignalInvestigationResourceRef) dataplane.SignalInvestigationHelperRun {
	run := dataplane.SignalInvestigationHelperRun{Name: "logs", Status: "ok"}
	if ref.Kind != "Pod" || ref.Namespace == "" || ref.Name == "" {
		run.Status = "no_findings"
		return run
	}
	pod, err := clients.Clientset.CoreV1().Pods(ref.Namespace).Get(ctx, ref.Name, metav1.GetOptions{})
	if err != nil {
		run.Status = "error"
		run.Unknowns = append(run.Unknowns, dataplane.SignalInvestigationItem{Label: "Pod", Value: err.Error()})
		return run
	}
	targets := logHelperContainerTargets(*pod)
	if len(targets) == 0 {
		run.Status = "no_findings"
		return run
	}
	seen := map[string]bool{}
	for _, target := range targets {
		findings, readErr := readAndAnalyzeContainerLogs(ctx, clients, ref.Namespace, ref.Name, target.name, target.previous)
		if readErr != nil {
			if target.previous {
				continue
			}
			run.Unknowns = append(run.Unknowns, dataplane.SignalInvestigationItem{
				Label: "Container logs",
				Value: fmt.Sprintf("%s: %s", target.name, readErr.Error()),
			})
			continue
		}
		for _, finding := range findings {
			key := finding.Label + "\x00" + finding.Value
			if seen[key] {
				continue
			}
			seen[key] = true
			run.Evidence = append(run.Evidence, finding)
			if len(run.Evidence) >= 6 {
				break
			}
		}
		if len(run.Evidence) >= 6 {
			break
		}
	}
	if len(run.Evidence) == 0 && len(run.Unknowns) == 0 {
		run.Status = "no_findings"
		return run
	}
	if len(run.Evidence) > 0 {
		run.Summary = "Found log lines that match common failure patterns."
		run.NextSteps = append(run.NextSteps, dataplane.SignalInvestigationItem{
			Label: "Logs",
			Value: "Open full current and previous logs for the flagged container to inspect surrounding context.",
		})
	}
	return run
}

type logContainerTarget struct {
	name     string
	previous bool
}

func logHelperContainerTargets(pod corev1.Pod) []logContainerTarget {
	seen := map[string]bool{}
	var out []logContainerTarget
	add := func(name string, previous bool) {
		if name == "" {
			return
		}
		key := name + fmt.Sprintf("|%t", previous)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, logContainerTarget{name: name, previous: previous})
	}
	for _, status := range pod.Status.InitContainerStatuses {
		if status.RestartCount > 0 || !status.Ready || status.State.Waiting != nil || status.LastTerminationState.Terminated != nil {
			add(status.Name, false)
			if status.RestartCount > 0 || status.LastTerminationState.Terminated != nil {
				add(status.Name, true)
			}
		}
	}
	for _, status := range pod.Status.ContainerStatuses {
		if status.RestartCount > 0 || !status.Ready || status.State.Waiting != nil || status.LastTerminationState.Terminated != nil {
			add(status.Name, false)
			if status.RestartCount > 0 || status.LastTerminationState.Terminated != nil {
				add(status.Name, true)
			}
		}
	}
	if len(out) == 0 && len(pod.Spec.Containers) == 1 {
		add(pod.Spec.Containers[0].Name, false)
	}
	if len(out) > 4 {
		return out[:4]
	}
	return out
}

func readAndAnalyzeContainerLogs(ctx context.Context, clients *cluster.Clients, namespace, pod, container string, previous bool) ([]dataplane.SignalInvestigationItem, error) {
	tailLines := int64(80)
	req := clients.Clientset.CoreV1().Pods(namespace).GetLogs(pod, &corev1.PodLogOptions{
		Container: container,
		Previous:  previous,
		TailLines: &tailLines,
	})
	stream, err := req.Stream(ctx)
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	raw, err := io.ReadAll(io.LimitReader(stream, 64*1024))
	if err != nil {
		return nil, err
	}
	return analyzeLogText(container, previous, string(raw)), nil
}

func analyzeLogText(container string, previous bool, raw string) []dataplane.SignalInvestigationItem {
	var out []dataplane.SignalInvestigationItem
	seen := map[string]bool{}
	source := "current logs"
	if previous {
		source = "previous logs"
	}
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if label := logLineFindingLabel(trimmed); label != "" {
			key := label + "\x00" + trimmed
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, dataplane.SignalInvestigationItem{
				Label: label,
				Value: fmt.Sprintf("%s/%s: %s", container, source, truncateLogFinding(trimmed)),
			})
			if len(out) >= 4 {
				break
			}
		}
	}
	return out
}

func logLineFindingLabel(line string) string {
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "panic:") || strings.Contains(lower, "exception") || strings.Contains(lower, "traceback"):
		return "Application exception"
	case strings.Contains(lower, "segmentation fault") || strings.Contains(lower, "fatal error"):
		return "Process crash"
	case strings.Contains(lower, "permission denied") || strings.Contains(lower, "access denied") || strings.Contains(lower, "forbidden"):
		return "Permission failure"
	case strings.Contains(lower, "connection refused") || strings.Contains(lower, "connection reset") || strings.Contains(lower, "no route to host") || strings.Contains(lower, "i/o timeout"):
		return "Network failure"
	case strings.Contains(lower, "no such file") || strings.Contains(lower, "file not found") || strings.Contains(lower, "cannot find"):
		return "Missing file"
	case strings.Contains(lower, "oom") || strings.Contains(lower, "out of memory") || strings.Contains(lower, "memory limit"):
		return "Memory failure"
	case strings.Contains(lower, "error") || strings.Contains(lower, "failed"):
		return "Application error"
	default:
		return ""
	}
}

func truncateLogFinding(value string) string {
	const max = 220
	if len(value) <= max {
		return value
	}
	return value[:max] + "..."
}

func runSignalYAMLHelper(ctx context.Context, clients *cluster.Clients, ref dataplane.SignalInvestigationResourceRef) dataplane.SignalInvestigationHelperRun {
	run := dataplane.SignalInvestigationHelperRun{Name: "yaml", Status: "ok"}
	raw, ok, err := investigationResourceYAML(ctx, clients, ref)
	if err != nil {
		run.Status = "error"
		run.Unknowns = append(run.Unknowns, dataplane.SignalInvestigationItem{
			Label: "YAML",
			Value: err.Error(),
		})
		return run
	}
	if !ok {
		run.Status = "skipped"
		run.Unknowns = append(run.Unknowns, dataplane.SignalInvestigationItem{
			Label: "YAML",
			Value: fmt.Sprintf("YAML helper does not support %s yet.", ref.Kind),
		})
		return run
	}
	run.Summary = "Fetched live YAML and ran deterministic checks."
	run.Evidence = append(run.Evidence, analyzeInvestigationYAML(ctx, clients, ref, raw)...)
	if len(run.Evidence) == 0 {
		run.Status = "no_findings"
		run.Summary = ""
		return run
	}
	run.NextSteps = append(run.NextSteps, dataplane.SignalInvestigationItem{
		Label: "YAML",
		Value: "Open the YAML tab to inspect the full manifest and compare helper findings with live object state.",
	})
	return run
}

func investigationResourceYAML(ctx context.Context, clients *cluster.Clients, ref dataplane.SignalInvestigationResourceRef) (string, bool, error) {
	ns, name := ref.Namespace, ref.Name
	switch ref.Kind {
	case "Pod":
		item, err := pods.GetPodDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "Deployment":
		item, err := deployments.GetDeploymentDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "DaemonSet":
		raw, err := daemonsets.GetDaemonSetYAML(ctx, clients, ns, name)
		return raw, true, err
	case "StatefulSet":
		raw, err := statefulsets.GetStatefulSetYAML(ctx, clients, ns, name)
		return raw, true, err
	case "ReplicaSet":
		item, err := replicasets.GetReplicaSetDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "Job":
		item, err := jobs.GetJobDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "CronJob":
		item, err := cronjobs.GetCronJobDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "HorizontalPodAutoscaler":
		raw, err := horizontalpodautoscalers.GetHorizontalPodAutoscalerYAML(ctx, clients, ns, name)
		return raw, true, err
	case "Service":
		item, err := services.GetServiceDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "Ingress":
		item, err := ingresses.GetIngressDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "PersistentVolumeClaim":
		raw, err := persistentvolumeclaims.GetPersistentVolumeClaimYAML(ctx, clients, ns, name)
		return raw, true, err
	case "ConfigMap":
		item, err := configmaps.GetConfigMapDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "Secret":
		item, err := secrets.GetSecretDetails(ctx, clients, ns, name)
		if err != nil {
			return "", true, err
		}
		return item.YAML, true, nil
	case "ServiceAccount":
		raw, err := serviceaccounts.GetServiceAccountYAML(ctx, clients, ns, name)
		return raw, true, err
	case "Role":
		raw, err := roles.GetRoleYAML(ctx, clients, ns, name)
		return raw, true, err
	case "RoleBinding":
		raw, err := rolebindings.GetRoleBindingYAML(ctx, clients, ns, name)
		return raw, true, err
	default:
		return "", false, nil
	}
}

func analyzeInvestigationYAML(ctx context.Context, clients *cluster.Clients, ref dataplane.SignalInvestigationResourceRef, raw string) []dataplane.SignalInvestigationItem {
	var obj map[string]any
	if err := yaml.Unmarshal([]byte(raw), &obj); err != nil {
		return []dataplane.SignalInvestigationItem{{
			Label: "YAML parse",
			Value: "Live YAML could not be parsed: " + err.Error(),
		}}
	}
	var out []dataplane.SignalInvestigationItem
	if strings.TrimSpace(stringValue(obj["apiVersion"])) == "" {
		out = append(out, dataplane.SignalInvestigationItem{Label: "YAML structure", Value: "apiVersion is empty."})
	}
	if kind := stringValue(obj["kind"]); kind == "" {
		out = append(out, dataplane.SignalInvestigationItem{Label: "YAML structure", Value: "kind is empty."})
	} else if !strings.EqualFold(kind, ref.Kind) {
		out = append(out, dataplane.SignalInvestigationItem{Label: "YAML structure", Value: fmt.Sprintf("kind is %q, expected %q.", kind, ref.Kind)})
	}
	metadata := mapValue(obj["metadata"])
	if name := stringValue(metadata["name"]); name == "" {
		out = append(out, dataplane.SignalInvestigationItem{Label: "YAML structure", Value: "metadata.name is empty."})
	} else if ref.Name != "" && name != ref.Name {
		out = append(out, dataplane.SignalInvestigationItem{Label: "YAML structure", Value: fmt.Sprintf("metadata.name is %q, expected %q.", name, ref.Name)})
	}
	if ref.Namespace != "" {
		if ns := stringValue(metadata["namespace"]); ns != "" && ns != ref.Namespace {
			out = append(out, dataplane.SignalInvestigationItem{Label: "YAML structure", Value: fmt.Sprintf("metadata.namespace is %q, expected %q.", ns, ref.Namespace)})
		}
	}
	out = append(out, analyzeSelectorTemplateMismatch(ref.Kind, obj)...)
	out = append(out, analyzeServiceSelector(ctx, clients, ref, obj)...)
	out = append(out, analyzeReferencedResources(ctx, clients, ref.Namespace, obj)...)
	return out
}

func analyzeSelectorTemplateMismatch(kind string, obj map[string]any) []dataplane.SignalInvestigationItem {
	switch kind {
	case "Deployment", "DaemonSet", "StatefulSet", "ReplicaSet", "Job":
	default:
		return nil
	}
	spec := mapValue(obj["spec"])
	if kind == "Job" {
		template := mapValue(spec["template"])
		labels := stringMap(mapValue(mapValue(template["metadata"])["labels"]))
		if len(labels) == 0 {
			return []dataplane.SignalInvestigationItem{{Label: "Pod template", Value: "Job pod template has no labels."}}
		}
		return nil
	}
	selector := stringMap(mapValue(mapValue(spec["selector"])["matchLabels"]))
	template := mapValue(spec["template"])
	labels := stringMap(mapValue(mapValue(template["metadata"])["labels"]))
	if len(selector) == 0 {
		return []dataplane.SignalInvestigationItem{{Label: "Selector", Value: kind + " selector.matchLabels is empty."}}
	}
	var missing []string
	for key, value := range selector {
		if labels[key] != value {
			missing = append(missing, key+"="+value)
		}
	}
	sort.Strings(missing)
	if len(missing) == 0 {
		return nil
	}
	return []dataplane.SignalInvestigationItem{{
		Label: "Selector",
		Value: fmt.Sprintf("%s selector labels are not present with matching values on the pod template: %s.", kind, strings.Join(missing, ", ")),
	}}
}

func analyzeServiceSelector(ctx context.Context, clients *cluster.Clients, ref dataplane.SignalInvestigationResourceRef, obj map[string]any) []dataplane.SignalInvestigationItem {
	if ref.Kind != "Service" {
		return nil
	}
	spec := mapValue(obj["spec"])
	if strings.EqualFold(stringValue(spec["type"]), "ExternalName") {
		return nil
	}
	selector := stringMap(mapValue(spec["selector"]))
	if len(selector) == 0 {
		return []dataplane.SignalInvestigationItem{{Label: "Service selector", Value: "Service has no selector, so kview cannot infer backing Pods from labels."}}
	}
	if clients == nil || ref.Namespace == "" {
		return nil
	}
	pods, err := clients.Clientset.CoreV1().Pods(ref.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(labels.Set(selector)).String(),
	})
	if err != nil {
		return []dataplane.SignalInvestigationItem{{Label: "Service selector", Value: "Could not verify backing Pods for Service selector: " + err.Error()}}
	}
	ready := 0
	for _, pod := range pods.Items {
		if podReady(pod) {
			ready++
		}
	}
	if len(pods.Items) == 0 {
		return []dataplane.SignalInvestigationItem{{Label: "Service selector", Value: fmt.Sprintf("Service selector matched no Pods in namespace %s.", ref.Namespace)}}
	}
	if ready == 0 {
		return []dataplane.SignalInvestigationItem{{Label: "Service selector", Value: fmt.Sprintf("Service selector matched %d Pod(s), but none are Ready.", len(pods.Items))}}
	}
	return nil
}

func analyzeReferencedResources(ctx context.Context, clients *cluster.Clients, namespace string, obj map[string]any) []dataplane.SignalInvestigationItem {
	if namespace == "" || clients == nil {
		return nil
	}
	refs := referencedResourceNames(obj)
	var out []dataplane.SignalInvestigationItem
	for _, name := range sortedSetValues(refs.secrets) {
		if _, err := clients.Clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
			if apierrors.IsNotFound(err) {
				out = append(out, dataplane.SignalInvestigationItem{Label: "Missing Secret", Value: fmt.Sprintf("Referenced Secret %q was not found in namespace %s.", name, namespace)})
			} else {
				out = append(out, dataplane.SignalInvestigationItem{Label: "Secret check", Value: fmt.Sprintf("Could not verify Secret %q: %s", name, err.Error())})
			}
		}
	}
	for _, name := range sortedSetValues(refs.configMaps) {
		if _, err := clients.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
			if apierrors.IsNotFound(err) {
				out = append(out, dataplane.SignalInvestigationItem{Label: "Missing ConfigMap", Value: fmt.Sprintf("Referenced ConfigMap %q was not found in namespace %s.", name, namespace)})
			} else {
				out = append(out, dataplane.SignalInvestigationItem{Label: "ConfigMap check", Value: fmt.Sprintf("Could not verify ConfigMap %q: %s", name, err.Error())})
			}
		}
	}
	for _, name := range sortedSetValues(refs.pvcs) {
		if _, err := clients.Clientset.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
			if apierrors.IsNotFound(err) {
				out = append(out, dataplane.SignalInvestigationItem{Label: "Missing PVC", Value: fmt.Sprintf("Referenced PersistentVolumeClaim %q was not found in namespace %s.", name, namespace)})
			} else {
				out = append(out, dataplane.SignalInvestigationItem{Label: "PVC check", Value: fmt.Sprintf("Could not verify PersistentVolumeClaim %q: %s", name, err.Error())})
			}
		}
	}
	for _, name := range sortedSetValues(refs.serviceAccounts) {
		if _, err := clients.Clientset.CoreV1().ServiceAccounts(namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
			if apierrors.IsNotFound(err) {
				out = append(out, dataplane.SignalInvestigationItem{Label: "Missing ServiceAccount", Value: fmt.Sprintf("Referenced ServiceAccount %q was not found in namespace %s.", name, namespace)})
			} else {
				out = append(out, dataplane.SignalInvestigationItem{Label: "ServiceAccount check", Value: fmt.Sprintf("Could not verify ServiceAccount %q: %s", name, err.Error())})
			}
		}
	}
	return out
}

type referencedResources struct {
	secrets         map[string]bool
	configMaps      map[string]bool
	pvcs            map[string]bool
	serviceAccounts map[string]bool
}

func referencedResourceNames(value any) referencedResources {
	refs := referencedResources{secrets: map[string]bool{}, configMaps: map[string]bool{}, pvcs: map[string]bool{}, serviceAccounts: map[string]bool{}}
	collectReferencedResources(value, &refs)
	return refs
}

func collectReferencedResources(value any, refs *referencedResources) {
	switch typed := value.(type) {
	case map[string]any:
		if v := stringValue(typed["secretName"]); v != "" {
			refs.secrets[v] = true
		}
		if child := mapValue(typed["secret"]); child != nil {
			if v := stringValue(child["secretName"]); v != "" {
				refs.secrets[v] = true
			}
		}
		if v := stringValue(typed["claimName"]); v != "" {
			refs.pvcs[v] = true
		}
		if v := stringValue(typed["serviceAccountName"]); v != "" {
			refs.serviceAccounts[v] = true
		}
		if v := stringValue(typed["serviceAccount"]); v != "" {
			refs.serviceAccounts[v] = true
		}
		if child := mapValue(typed["persistentVolumeClaim"]); child != nil {
			if v := stringValue(child["claimName"]); v != "" {
				refs.pvcs[v] = true
			}
		}
		if imagePullSecrets, ok := typed["imagePullSecrets"].([]any); ok {
			for _, item := range imagePullSecrets {
				if v := stringValue(mapValue(item)["name"]); v != "" {
					refs.secrets[v] = true
				}
			}
		}
		for _, key := range []string{"secretRef", "secretKeyRef"} {
			if child := mapValue(typed[key]); child != nil {
				if v := stringValue(child["name"]); v != "" {
					refs.secrets[v] = true
				}
			}
		}
		for _, key := range []string{"configMap", "configMapRef", "configMapKeyRef"} {
			if child := mapValue(typed[key]); child != nil {
				if v := stringValue(child["name"]); v != "" {
					refs.configMaps[v] = true
				}
			}
		}
		for _, child := range typed {
			collectReferencedResources(child, refs)
		}
	case []any:
		for _, child := range typed {
			collectReferencedResources(child, refs)
		}
	}
}

func stringValue(value any) string {
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func mapValue(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return nil
}

func stringMap(value map[string]any) map[string]string {
	out := map[string]string{}
	for key, raw := range value {
		if value := stringValue(raw); value != "" {
			out[key] = value
		}
	}
	return out
}

func podReady(pod corev1.Pod) bool {
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady && condition.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func sortedSetValues(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
