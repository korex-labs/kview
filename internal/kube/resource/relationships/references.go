package relationships

import (
	"fmt"
	"sort"
	"strings"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

var fullComplete = dto.ResourceRelationshipCoverageDTO{
	Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete,
}
var partialCoverage = dto.ResourceRelationshipCoverageDTO{
	Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial,
}

// ReferenceExtraction is the all-or-nothing result for one reference family.
// Complete=false means that at least one relevant supported field was malformed
// or unsupported. Malformed targets are never retained in References.
type ReferenceExtraction struct {
	References []dto.ResourceReferenceDTO
	Complete   bool
}

// SelectorExtraction is the all-or-nothing result for selector evidence.
type SelectorExtraction struct {
	Selectors []dto.ResourceRelationshipSelectorDTO
	Complete  bool
}

// WithObjectReferences returns a deep-copied carrier enriched with one complete
// object-reference observation. An empty complete extraction proves zero refs.
func WithObjectReferences(carrier dto.ResourceRelationshipCarrier, extraction ReferenceExtraction) dto.ResourceRelationshipCarrier {
	return withReferences(carrier, dto.ResourceRelationshipFamilyObjectReference, extraction)
}

// WithKindDefinitions returns a deep-copied carrier enriched with one complete
// kind-definition observation. An empty complete extraction proves zero refs.
func WithKindDefinitions(carrier dto.ResourceRelationshipCarrier, extraction ReferenceExtraction) dto.ResourceRelationshipCarrier {
	return withReferences(carrier, dto.ResourceRelationshipFamilyKindDefinition, extraction)
}

// WithLabels returns a deep-copied carrier containing a caller-independent label
// map. Kubernetes validation and relationship normalization remain authoritative
// for the configured label bounds.
func WithLabels(carrier dto.ResourceRelationshipCarrier, labels map[string]string) dto.ResourceRelationshipCarrier {
	out := cloneCarrier(carrier)
	out.Labels = cloneMap(labels)
	setFamilyCoverage(&out, dto.ResourceRelationshipFamilyLabels, true)
	return out
}

// WithSelectors returns a deep-copied carrier enriched with selector evidence.
// An empty complete extraction proves that the source has no selector.
func WithSelectors(carrier dto.ResourceRelationshipCarrier, extraction SelectorExtraction) dto.ResourceRelationshipCarrier {
	out := cloneCarrier(carrier)
	out.Selectors = cloneSelectors(extraction.Selectors)
	setFamilyCoverage(&out, dto.ResourceRelationshipFamilySelector, extraction.Complete)
	return out
}

func withReferences(carrier dto.ResourceRelationshipCarrier, family dto.ResourceRelationshipFamily, extraction ReferenceExtraction) dto.ResourceRelationshipCarrier {
	out := cloneCarrier(carrier)
	for _, reference := range extraction.References {
		referenceFamily, mapped := referenceFamily(reference.Type)
		if mapped && referenceFamily == family {
			out.References = append(out.References, cloneReference(reference))
		} else {
			extraction.Complete = false
		}
	}
	setFamilyCoverage(&out, family, extraction.Complete)
	return out
}

func setFamilyCoverage(carrier *dto.ResourceRelationshipCarrier, family dto.ResourceRelationshipFamily, complete bool) {
	if carrier.FamilyCoverage == nil {
		carrier.FamilyCoverage = make(map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO)
	}
	incoming := partialCoverage
	if complete {
		incoming = fullComplete
	}
	existing, exists := carrier.FamilyCoverage[family]
	if !exists {
		carrier.FamilyCoverage[family] = incoming
	} else {
		carrier.FamilyCoverage[family] = worstCoverage(existing, incoming)
	}
	carrier.Coverage = worstCoverage(carrier.Coverage, incoming)
}

func worstCoverage(existing, incoming dto.ResourceRelationshipCoverageDTO) dto.ResourceRelationshipCoverageDTO {
	return dto.ResourceRelationshipCoverageDTO{
		Coverage:     worstCoverageAxis(existing.Coverage, incoming.Coverage),
		Completeness: worstCompletenessAxis(existing.Completeness, incoming.Completeness),
	}
}

func worstCoverageAxis(existing, incoming dto.ResourceRelationshipCoverage) dto.ResourceRelationshipCoverage {
	switch existing {
	case "":
		return incoming
	case dto.ResourceRelationshipCoverageUnknown:
		return dto.ResourceRelationshipCoverageUnknown
	case dto.ResourceRelationshipCoveragePartial:
		return dto.ResourceRelationshipCoveragePartial
	case dto.ResourceRelationshipCoverageFull:
		return incoming
	default:
		return dto.ResourceRelationshipCoverageUnknown
	}
}

func worstCompletenessAxis(existing, incoming dto.ResourceRelationshipCompleteness) dto.ResourceRelationshipCompleteness {
	switch existing {
	case "":
		return incoming
	case dto.ResourceRelationshipCompletenessUnknown:
		return dto.ResourceRelationshipCompletenessUnknown
	case dto.ResourceRelationshipCompletenessPartial:
		return dto.ResourceRelationshipCompletenessPartial
	case dto.ResourceRelationshipCompletenessComplete:
		return incoming
	default:
		return dto.ResourceRelationshipCompletenessUnknown
	}
}

// ServiceSelector extracts exact matchLabels evidence for Service -> Pod. An
// empty Service selector is deliberately zero selector evidence, not match-all.
func ServiceSelector(selector map[string]string) SelectorExtraction {
	if len(selector) == 0 {
		return SelectorExtraction{Complete: true}
	}
	return SelectorExtraction{Complete: true, Selectors: []dto.ResourceRelationshipSelectorDTO{{
		Target: dto.ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: dto.ResourceScopeNamespaced},
		Source: kubernetesSource("spec.selector"), MatchLabels: cloneMap(selector), Coverage: fullComplete,
	}}}
}

