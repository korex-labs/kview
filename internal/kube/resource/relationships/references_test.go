package relationships

import (
	"reflect"
	"testing"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestEnrichmentHelpersAreImmutableAndDeclareEmptyFamilies(t *testing.T) {
	carrier := Capture(&metav1.ObjectMeta{Name: "api", Namespace: "apps", Labels: map[string]string{"app": "api"}}, PodDescriptor)
	labels := map[string]string{"app": "api"}
	selectorLabels := map[string]string{"app": "api"}
	extraction := SelectorExtraction{Complete: true, Selectors: []dto.ResourceRelationshipSelectorDTO{{
		Target: dto.ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: dto.ResourceScopeNamespaced},
		Source: kubernetesSource("spec.selector"), MatchLabels: selectorLabels, Coverage: fullComplete,
	}}}

	withLabels := WithLabels(carrier, labels)
	withSelectors := WithSelectors(withLabels, extraction)
	withRefs := WithObjectReferences(withSelectors, ReferenceExtraction{Complete: true})
	withKinds := WithKindDefinitions(withRefs, ReferenceExtraction{Complete: true})
	labels["app"] = "mutated"
	selectorLabels["app"] = "mutated"
	withLabels.Labels["app"] = "also-mutated"
	withSelectors.Selectors[0].MatchLabels["app"] = "also-mutated"

	got := withKinds.ResourceRelationshipMetadata()
	if got.Labels["app"] != "api" || got.Selectors[0].MatchLabels["app"] != "api" {
		t.Fatalf("enriched carrier aliases inputs/intermediate carriers: %+v", got)
	}
	for _, family := range []dto.ResourceRelationshipFamily{
		dto.ResourceRelationshipFamilyLabels, dto.ResourceRelationshipFamilySelector,
		dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipFamilyKindDefinition,
	} {
		assertFullCompleteCoverage(t, got.FamilyCoverage[family])
	}
	if len(got.References) != 0 {
		t.Fatalf("empty observations retained references: %+v", got.References)
	}

	partial := WithObjectReferences(carrier, ReferenceExtraction{Complete: false})
	if partial.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference] != partialCoverage || partial.Coverage != partialCoverage {
		t.Fatalf("partial extraction coverage = %+v / %+v", partial.FamilyCoverage, partial.Coverage)
	}
}

func TestServiceSelectorEmptyAndExactMatchLabels(t *testing.T) {
	if got := ServiceSelector(nil); !got.Complete || len(got.Selectors) != 0 {
		t.Fatalf("empty selector = %+v, want complete zero", got)
	}
	labels := map[string]string{"app": "api", "track": "stable"}
	got := ServiceSelector(labels)
	labels["app"] = "mutated"
	if len(got.Selectors) != 1 || got.Selectors[0].MatchLabels["app"] != "api" || got.Selectors[0].Source.FieldPath != "spec.selector" {
		t.Fatalf("selector = %+v", got)
	}
	wantTarget := dto.ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: dto.ResourceScopeNamespaced}
	if got.Selectors[0].Target != wantTarget {
		t.Fatalf("target = %+v, want %+v", got.Selectors[0].Target, wantTarget)
	}
}

