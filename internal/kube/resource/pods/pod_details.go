package pods

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func GetPodDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.PodDetailsDTO, error) {
	pod, err := c.Clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	// YAML
	podCopy := pod.DeepCopy()
	podCopy.ManagedFields = nil
	b, err := json.Marshal(podCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	now := time.Now()

	// Summary
	var readyCount, totalCount int
	var restarts int32
	var maxRestarts int32
	for _, cs := range pod.Status.ContainerStatuses {
		totalCount++
		if cs.Ready {
			readyCount++
		}
		restarts += cs.RestartCount
		if cs.RestartCount > maxRestarts {
			maxRestarts = cs.RestartCount
		}
	}

	startTime := int64(0)
	if pod.Status.StartTime != nil && !pod.Status.StartTime.IsZero() {
		startTime = pod.Status.StartTime.Unix()
	}
	age := int64(0)
	if !pod.CreationTimestamp.IsZero() {
		age = int64(now.Sub(pod.CreationTimestamp.Time).Seconds())
	}

	controllerKind, controllerName := findController(pod.OwnerReferences)

	summary := dto.PodSummaryDTO{
		Name:           pod.Name,
		Namespace:      pod.Namespace,
		Node:           pod.Spec.NodeName,
		Phase:          string(pod.Status.Phase),
		Ready:          FmtReady(readyCount, totalCount),
		Restarts:       restarts,
		MaxRestarts:    maxRestarts,
		PodIP:          pod.Status.PodIP,
		HostIP:         pod.Status.HostIP,
		QoSClass:       string(pod.Status.QOSClass),
		StartTime:      startTime,
		AgeSec:         age,
		ControllerKind: controllerKind,
		ControllerName: controllerName,
		ServiceAccount: pod.Spec.ServiceAccountName,
	}

	conditions := make([]dto.PodConditionDTO, 0, len(pod.Status.Conditions))
	for _, cond := range pod.Status.Conditions {
		lt := int64(0)
		if !cond.LastTransitionTime.IsZero() {
			lt = cond.LastTransitionTime.Unix()
		}
		conditions = append(conditions, dto.PodConditionDTO{
			Type:               string(cond.Type),
			Status:             string(cond.Status),
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: lt,
		})
	}

	lifecycle := dto.PodLifecycleDTO{
		RestartPolicy:    string(pod.Spec.RestartPolicy),
		PriorityClass:    pod.Spec.PriorityClassName,
		PreemptionPolicy: formatPreemptionPolicy(pod.Spec.PreemptionPolicy),
		NodeSelector:     pod.Spec.NodeSelector,
		AffinitySummary:  SummarizeAffinity(pod.Spec.Affinity),
		Tolerations:      MapTolerations(pod.Spec.Tolerations),
	}

	statusByName := make(map[string]corev1.ContainerStatus, len(pod.Status.ContainerStatuses))
	for _, st := range pod.Status.ContainerStatuses {
		statusByName[st.Name] = st
	}

	containers := make([]dto.PodContainerDTO, 0, len(pod.Spec.Containers))
	for _, ctn := range pod.Spec.Containers {
		st, ok := statusByName[ctn.Name]
		state, reason, message, startedAt, finishedAt := mapContainerState(st.State)
		lastReason, lastMessage, lastFinished := mapLastTermination(st.LastTerminationState)
		if !ok {
			state = "Unknown"
		}

		containerSec := mapContainerSecurity(ctn.Name, ctn.SecurityContext)

		containers = append(containers, dto.PodContainerDTO{
			Name:                   ctn.Name,
			Image:                  ctn.Image,
			ImageID:                st.ImageID,
			Ready:                  st.Ready,
			State:                  state,
			Reason:                 reason,
			Message:                message,
			StartedAt:              startedAt,
			FinishedAt:             finishedAt,
			RestartCount:           st.RestartCount,
			LastTerminationReason:  lastReason,
			LastTerminationMessage: lastMessage,
			LastTerminationAt:      lastFinished,
			Resources:              MapContainerResources(ctn.Resources),
			Ports:                  mapContainerPorts(ctn.Ports),
			Env:                    mapEnvVars(ctn.Env),
			Mounts:                 mapMounts(ctn.VolumeMounts),
			Probes:                 dto.ContainerProbesDTO{Liveness: mapProbe(ctn.LivenessProbe), Readiness: mapProbe(ctn.ReadinessProbe), Startup: mapProbe(ctn.StartupProbe)},
			SecurityContext:        containerSec,
		})
	}

	resources := dto.PodResourcesDTO{
		Volumes:                   MapVolumes(pod.Spec.Volumes),
		ImagePullSecrets:          MapImagePullSecrets(pod.Spec.ImagePullSecrets),
		PodSecurityContext:        mapPodSecurity(pod.Spec.SecurityContext),
		ContainerSecurityContexts: mapContainerSecurityContexts(pod.Spec.Containers),
		DNSPolicy:                 string(pod.Spec.DNSPolicy),
		HostAliases:               mapHostAliases(pod.Spec.HostAliases),
		TopologySpreadConstraints: MapTopologySpread(pod.Spec.TopologySpreadConstraints),
	}

	return &dto.PodDetailsDTO{
		Summary:    summary,
		Conditions: conditions,
		Lifecycle:  lifecycle,
		Containers: containers,
		Resources:  resources,
		YAML:       string(y),
	}, nil
}

func findController(refs []metav1.OwnerReference) (string, string) {
	for _, ref := range refs {
		if ref.Controller != nil && *ref.Controller {
			return ref.Kind, ref.Name
		}
	}
	if len(refs) > 0 {
		return refs[0].Kind, refs[0].Name
	}
	return "", ""
}

func formatPreemptionPolicy(policy *corev1.PreemptionPolicy) string {
	if policy == nil {
		return ""
	}
	return string(*policy)
}

func SummarizeAffinity(affinity *corev1.Affinity) string {
	if affinity == nil {
		return ""
	}
	parts := []string{}
	if affinity.NodeAffinity != nil {
		parts = append(parts, "nodeAffinity")
	}
	if affinity.PodAffinity != nil {
		parts = append(parts, "podAffinity")
	}
	if affinity.PodAntiAffinity != nil {
		parts = append(parts, "podAntiAffinity")
	}
	return strings.Join(parts, ", ")
}

func MapTolerations(tols []corev1.Toleration) []dto.TolerationDTO {
	if len(tols) == 0 {
		return nil
	}
	out := make([]dto.TolerationDTO, 0, len(tols))
	for _, t := range tols {
		var sec *int64
		if t.TolerationSeconds != nil {
			val := *t.TolerationSeconds
			sec = &val
		}
		out = append(out, dto.TolerationDTO{
			Key:      t.Key,
			Operator: string(t.Operator),
			Value:    t.Value,
			Effect:   string(t.Effect),
			Seconds:  sec,
		})
	}
	return out
}

func mapContainerPorts(ports []corev1.ContainerPort) []dto.ContainerPortDTO {
	if len(ports) == 0 {
		return nil
	}
	out := make([]dto.ContainerPortDTO, 0, len(ports))
	for _, p := range ports {
		out = append(out, dto.ContainerPortDTO{
			Name:          p.Name,
			ContainerPort: p.ContainerPort,
			Protocol:      string(p.Protocol),
		})
	}
	return out
}

func mapContainerState(state corev1.ContainerState) (string, string, string, int64, int64) {
	if state.Running != nil {
		started := int64(0)
		if !state.Running.StartedAt.IsZero() {
			started = state.Running.StartedAt.Unix()
		}
		return "Running", "", "", started, 0
	}
	if state.Waiting != nil {
		return "Waiting", state.Waiting.Reason, state.Waiting.Message, 0, 0
	}
	if state.Terminated != nil {
		started := int64(0)
		finished := int64(0)
		if !state.Terminated.StartedAt.IsZero() {
			started = state.Terminated.StartedAt.Unix()
		}
		if !state.Terminated.FinishedAt.IsZero() {
			finished = state.Terminated.FinishedAt.Unix()
		}
		return "Terminated", state.Terminated.Reason, state.Terminated.Message, started, finished
	}
	return "Unknown", "", "", 0, 0
}

func mapLastTermination(state corev1.ContainerState) (string, string, int64) {
	if state.Terminated == nil {
		return "", "", 0
	}
	finished := int64(0)
	if !state.Terminated.FinishedAt.IsZero() {
		finished = state.Terminated.FinishedAt.Unix()
	}
	return state.Terminated.Reason, state.Terminated.Message, finished
}

func MapContainerResources(res corev1.ResourceRequirements) dto.ContainerResourcesDTO {
	reqCPU := QuantityString(res.Requests[corev1.ResourceCPU])
	reqMem := QuantityString(res.Requests[corev1.ResourceMemory])
	limCPU := QuantityString(res.Limits[corev1.ResourceCPU])
	limMem := QuantityString(res.Limits[corev1.ResourceMemory])

	return dto.ContainerResourcesDTO{
		CPURequest:    reqCPU,
		CPULimit:      limCPU,
		MemoryRequest: reqMem,
		MemoryLimit:   limMem,
	}
}

func QuantityString(qty resource.Quantity) string {
	if qty.IsZero() {
		return ""
	}
	return qty.String()
}

func mapEnvVars(envs []corev1.EnvVar) []dto.EnvVarDTO {
	if len(envs) == 0 {
		return nil
	}
	out := make([]dto.EnvVarDTO, 0, len(envs))
	for _, e := range envs {
		dto := dto.EnvVarDTO{
			Name:  e.Name,
			Value: e.Value,
		}
		if e.ValueFrom != nil {
			switch {
			case e.ValueFrom.ConfigMapKeyRef != nil:
				dto.Source = "ConfigMap"
				dto.SourceRef = fmt.Sprintf("%s:%s", e.ValueFrom.ConfigMapKeyRef.Name, e.ValueFrom.ConfigMapKeyRef.Key)
				dto.Optional = e.ValueFrom.ConfigMapKeyRef.Optional
			case e.ValueFrom.SecretKeyRef != nil:
				dto.Source = "Secret"
				dto.SourceRef = fmt.Sprintf("%s:%s", e.ValueFrom.SecretKeyRef.Name, e.ValueFrom.SecretKeyRef.Key)
				dto.Optional = e.ValueFrom.SecretKeyRef.Optional
			case e.ValueFrom.FieldRef != nil:
				dto.Source = "FieldRef"
				dto.SourceRef = e.ValueFrom.FieldRef.FieldPath
			case e.ValueFrom.ResourceFieldRef != nil:
				dto.Source = "ResourceFieldRef"
				dto.SourceRef = e.ValueFrom.ResourceFieldRef.Resource
			default:
				dto.Source = "ValueFrom"
			}
		} else {
			dto.Source = "Value"
		}
		out = append(out, dto)
	}
	return out
}

func mapMounts(mounts []corev1.VolumeMount) []dto.MountDTO {
	if len(mounts) == 0 {
		return nil
	}
	out := make([]dto.MountDTO, 0, len(mounts))
	for _, m := range mounts {
		out = append(out, dto.MountDTO{
			Name:      m.Name,
			MountPath: m.MountPath,
			ReadOnly:  m.ReadOnly,
			SubPath:   m.SubPath,
		})
	}
	return out
}

func mapProbe(p *corev1.Probe) *dto.ProbeDTO {
	if p == nil {
		return nil
	}
	dto := &dto.ProbeDTO{
		InitialDelaySeconds: p.InitialDelaySeconds,
		PeriodSeconds:       p.PeriodSeconds,
		TimeoutSeconds:      p.TimeoutSeconds,
		FailureThreshold:    p.FailureThreshold,
		SuccessThreshold:    p.SuccessThreshold,
	}
	if p.HTTPGet != nil {
		dto.Type = "HTTP"
		dto.Path = p.HTTPGet.Path
		dto.Port = IntOrString(p.HTTPGet.Port)
		dto.Scheme = string(p.HTTPGet.Scheme)
		return dto
	}
	if p.TCPSocket != nil {
		dto.Type = "TCP"
		dto.Port = IntOrString(p.TCPSocket.Port)
		return dto
	}
	if p.Exec != nil {
		dto.Type = "Exec"
		dto.Command = strings.Join(p.Exec.Command, " ")
		return dto
	}
	return dto
}

func IntOrString(v intstr.IntOrString) string {
	if v.Type == intstr.String {
		return v.StrVal
	}
	return strconv.Itoa(int(v.IntVal))
}

func MapVolumes(vols []corev1.Volume) []dto.VolumeDTO {
	if len(vols) == 0 {
		return nil
	}
	out := make([]dto.VolumeDTO, 0, len(vols))
	for _, v := range vols {
		typ, source := volumeSourceInfo(v.VolumeSource)
		out = append(out, dto.VolumeDTO{
			Name:   v.Name,
			Type:   typ,
			Source: source,
		})
	}
	return out
}

func volumeSourceInfo(vs corev1.VolumeSource) (string, string) {
	switch {
	case vs.ConfigMap != nil:
		return "ConfigMap", vs.ConfigMap.Name
	case vs.Secret != nil:
		return "Secret", vs.Secret.SecretName
	case vs.PersistentVolumeClaim != nil:
		return "PVC", vs.PersistentVolumeClaim.ClaimName
	case vs.EmptyDir != nil:
		return "EmptyDir", string(vs.EmptyDir.Medium)
	case vs.HostPath != nil:
		return "HostPath", vs.HostPath.Path
	case vs.DownwardAPI != nil:
		return "DownwardAPI", fmt.Sprintf("%d items", len(vs.DownwardAPI.Items))
	case vs.Projected != nil:
		return "Projected", fmt.Sprintf("%d sources", len(vs.Projected.Sources))
	case vs.CSI != nil:
		return "CSI", vs.CSI.Driver
	case vs.NFS != nil:
		return "NFS", fmt.Sprintf("%s:%s", vs.NFS.Server, vs.NFS.Path)
	default:
		return "Other", ""
	}
}

func MapImagePullSecrets(secs []corev1.LocalObjectReference) []string {
	if len(secs) == 0 {
		return nil
	}
	out := make([]string, 0, len(secs))
	for _, s := range secs {
		if s.Name != "" {
			out = append(out, s.Name)
		}
	}
	return out
}

func mapPodSecurity(sec *corev1.PodSecurityContext) dto.PodSecurityDTO {
	if sec == nil {
		return dto.PodSecurityDTO{}
	}
	sysctls := make([]dto.SysctlDTO, 0, len(sec.Sysctls))
	for _, s := range sec.Sysctls {
		sysctls = append(sysctls, dto.SysctlDTO{Name: s.Name, Value: s.Value})
	}
	return dto.PodSecurityDTO{
		RunAsUser:           sec.RunAsUser,
		RunAsGroup:          sec.RunAsGroup,
		FSGroup:             sec.FSGroup,
		FSGroupChangePolicy: stringValue(sec.FSGroupChangePolicy),
		SeccompProfile:      formatSeccomp(sec.SeccompProfile),
		SupplementalGroups:  sec.SupplementalGroups,
		Sysctls:             sysctls,
	}
}

func mapContainerSecurity(name string, sec *corev1.SecurityContext) dto.ContainerSecurityDTO {
	dto := dto.ContainerSecurityDTO{Name: name}
	if sec == nil {
		return dto
	}
	dto.RunAsUser = sec.RunAsUser
	dto.RunAsGroup = sec.RunAsGroup
	dto.Privileged = sec.Privileged
	dto.ReadOnlyRootFilesystem = sec.ReadOnlyRootFilesystem
	dto.AllowPrivilegeEscalation = sec.AllowPrivilegeEscalation
	if sec.Capabilities != nil {
		dto.CapabilitiesAdd = mapCapabilities(sec.Capabilities.Add)
		dto.CapabilitiesDrop = mapCapabilities(sec.Capabilities.Drop)
	}
	dto.SeccompProfile = formatSeccomp(sec.SeccompProfile)
	return dto
}

func mapContainerSecurityContexts(ctns []corev1.Container) []dto.ContainerSecurityDTO {
	if len(ctns) == 0 {
		return nil
	}
	out := make([]dto.ContainerSecurityDTO, 0, len(ctns))
	for _, c := range ctns {
		out = append(out, mapContainerSecurity(c.Name, c.SecurityContext))
	}
	return out
}

func formatSeccomp(sec *corev1.SeccompProfile) string {
	if sec == nil {
		return ""
	}
	if sec.Type == corev1.SeccompProfileTypeLocalhost {
		profile := ""
		if sec.LocalhostProfile != nil {
			profile = *sec.LocalhostProfile
		}
		return fmt.Sprintf("%s:%s", sec.Type, profile)
	}
	return string(sec.Type)
}

func mapCapabilities(caps []corev1.Capability) []string {
	if len(caps) == 0 {
		return nil
	}
	out := make([]string, 0, len(caps))
	for _, c := range caps {
		out = append(out, string(c))
	}
	return out
}

func stringValue(val *corev1.PodFSGroupChangePolicy) string {
	if val == nil {
		return ""
	}
	return string(*val)
}

func mapHostAliases(aliases []corev1.HostAlias) []dto.HostAliasDTO {
	if len(aliases) == 0 {
		return nil
	}
	out := make([]dto.HostAliasDTO, 0, len(aliases))
	for _, a := range aliases {
		out = append(out, dto.HostAliasDTO{IP: a.IP, Hostnames: append([]string{}, a.Hostnames...)})
	}
	return out
}

func MapTopologySpread(items []corev1.TopologySpreadConstraint) []dto.TopologySpreadConstraintDTO {
	if len(items) == 0 {
		return nil
	}
	out := make([]dto.TopologySpreadConstraintDTO, 0, len(items))
	for _, t := range items {
		selector := ""
		if t.LabelSelector != nil {
			if sel, err := metav1.LabelSelectorAsSelector(t.LabelSelector); err == nil {
				selector = sel.String()
			}
		}
		out = append(out, dto.TopologySpreadConstraintDTO{
			MaxSkew:           t.MaxSkew,
			TopologyKey:       t.TopologyKey,
			WhenUnsatisfiable: string(t.WhenUnsatisfiable),
			LabelSelector:     selector,
		})
	}
	return out
}