// MatchLabelsSelector extracts a workload selector targeting namespace-local
// Pods. prefix is the exact selector field path, for example "spec.selector".
func MatchLabelsSelector(prefix string, labels map[string]string) SelectorExtraction {
	if len(labels) == 0 {
		return SelectorExtraction{Complete: true}
	}
	return SelectorExtraction{Complete: true, Selectors: []dto.ResourceRelationshipSelectorDTO{{
		Target: dto.ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: dto.ResourceScopeNamespaced},
		Source: kubernetesSource(prefix), MatchLabels: cloneMap(labels), Coverage: fullComplete,
	}}}
}

// PodSpecReferences extracts canonical references from a PodSpec. prefix is the
// path of that PodSpec ("spec" for Pods, "spec.template.spec" for workloads).
func PodSpecReferences(namespace, prefix string, spec corev1.PodSpec) ReferenceExtraction {
	out := ReferenceExtraction{Complete: true}
	add := func(descriptor IdentityDescriptor, ns, name, path string) {
		if strings.TrimSpace(name) == "" {
			out.Complete = false
			return
		}
		out.References = append(out.References, objectReference(descriptor, ns, name, "", path, dto.ResourceRelationshipEvidenceDTO{}))
	}
	if spec.NodeName != "" {
		add(NodeDescriptor, "", spec.NodeName, field(prefix, "nodeName"))
	}
	serviceAccountName := spec.ServiceAccountName
	if serviceAccountName == "" {
		serviceAccountName = "default"
	}
	add(ServiceAccountDescriptor, namespace, serviceAccountName, field(prefix, "serviceAccountName"))

	for i := range spec.Volumes {
		volume := &spec.Volumes[i]
		base := indexed(field(prefix, "volumes"), i)
		switch {
		case volume.PersistentVolumeClaim != nil:
			add(PersistentVolumeClaimDescriptor, namespace, volume.PersistentVolumeClaim.ClaimName, field(base, "persistentVolumeClaim.claimName"))
		case volume.ConfigMap != nil:
			add(ConfigMapDescriptor, namespace, volume.ConfigMap.Name, field(base, "configMap.name"))
		case volume.Secret != nil:
			add(SecretDescriptor, namespace, volume.Secret.SecretName, field(base, "secret.secretName"))
		}
		if volume.Projected != nil {
			for j := range volume.Projected.Sources {
				source := &volume.Projected.Sources[j]
				sourceBase := indexed(field(base, "projected.sources"), j)
				if source.ConfigMap != nil {
					add(ConfigMapDescriptor, namespace, source.ConfigMap.Name, field(sourceBase, "configMap.name"))
				}
				if source.Secret != nil {
					add(SecretDescriptor, namespace, source.Secret.Name, field(sourceBase, "secret.name"))
				}
			}
		}
		if volume.CSI != nil && volume.CSI.NodePublishSecretRef != nil {
			add(SecretDescriptor, namespace, volume.CSI.NodePublishSecretRef.Name, field(base, "csi.nodePublishSecretRef.name"))
		}
	}
	for i := range spec.ImagePullSecrets {
		add(SecretDescriptor, namespace, spec.ImagePullSecrets[i].Name, indexed(field(prefix, "imagePullSecrets"), i)+".name")
	}
	extractContainerRefs := func(category string, containers []corev1.Container) {
		for i := range containers {
			container := &containers[i]
			base := indexed(field(prefix, category), i)
			for j := range container.Env {
				env := &container.Env[j]
				if env.ValueFrom == nil {
					continue
				}
				envBase := indexed(field(base, "env"), j)
				if env.ValueFrom.ConfigMapKeyRef != nil {
					add(ConfigMapDescriptor, namespace, env.ValueFrom.ConfigMapKeyRef.Name, field(envBase, "valueFrom.configMapKeyRef.name"))
				}
				if env.ValueFrom.SecretKeyRef != nil {
					add(SecretDescriptor, namespace, env.ValueFrom.SecretKeyRef.Name, field(envBase, "valueFrom.secretKeyRef.name"))
				}
			}
			for j := range container.EnvFrom {
				envFrom := &container.EnvFrom[j]
				envBase := indexed(field(base, "envFrom"), j)
				if envFrom.ConfigMapRef != nil {
					add(ConfigMapDescriptor, namespace, envFrom.ConfigMapRef.Name, field(envBase, "configMapRef.name"))
				}
				if envFrom.SecretRef != nil {
					add(SecretDescriptor, namespace, envFrom.SecretRef.Name, field(envBase, "secretRef.name"))
				}
			}
		}
	}
	extractContainerRefs("initContainers", spec.InitContainers)
	extractContainerRefs("containers", spec.Containers)
	for i := range spec.EphemeralContainers {
		container := &spec.EphemeralContainers[i].EphemeralContainerCommon
		base := indexed(field(prefix, "ephemeralContainers"), i)
		for j := range container.Env {
			env := &container.Env[j]
			if env.ValueFrom == nil {
				continue
			}
			envBase := indexed(field(base, "env"), j)
			if env.ValueFrom.ConfigMapKeyRef != nil {
				add(ConfigMapDescriptor, namespace, env.ValueFrom.ConfigMapKeyRef.Name, field(envBase, "valueFrom.configMapKeyRef.name"))
			}
			if env.ValueFrom.SecretKeyRef != nil {
				add(SecretDescriptor, namespace, env.ValueFrom.SecretKeyRef.Name, field(envBase, "valueFrom.secretKeyRef.name"))
			}
		}
		for j := range container.EnvFrom {
			envFrom := &container.EnvFrom[j]
			envBase := indexed(field(base, "envFrom"), j)
			if envFrom.ConfigMapRef != nil {
				add(ConfigMapDescriptor, namespace, envFrom.ConfigMapRef.Name, field(envBase, "configMapRef.name"))
			}
			if envFrom.SecretRef != nil {
				add(SecretDescriptor, namespace, envFrom.SecretRef.Name, field(envBase, "secretRef.name"))
			}
		}
	}
	return out
}