func TestPodSpecReferencesPositivePathsAndDefaultServiceAccount(t *testing.T) {
	spec := corev1.PodSpec{
		NodeName: "worker-a",
		Volumes: []corev1.Volume{
			{Name: "pvc", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data"}}},
			{Name: "cm", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "settings"}}}},
			{Name: "secret", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "cert"}}},
			{Name: "projected", VolumeSource: corev1.VolumeSource{Projected: &corev1.ProjectedVolumeSource{Sources: []corev1.VolumeProjection{
				{ConfigMap: &corev1.ConfigMapProjection{LocalObjectReference: corev1.LocalObjectReference{Name: "projected-cm"}}},
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: "projected-secret"}}},
			}}}},
			{Name: "csi", VolumeSource: corev1.VolumeSource{CSI: &corev1.CSIVolumeSource{Driver: "example.test", NodePublishSecretRef: &corev1.LocalObjectReference{Name: "csi-secret"}}}},
		},
		ImagePullSecrets: []corev1.LocalObjectReference{{Name: "registry"}},
		InitContainers:   []corev1.Container{{Env: []corev1.EnvVar{{ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "init-secret"}}}}}}},
		Containers: []corev1.Container{{
			Env:     []corev1.EnvVar{{ValueFrom: &corev1.EnvVarSource{ConfigMapKeyRef: &corev1.ConfigMapKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "env-cm"}}}}},
			EnvFrom: []corev1.EnvFromSource{{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "env-secret"}}}},
		}},
		EphemeralContainers: []corev1.EphemeralContainer{{EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			EnvFrom: []corev1.EnvFromSource{{ConfigMapRef: &corev1.ConfigMapEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "debug-cm"}}}},
		}}},
	}
	got := PodSpecReferences("apps", "spec.template.spec", spec)
	if !got.Complete {
		t.Fatal("valid pod spec unexpectedly partial")
	}
	want := map[string]string{
		"spec.template.spec.nodeName":                                             "worker-a",
		"spec.template.spec.serviceAccountName":                                   "default",
		"spec.template.spec.volumes[0].persistentVolumeClaim.claimName":           "data",
		"spec.template.spec.volumes[1].configMap.name":                            "settings",
		"spec.template.spec.volumes[2].secret.secretName":                         "cert",
		"spec.template.spec.volumes[3].projected.sources[0].configMap.name":       "projected-cm",
		"spec.template.spec.volumes[3].projected.sources[1].secret.name":          "projected-secret",
		"spec.template.spec.volumes[4].csi.nodePublishSecretRef.name":             "csi-secret",
		"spec.template.spec.imagePullSecrets[0].name":                             "registry",
		"spec.template.spec.initContainers[0].env[0].valueFrom.secretKeyRef.name": "init-secret",
		"spec.template.spec.containers[0].env[0].valueFrom.configMapKeyRef.name":  "env-cm",
		"spec.template.spec.containers[0].envFrom[0].secretRef.name":              "env-secret",
		"spec.template.spec.ephemeralContainers[0].envFrom[0].configMapRef.name":  "debug-cm",
	}
	if len(got.References) != len(want) {
		t.Fatalf("references = %d, want %d: %+v", len(got.References), len(want), got.References)
	}
	for _, ref := range got.References {
		name, ok := want[ref.Source.FieldPath]
		if !ok || ref.Target.Name != name || ref.Source.Type != dto.ResourceRelationshipSourceKubernetes {
			t.Fatalf("unexpected reference: %+v", ref)
		}
		if ref.Target.Scope == dto.ResourceScopeNamespaced && ref.Target.Namespace != "apps" {
			t.Fatalf("namespaced target lost namespace: %+v", ref.Target)
		}
	}
}

func TestPodSpecMalformedRelevantFieldsOnlyDowngradeObjectReferenceFamily(t *testing.T) {
	spec := corev1.PodSpec{Volumes: []corev1.Volume{{VolumeSource: corev1.VolumeSource{
		ConfigMap: &corev1.ConfigMapVolumeSource{},
	}}}, Containers: []corev1.Container{{EnvFrom: []corev1.EnvFromSource{{SecretRef: &corev1.SecretEnvSource{}}}}}}
	got := PodSpecReferences("apps", "spec", spec)
	if got.Complete {
		t.Fatal("malformed relevant references reported complete")
	}
	if len(got.References) != 1 || got.References[0].Target.Name != "default" {
		t.Fatalf("malformed targets retained or default SA absent: %+v", got.References)
	}
}

func TestStatefulSetPVCAndPVReferences(t *testing.T) {
	stateful := StatefulSetServiceReference("apps", "headless")
	assertSingleTarget(t, stateful, ServiceDescriptor, "apps", "headless", "spec.serviceName")
	if StatefulSetServiceReference("apps", "").Complete {
		t.Fatal("empty required StatefulSet serviceName reported complete")
	}
	if got := PersistentVolumeClaimVolumeReference(""); !got.Complete || len(got.References) != 0 {
		t.Fatalf("unbound PVC = %+v", got)
	}
	assertSingleTarget(t, PersistentVolumeClaimVolumeReference("pv-a"), PersistentVolumeDescriptor, "", "pv-a", "spec.volumeName")
	claim := &corev1.ObjectReference{Namespace: "apps", Name: "data", UID: types.UID("claim-uid")}
	pv := PersistentVolumeClaimReference(claim)
	if !pv.Complete || len(pv.References) != 1 || pv.References[0].Target != identity(PersistentVolumeClaimDescriptor, "apps", "data", "claim-uid") || pv.References[0].Source.FieldPath != "spec.claimRef.name" {
		t.Fatalf("PV claim reference = %+v", pv)
	}
	if PersistentVolumeClaimReference(&corev1.ObjectReference{Name: "data"}).Complete {
		t.Fatal("claimRef without namespace reported complete")
	}
}

func TestIngressReferencesEvidenceAndMalformedResourceBackend(t *testing.T) {
	resourceAPIGroup := "example.io"
	spec := networkingv1.IngressSpec{
		DefaultBackend: &networkingv1.IngressBackend{
			Service: &networkingv1.IngressServiceBackend{
				Name: "default-api", Port: networkingv1.ServiceBackendPort{Number: 8080},
			},
		},
		Rules: []networkingv1.IngressRule{{
			Host: "api.example.test",
			IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{
				Paths: []networkingv1.HTTPIngressPath{
					{Path: "/v1", Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
						Name: "api", Port: networkingv1.ServiceBackendPort{Name: "http"},
					}}},
					{Path: "/raw", Backend: networkingv1.IngressBackend{Resource: &corev1.TypedLocalObjectReference{
						APIGroup: &resourceAPIGroup, Kind: "Bucket", Name: "assets",
					}}},
				},
			}},
		}},
		TLS: []networkingv1.IngressTLS{{Hosts: []string{"api.example.test"}, SecretName: "tls-cert"}, {}},
	}
	got := IngressReferences("apps", spec)
	if got.Complete || len(got.References) != 3 {
		t.Fatalf("Ingress extraction = %+v, want 3 valid refs and partial", got)
	}
	byPath := referencesByPath(got.References)
	if byPath["spec.defaultBackend.service.name"].Evidence.Description != "default=true;port=number:8080" || byPath["spec.defaultBackend.service.name"].Evidence.Selector != nil {
		t.Fatalf("default evidence = %+v", byPath["spec.defaultBackend.service.name"].Evidence)
	}
	rule := byPath["spec.rules[0].http.paths[0].backend.service.name"]
	if rule.Evidence.Description != "default=false;host=api.example.test;path=/v1;port=name:http" || rule.Evidence.Selector != nil {
		t.Fatalf("rule evidence = %+v", rule.Evidence)
	}
	if _, exists := byPath["spec.rules[0].http.paths[1].backend.service.name"]; exists {
		t.Fatal("resource backend fabricated a target")
	}
}

func TestIngressReferencesSurviveCarrierNormalization(t *testing.T) {
	spec := networkingv1.IngressSpec{
		DefaultBackend: &networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
			Name: "default-api", Port: networkingv1.ServiceBackendPort{Number: 8080},
		}},
		Rules: []networkingv1.IngressRule{{
			Host: "api.example.test,edge.example.test",
			IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{Paths: []networkingv1.HTTPIngressPath{{
				Path: "/v1", Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
					Name: "api", Port: networkingv1.ServiceBackendPort{Name: "http"},
				}},
			}}}},
		}},
		TLS: []networkingv1.IngressTLS{{Hosts: []string{"api.example.test", "edge.example.test,canary.example.test"}, SecretName: "tls-cert"}},
	}
	carrier := Capture(&metav1.ObjectMeta{Name: "public", Namespace: "apps"}, IngressDescriptor)
	records := dto.NormalizeResourceRelationshipRecords([]dto.ResourceRelationshipRecord{
		WithObjectReferences(carrier, IngressReferences("apps", spec)).ResourceRelationshipMetadata(),
	})
	if len(records) != 1 || len(records[0].References) != 3 {
		t.Fatalf("normalized ingress references = %+v, want all three valid references", records)
	}
	assertFullCompleteCoverage(t, records[0].FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference])
	assertFullCompleteCoverage(t, records[0].Coverage)
	byPath := referencesByPath(records[0].References)
	wantDescriptions := map[string]string{
		"spec.defaultBackend.service.name":                 "default=true;port=number:8080",
		"spec.rules[0].http.paths[0].backend.service.name": "default=false;host=api.example.test,edge.example.test;path=/v1;port=name:http",
		"spec.tls[0].secretName":                           "hosts=api.example.test,edge.example.test,canary.example.test",
	}
	for path, description := range wantDescriptions {
		ref, ok := byPath[path]
		if !ok || ref.Evidence.Description != description || ref.Evidence.Selector != nil {
			t.Fatalf("normalized evidence at %q = %+v, want description %q and nil selector", path, ref.Evidence, description)
		}
	}
}