// StatefulSetServiceReference extracts spec.serviceName.
func StatefulSetServiceReference(namespace, serviceName string) ReferenceExtraction {
	if strings.TrimSpace(serviceName) == "" {
		return ReferenceExtraction{Complete: false}
	}
	return ReferenceExtraction{Complete: true, References: []dto.ResourceReferenceDTO{
		objectReference(ServiceDescriptor, namespace, serviceName, "", "spec.serviceName", dto.ResourceRelationshipEvidenceDTO{}),
	}}
}

// IngressReferences extracts Service backends and TLS Secrets. Resource
// backends are intentionally not inferred and make this family partial.
func IngressReferences(namespace string, spec networkingv1.IngressSpec) ReferenceExtraction {
	out := ReferenceExtraction{Complete: true}
	addBackend := func(backend networkingv1.IngressBackend, path string, evidence map[string]string) {
		if backend.Resource != nil {
			out.Complete = false
			return
		}
		if backend.Service == nil || strings.TrimSpace(backend.Service.Name) == "" {
			out.Complete = false
			return
		}
		port := ""
		if backend.Service.Port.Name != "" {
			port = "name:" + backend.Service.Port.Name
		} else if backend.Service.Port.Number != 0 {
			port = fmt.Sprintf("number:%d", backend.Service.Port.Number)
		} else {
			out.Complete = false
			return
		}
		evidence["port"] = bounded(port)
		out.References = append(out.References, objectReference(ServiceDescriptor, namespace, backend.Service.Name, "", path,
			dto.ResourceRelationshipEvidenceDTO{Description: structuredDescription(evidence)}))
	}
	if spec.DefaultBackend != nil {
		addBackend(*spec.DefaultBackend, "spec.defaultBackend.service.name", map[string]string{"default": "true"})
	}
	for i := range spec.Rules {
		rule := &spec.Rules[i]
		if rule.HTTP == nil {
			continue
		}
		for j := range rule.HTTP.Paths {
			path := &rule.HTTP.Paths[j]
			addBackend(path.Backend, fmt.Sprintf("spec.rules[%d].http.paths[%d].backend.service.name", i, j), map[string]string{
				"default": "false", "host": bounded(rule.Host), "path": bounded(path.Path),
			})
		}
	}
	for i := range spec.TLS {
		if spec.TLS[i].SecretName == "" {
			continue
		}
		evidence := map[string]string{"hosts": bounded(strings.Join(spec.TLS[i].Hosts, ","))}
		out.References = append(out.References, objectReference(SecretDescriptor, namespace, spec.TLS[i].SecretName, "",
			fmt.Sprintf("spec.tls[%d].secretName", i), dto.ResourceRelationshipEvidenceDTO{Description: structuredDescription(evidence)}))
	}
	return out
}