func TestReferenceHelpersAcceptOnlyTheirTypedFamily(t *testing.T) {
	types := []struct {
		name             string
		relationshipType dto.ResourceRelationshipType
	}{
		{"ownerReference", dto.ResourceRelationshipTypeOwnerReference},
		{"objectReference", dto.ResourceRelationshipTypeObjectReference},
		{"selector", dto.ResourceRelationshipTypeSelector},
		{"namespace", dto.ResourceRelationshipTypeNamespace},
		{"kindDefinition", dto.ResourceRelationshipTypeKindDefinition},
		{"virtual", dto.ResourceRelationshipTypeVirtual},
		{"unknown", dto.ResourceRelationshipType("future")},
		{"empty", ""},
	}
	helpers := []struct {
		name     string
		family   dto.ResourceRelationshipFamily
		accepted dto.ResourceRelationshipType
		enrich   func(dto.ResourceRelationshipCarrier, ReferenceExtraction) dto.ResourceRelationshipCarrier
	}{
		{"object", dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipTypeObjectReference, WithObjectReferences},
		{"kind definition", dto.ResourceRelationshipFamilyKindDefinition, dto.ResourceRelationshipTypeKindDefinition, WithKindDefinitions},
	}
	for _, helper := range helpers {
		for _, relationshipType := range types {
			t.Run(helper.name+"/"+relationshipType.name, func(t *testing.T) {
				carrier := Capture(&metav1.ObjectMeta{Name: "source", Namespace: "apps"}, PodDescriptor)
				reference := objectReference(ServiceDescriptor, "apps", "target", "", "spec.target", dto.ResourceRelationshipEvidenceDTO{})
				reference.Type = relationshipType.relationshipType
				got := helper.enrich(carrier, ReferenceExtraction{Complete: true, References: []dto.ResourceReferenceDTO{reference}})
				if relationshipType.relationshipType == helper.accepted {
					if len(got.References) != 1 {
						t.Fatalf("accepted type %q was dropped: %+v", relationshipType.relationshipType, got)
					}
					assertFullCompleteCoverage(t, got.FamilyCoverage[helper.family])
					return
				}
				if len(got.References) != 0 || got.FamilyCoverage[helper.family] != partialCoverage || got.Coverage != partialCoverage {
					t.Fatalf("mismatched type %q was not dropped as partial: %+v", relationshipType.relationshipType, got)
				}
			})
		}
	}
}

func TestHPAExactRegistryAndExclusions(t *testing.T) {
	for _, kind := range []string{"Deployment", "ReplicaSet", "StatefulSet"} {
		got := HPAScaleTargetReference("apps", autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: kind, Name: "api"})
		if !got.Complete || len(got.References) != 1 || got.References[0].Target.Kind != kind {
			t.Fatalf("supported HPA %s = %+v", kind, got)
		}
	}
	for _, target := range []autoscalingv2.CrossVersionObjectReference{
		{APIVersion: "apps/v1", Kind: "DaemonSet", Name: "api"},
		{APIVersion: "apps/v1beta1", Kind: "Deployment", Name: "api"},
		{APIVersion: "apps/v1", Kind: "Deployment"},
	} {
		got := HPAScaleTargetReference("apps", target)
		if got.Complete || len(got.References) != 0 {
			t.Fatalf("unsupported/malformed HPA retained target: %+v", got)
		}
	}
}

func TestRBACReferencesNamespacesSubjectsAndMalformed(t *testing.T) {
	roleRef := rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"}
	subjects := []rbacv1.Subject{
		{Kind: rbacv1.UserKind, APIGroup: rbacv1.GroupName, Name: "alex"},
		{Kind: rbacv1.GroupKind, APIGroup: rbacv1.GroupName, Name: "ops"},
		{Kind: rbacv1.ServiceAccountKind, Name: "default"},
		{Kind: rbacv1.ServiceAccountKind, Namespace: "other", Name: "robot"},
	}
	got := RoleBindingReferences("apps", roleRef, subjects)
	if !got.Complete || len(got.References) != 3 {
		t.Fatalf("RoleBinding refs = %+v", got)
	}
	if got.References[1].Target.Namespace != "apps" || got.References[2].Target.Namespace != "other" {
		t.Fatalf("subject namespace resolution = %+v", got.References)
	}
	cluster := ClusterRoleBindingReferences(
		rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "view"},
		[]rbacv1.Subject{{Kind: rbacv1.ServiceAccountKind, Name: "missing-ns"}, {Kind: rbacv1.ServiceAccountKind, Namespace: "apps", Name: "robot"}},
	)
	if cluster.Complete || len(cluster.References) != 2 {
		t.Fatalf("ClusterRoleBinding refs = %+v", cluster)
	}
	if RoleBindingReferences("apps", rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role"}, nil).Complete {
		t.Fatal("malformed supported roleRef reported complete")
	}
}