// PersistentVolumeClaimVolumeReference extracts PVC spec.volumeName -> PV.
func PersistentVolumeClaimVolumeReference(volumeName string) ReferenceExtraction {
	if volumeName == "" {
		return ReferenceExtraction{Complete: true}
	}
	return ReferenceExtraction{Complete: true, References: []dto.ResourceReferenceDTO{
		objectReference(PersistentVolumeDescriptor, "", volumeName, "", "spec.volumeName", dto.ResourceRelationshipEvidenceDTO{}),
	}}
}

// PersistentVolumeClaimReference extracts PV spec.claimRef -> PVC.
func PersistentVolumeClaimReference(claimRef *corev1.ObjectReference) ReferenceExtraction {
	if claimRef == nil {
		return ReferenceExtraction{Complete: true}
	}
	if strings.TrimSpace(claimRef.Namespace) == "" || strings.TrimSpace(claimRef.Name) == "" {
		return ReferenceExtraction{Complete: false}
	}
	return ReferenceExtraction{Complete: true, References: []dto.ResourceReferenceDTO{
		objectReference(PersistentVolumeClaimDescriptor, claimRef.Namespace, claimRef.Name, string(claimRef.UID), "spec.claimRef.name", dto.ResourceRelationshipEvidenceDTO{}),
	}}
}

// HPAScaleTargetReference accepts only the exact built-in apps/v1 registry.
func HPAScaleTargetReference(namespace string, target autoscalingv2.CrossVersionObjectReference) ReferenceExtraction {
	descriptor, ok := map[string]IdentityDescriptor{
		"Deployment": DeploymentDescriptor, "ReplicaSet": ReplicaSetDescriptor, "StatefulSet": StatefulSetDescriptor,
	}[target.Kind]
	if !ok || target.APIVersion != "apps/v1" || strings.TrimSpace(target.Name) == "" {
		return ReferenceExtraction{Complete: false}
	}
	return ReferenceExtraction{Complete: true, References: []dto.ResourceReferenceDTO{
		objectReference(descriptor, namespace, target.Name, "", "spec.scaleTargetRef.name", dto.ResourceRelationshipEvidenceDTO{}),
	}}
}