func TestServiceAccountAndCustomResourceDefinitionReferences(t *testing.T) {
	got := ServiceAccountReferences("apps",
		[]corev1.ObjectReference{{Name: "token", UID: types.UID("secret-uid")}, {}},
		[]corev1.LocalObjectReference{{Name: "registry"}},
	)
	if got.Complete || len(got.References) != 2 {
		t.Fatalf("ServiceAccount refs = %+v", got)
	}
	if got.References[0].Source.FieldPath != "secrets[0].name" || got.References[0].Target.UID != "secret-uid" || got.References[1].Source.FieldPath != "imagePullSecrets[0].name" {
		t.Fatalf("ServiceAccount evidence = %+v", got.References)
	}
	kind := CustomResourceKindDefinition("widgets.example.io")
	if !kind.Complete || len(kind.References) != 1 || kind.References[0].Type != dto.ResourceRelationshipTypeKindDefinition || kind.References[0].Target.Name != "widgets.example.io" {
		t.Fatalf("kind definition = %+v", kind)
	}
	if CustomResourceKindDefinition("").Complete {
		t.Fatal("empty authoritative CRD name reported complete")
	}
}

func TestFamilyCoverageMergesMonotonicWorstOnEachAxis(t *testing.T) {
	coverageCases := []struct {
		name     string
		existing dto.ResourceRelationshipCoverage
		complete dto.ResourceRelationshipCoverage
		partial  dto.ResourceRelationshipCoverage
	}{
		{"unknown", dto.ResourceRelationshipCoverageUnknown, dto.ResourceRelationshipCoverageUnknown, dto.ResourceRelationshipCoverageUnknown},
		{"partial", dto.ResourceRelationshipCoveragePartial, dto.ResourceRelationshipCoveragePartial, dto.ResourceRelationshipCoveragePartial},
		{"full", dto.ResourceRelationshipCoverageFull, dto.ResourceRelationshipCoverageFull, dto.ResourceRelationshipCoveragePartial},
	}
	completenessCases := []struct {
		name     string
		existing dto.ResourceRelationshipCompleteness
		complete dto.ResourceRelationshipCompleteness
		partial  dto.ResourceRelationshipCompleteness
	}{
		{"unknown", dto.ResourceRelationshipCompletenessUnknown, dto.ResourceRelationshipCompletenessUnknown, dto.ResourceRelationshipCompletenessUnknown},
		{"partial", dto.ResourceRelationshipCompletenessPartial, dto.ResourceRelationshipCompletenessPartial, dto.ResourceRelationshipCompletenessPartial},
		{"complete", dto.ResourceRelationshipCompletenessComplete, dto.ResourceRelationshipCompletenessComplete, dto.ResourceRelationshipCompletenessPartial},
	}
	for _, coverageCase := range coverageCases {
		for _, completenessCase := range completenessCases {
			for _, incomingComplete := range []bool{true, false} {
				name := coverageCase.name + "/" + completenessCase.name
				if incomingComplete {
					name += "/full"
				} else {
					name += "/partial"
				}
				t.Run(name, func(t *testing.T) {
					existing := dto.ResourceRelationshipCoverageDTO{Coverage: coverageCase.existing, Completeness: completenessCase.existing}
					carrier := dto.ResourceRelationshipCarrier{
						Coverage: existing,
						FamilyCoverage: map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{
							dto.ResourceRelationshipFamilyObjectReference: existing,
						},
					}
					setFamilyCoverage(&carrier, dto.ResourceRelationshipFamilyObjectReference, incomingComplete)
					want := dto.ResourceRelationshipCoverageDTO{Coverage: coverageCase.partial, Completeness: completenessCase.partial}
					if incomingComplete {
						want = dto.ResourceRelationshipCoverageDTO{Coverage: coverageCase.complete, Completeness: completenessCase.complete}
					}
					if carrier.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference] != want || carrier.Coverage != want {
						t.Fatalf("merged coverage = %+v / %+v, want %+v", carrier.FamilyCoverage, carrier.Coverage, want)
					}
				})
			}
		}
	}
	carrier := dto.ResourceRelationshipCarrier{}
	setFamilyCoverage(&carrier, dto.ResourceRelationshipFamilyObjectReference, true)
	if carrier.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference] != fullComplete || carrier.Coverage != fullComplete {
		t.Fatalf("absent coverage did not adopt incoming coverage: %+v", carrier)
	}
}