// RoleBindingReferences extracts roleRef and ServiceAccount subjects. User and
// Group subjects are intentionally ignored.
func RoleBindingReferences(namespace string, roleRef rbacv1.RoleRef, subjects []rbacv1.Subject) ReferenceExtraction {
	out := ReferenceExtraction{Complete: true}
	switch roleRef.Kind {
	case "Role":
		addRBACRoleRef(&out, RoleDescriptor, namespace, roleRef)
	case "ClusterRole":
		addRBACRoleRef(&out, ClusterRoleDescriptor, "", roleRef)
	default:
		out.Complete = false
	}
	for i := range subjects {
		subject := subjects[i]
		if subject.Kind != rbacv1.ServiceAccountKind {
			continue
		}
		ns := subject.Namespace
		if ns == "" {
			ns = namespace
		}
		if subject.APIGroup != "" || strings.TrimSpace(subject.Name) == "" || strings.TrimSpace(ns) == "" {
			out.Complete = false
			continue
		}
		out.References = append(out.References, objectReference(ServiceAccountDescriptor, ns, subject.Name, "",
			fmt.Sprintf("subjects[%d].name", i), dto.ResourceRelationshipEvidenceDTO{}))
	}
	return out
}

// ClusterRoleBindingReferences extracts ClusterRole roleRef and requires an
// explicit namespace on ServiceAccount subjects.
func ClusterRoleBindingReferences(roleRef rbacv1.RoleRef, subjects []rbacv1.Subject) ReferenceExtraction {
	out := ReferenceExtraction{Complete: true}
	if roleRef.Kind == "ClusterRole" {
		addRBACRoleRef(&out, ClusterRoleDescriptor, "", roleRef)
	} else {
		out.Complete = false
	}
	for i := range subjects {
		subject := subjects[i]
		if subject.Kind != rbacv1.ServiceAccountKind {
			continue
		}
		if subject.APIGroup != "" || strings.TrimSpace(subject.Name) == "" || strings.TrimSpace(subject.Namespace) == "" {
			out.Complete = false
			continue
		}
		out.References = append(out.References, objectReference(ServiceAccountDescriptor, subject.Namespace, subject.Name, "",
			fmt.Sprintf("subjects[%d].name", i), dto.ResourceRelationshipEvidenceDTO{}))
	}
	return out
}

func addRBACRoleRef(out *ReferenceExtraction, descriptor IdentityDescriptor, namespace string, roleRef rbacv1.RoleRef) {
	if roleRef.APIGroup != rbacv1.GroupName || strings.TrimSpace(roleRef.Name) == "" {
		out.Complete = false
		return
	}
	out.References = append(out.References, objectReference(descriptor, namespace, roleRef.Name, "", "roleRef.name", dto.ResourceRelationshipEvidenceDTO{}))
}

// ServiceAccountReferences extracts secrets and imagePullSecrets.
func ServiceAccountReferences(namespace string, secrets []corev1.ObjectReference, imagePullSecrets []corev1.LocalObjectReference) ReferenceExtraction {
	out := ReferenceExtraction{Complete: true}
	for i := range secrets {
		ref := secrets[i]
		if strings.TrimSpace(ref.Name) == "" {
			out.Complete = false
			continue
		}
		out.References = append(out.References, objectReference(SecretDescriptor, namespace, ref.Name, string(ref.UID),
			fmt.Sprintf("secrets[%d].name", i), dto.ResourceRelationshipEvidenceDTO{}))
	}
	for i := range imagePullSecrets {
		ref := imagePullSecrets[i]
		if strings.TrimSpace(ref.Name) == "" {
			out.Complete = false
			continue
		}
		out.References = append(out.References, objectReference(SecretDescriptor, namespace, ref.Name, "",
			fmt.Sprintf("imagePullSecrets[%d].name", i), dto.ResourceRelationshipEvidenceDTO{}))
	}
	return out
}

// CustomResourceKindDefinition links a dynamic custom resource to the
// authoritative CRD name supplied by discovery.
func CustomResourceKindDefinition(crdName string) ReferenceExtraction {
	if strings.TrimSpace(crdName) == "" {
		return ReferenceExtraction{Complete: false}
	}
	return ReferenceExtraction{Complete: true, References: []dto.ResourceReferenceDTO{{
		Type:   dto.ResourceRelationshipTypeKindDefinition,
		Target: identity(CustomResourceDefinitionDescriptor, "", crdName, ""),
		Source: kubernetesSource("apiVersion/kind"), Coverage: fullComplete,
	}}}
}

func objectReference(descriptor IdentityDescriptor, namespace, name, uid, path string, evidence dto.ResourceRelationshipEvidenceDTO) dto.ResourceReferenceDTO {
	return dto.ResourceReferenceDTO{Type: dto.ResourceRelationshipTypeObjectReference, Target: identity(descriptor, namespace, name, uid),
		Source: kubernetesSource(path), Evidence: evidence, Coverage: fullComplete}
}

func identity(descriptor IdentityDescriptor, namespace, name, uid string) dto.ResourceIdentityDTO {
	if descriptor.Scope == dto.ResourceScopeCluster {
		namespace = ""
	}
	return dto.ResourceIdentityDTO{Group: descriptor.Group, Version: descriptor.Version, Resource: descriptor.Resource,
		Kind: descriptor.Kind, Scope: descriptor.Scope, Namespace: namespace, Name: name, UID: uid}
}

func kubernetesSource(path string) dto.ResourceRelationshipSourceDTO {
	return dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceKubernetes, FieldPath: path}
}

func field(prefix, suffix string) string {
	if prefix == "" {
		return suffix
	}
	return prefix + "." + suffix
}

func indexed(prefix string, index int) string { return fmt.Sprintf("%s[%d]", prefix, index) }

func bounded(value string) string {
	const max = 1024
	if len(value) <= max {
		return value
	}
	return value[:max]
}

func structuredDescription(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+bounded(values[key]))
	}
	return bounded(strings.Join(parts, ";"))
}

func referenceFamily(relationshipType dto.ResourceRelationshipType) (dto.ResourceRelationshipFamily, bool) {
	switch relationshipType {
	case dto.ResourceRelationshipTypeOwnerReference:
		return dto.ResourceRelationshipFamilyOwner, true
	case dto.ResourceRelationshipTypeObjectReference:
		return dto.ResourceRelationshipFamilyObjectReference, true
	case dto.ResourceRelationshipTypeSelector:
		return dto.ResourceRelationshipFamilySelector, true
	case dto.ResourceRelationshipTypeNamespace:
		return dto.ResourceRelationshipFamilyNamespace, true
	case dto.ResourceRelationshipTypeKindDefinition:
		return dto.ResourceRelationshipFamilyKindDefinition, true
	case dto.ResourceRelationshipTypeVirtual:
		return dto.ResourceRelationshipFamilyVirtual, true
	case "":
		return "", false
	default:
		return "", false
	}
}

func cloneCarrier(carrier dto.ResourceRelationshipCarrier) dto.ResourceRelationshipCarrier {
	record := carrier.ResourceRelationshipMetadata()
	return dto.ResourceRelationshipCarrier{Resource: record.Resource, Owners: record.Owners, References: record.References,
		Labels: record.Labels, Selectors: record.Selectors, Coverage: record.Coverage, FamilyCoverage: record.FamilyCoverage}
}

func cloneReference(reference dto.ResourceReferenceDTO) dto.ResourceReferenceDTO {
	out := reference
	out.Evidence.Selector = cloneMap(reference.Evidence.Selector)
	return out
}

func cloneSelectors(selectors []dto.ResourceRelationshipSelectorDTO) []dto.ResourceRelationshipSelectorDTO {
	if selectors == nil {
		return nil
	}
	out := make([]dto.ResourceRelationshipSelectorDTO, len(selectors))
	for i := range selectors {
		out[i] = selectors[i]
		out[i].MatchLabels = cloneMap(selectors[i].MatchLabels)
	}
	return out
}

func cloneMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}