func TestStatefulSetObjectReferenceEnrichmentRemainsPartialInEitherOrder(t *testing.T) {
	malformedPodSpec := PodSpecReferences("apps", "spec.template.spec", corev1.PodSpec{
		Volumes: []corev1.Volume{{VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{}}}},
	})
	service := StatefulSetServiceReference("apps", "headless")
	base := Capture(&metav1.ObjectMeta{Name: "database", Namespace: "apps"}, StatefulSetDescriptor)
	orders := []struct {
		name          string
		first, second ReferenceExtraction
	}{
		{"malformed then service", malformedPodSpec, service},
		{"service then malformed", service, malformedPodSpec},
	}
	for _, order := range orders {
		t.Run(order.name, func(t *testing.T) {
			got := WithObjectReferences(WithObjectReferences(base, order.first), order.second)
			if got.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference] != partialCoverage || got.Coverage != partialCoverage {
				t.Fatalf("coverage was upgraded after enrichment: %+v / %+v", got.FamilyCoverage, got.Coverage)
			}
			if len(got.References) != 2 {
				t.Fatalf("valid references were not retained: %+v", got.References)
			}
			byPath := referencesByPath(got.References)
			if byPath["spec.template.spec.serviceAccountName"].Target.Name != "default" || byPath["spec.serviceName"].Target.Name != "headless" {
				t.Fatalf("unexpected retained references: %+v", got.References)
			}
		})
	}
}

func TestExtractionOrderNamespaceIsolationAndNormalizationDedupAreStable(t *testing.T) {
	spec := corev1.PodSpec{ServiceAccountName: "api", ImagePullSecrets: []corev1.LocalObjectReference{{Name: "z"}, {Name: "a"}}}
	first := PodSpecReferences("apps", "spec", spec)
	second := PodSpecReferences("apps", "spec", spec)
	otherNamespace := PodSpecReferences("other", "spec", spec)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same input produced unstable output:\n%+v\n%+v", first, second)
	}
	if first.References[0].Target.Namespace == otherNamespace.References[0].Target.Namespace {
		t.Fatalf("same-name references collided across namespaces: %+v / %+v", first.References[0], otherNamespace.References[0])
	}
	paths := []string{first.References[0].Source.FieldPath, first.References[1].Source.FieldPath, first.References[2].Source.FieldPath}
	want := []string{"spec.serviceAccountName", "spec.imagePullSecrets[0].name", "spec.imagePullSecrets[1].name"}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("paths = %v, want %v", paths, want)
	}

	carrier := Capture(&metav1.ObjectMeta{Name: "pod", Namespace: "apps"}, PodDescriptor)
	duplicate := first.References[0]
	records := dto.NormalizeResourceRelationshipRecords([]dto.ResourceRelationshipRecord{
		WithObjectReferences(carrier, ReferenceExtraction{Complete: true, References: []dto.ResourceReferenceDTO{duplicate, duplicate}}).ResourceRelationshipMetadata(),
	})
	if len(records) != 1 || len(records[0].References) != 1 {
		t.Fatalf("normalization did not exactly deduplicate helper output: %+v", records)
	}
}

func assertSingleTarget(t *testing.T, got ReferenceExtraction, descriptor IdentityDescriptor, namespace, name, path string) {
	t.Helper()
	if !got.Complete || len(got.References) != 1 {
		t.Fatalf("extraction = %+v, want one complete target", got)
	}
	want := identity(descriptor, namespace, name, "")
	if got.References[0].Target != want || got.References[0].Source.FieldPath != path {
		t.Fatalf("reference = %+v, want target %+v path %q", got.References[0], want, path)
	}
}

func referencesByPath(refs []dto.ResourceReferenceDTO) map[string]dto.ResourceReferenceDTO {
	out := make(map[string]dto.ResourceReferenceDTO, len(refs))
	for _, ref := range refs {
		out[ref.Source.FieldPath] = ref
	}
	return out
}
