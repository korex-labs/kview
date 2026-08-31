package dto

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"k8s.io/apimachinery/pkg/util/validation"
)

const (
	ResourceRelationshipRecordVersion           = 1
	ResourceRelationshipSnapshotMetadataVersion = 1
	ResourceRelationshipMaxLabels               = 64
	ResourceRelationshipMaxLabelBytes           = 16 * 1024
	ResourceRelationshipMaxSelectorMatchLabels  = 32
	ResourceRelationshipMaxSelectorBytes        = 8 * 1024
	ResourceRelationshipMaxSelectors            = 32
	ResourceRelationshipMaxSelectorsBytes       = 16 * 1024
)

type ResourceScope string

const (
	ResourceScopeNamespaced ResourceScope = "namespaced"
	ResourceScopeCluster    ResourceScope = "cluster"
)

// ResourceIdentityDTO identifies one Kubernetes resource independently of the
// active context. Context is intentionally owned by the dataplane/server.
type ResourceIdentityDTO struct {
	Group     string        `json:"group"`
	Version   string        `json:"version"`
	Resource  string        `json:"resource"`
	Kind      string        `json:"kind"`
	Scope     ResourceScope `json:"scope"`
	Namespace string        `json:"namespace,omitempty"`
	Name      string        `json:"name"`
	UID       string        `json:"uid,omitempty"`
}

func (r ResourceIdentityDTO) Validate() error {
	if strings.TrimSpace(r.Version) == "" || strings.TrimSpace(r.Resource) == "" || strings.TrimSpace(r.Kind) == "" || strings.TrimSpace(r.Name) == "" {
		return errors.New("resource identity requires version, resource, kind, and name")
	}
	switch r.Scope {
	case ResourceScopeNamespaced:
		if strings.TrimSpace(r.Namespace) == "" {
			return errors.New("namespaced resource identity requires namespace")
		}
	case ResourceScopeCluster:
		if r.Namespace != "" {
			return errors.New("cluster resource identity must not include namespace")
		}
	default:
		return fmt.Errorf("unsupported resource scope %q", r.Scope)
	}
	return nil
}

// CanonicalIdentity returns a stable, collision-safe key. Length-prefixing
// keeps field boundaries unambiguous without depending on display escaping.
func (r ResourceIdentityDTO) CanonicalIdentity() string {
	parts := []string{r.Group, r.Version, r.Resource, r.Kind, string(r.Scope), r.Namespace, r.Name, r.UID}
	var out strings.Builder
	for _, part := range parts {
		fmt.Fprintf(&out, "%d:%s", len(part), part)
	}
	return out.String()
}

// ResourceOwnerReferenceDTO retains every Kubernetes ownerReference field.
// Pointer booleans preserve absent versus explicitly false values.
type ResourceOwnerReferenceDTO struct {
	APIVersion         string `json:"apiVersion"`
	Kind               string `json:"kind"`
	Name               string `json:"name"`
	UID                string `json:"uid"`
	Controller         *bool  `json:"controller,omitempty"`
	BlockOwnerDeletion *bool  `json:"blockOwnerDeletion,omitempty"`
}

type ResourceRelationshipType string

const (
	ResourceRelationshipTypeOwnerReference  ResourceRelationshipType = "ownerReference"
	ResourceRelationshipTypeObjectReference ResourceRelationshipType = "objectReference"
	ResourceRelationshipTypeSelector        ResourceRelationshipType = "selector"
	ResourceRelationshipTypeNamespace       ResourceRelationshipType = "namespace"
	ResourceRelationshipTypeKindDefinition  ResourceRelationshipType = "kindDefinition"
	ResourceRelationshipTypeVirtual         ResourceRelationshipType = "virtual"
)

type ResourceRelationshipFamily string

const (
	ResourceRelationshipFamilyOwner           ResourceRelationshipFamily = "owner"
	ResourceRelationshipFamilyObjectReference ResourceRelationshipFamily = "objectReference"
	ResourceRelationshipFamilyKindDefinition  ResourceRelationshipFamily = "kindDefinition"
	ResourceRelationshipFamilySelector        ResourceRelationshipFamily = "selector"
	ResourceRelationshipFamilyLabels          ResourceRelationshipFamily = "labels"
	ResourceRelationshipFamilyNamespace       ResourceRelationshipFamily = "namespace"
	ResourceRelationshipFamilyVirtual         ResourceRelationshipFamily = "virtual"
)

type ResourceRelationshipSource string

const (
	ResourceRelationshipSourceKubernetes ResourceRelationshipSource = "kubernetes"
	ResourceRelationshipSourceProduct    ResourceRelationshipSource = "product"
)

type ResourceRelationshipCoverage string

const (
	ResourceRelationshipCoverageUnknown ResourceRelationshipCoverage = "unknown"
	ResourceRelationshipCoveragePartial ResourceRelationshipCoverage = "partial"
	ResourceRelationshipCoverageFull    ResourceRelationshipCoverage = "full"
)

type ResourceRelationshipCompleteness string

const (
	ResourceRelationshipCompletenessUnknown  ResourceRelationshipCompleteness = "unknown"
	ResourceRelationshipCompletenessPartial  ResourceRelationshipCompleteness = "partial"
	ResourceRelationshipCompletenessComplete ResourceRelationshipCompleteness = "complete"
)

type ResourceRelationshipSourceDTO struct {
	Type      ResourceRelationshipSource `json:"type"`
	FieldPath string                     `json:"fieldPath,omitempty"`
}

// ResourceRelationshipEvidenceDTO carries explicit reference evidence. The
// legacy Selector field remains for v1 compatibility; new selector evidence is
// persisted in ResourceRelationshipSelectorDTO instead.
type ResourceRelationshipEvidenceDTO struct {
	Description string            `json:"description,omitempty"`
	Selector    map[string]string `json:"selector,omitempty"`
}

type ResourceRelationshipCoverageDTO struct {
	Coverage     ResourceRelationshipCoverage     `json:"coverage"`
	Completeness ResourceRelationshipCompleteness `json:"completeness"`
}

// ResourceReferenceDTO describes an explicit or derived concrete target.
type ResourceReferenceDTO struct {
	Type     ResourceRelationshipType        `json:"type"`
	Target   ResourceIdentityDTO             `json:"target"`
	Source   ResourceRelationshipSourceDTO   `json:"source"`
	Evidence ResourceRelationshipEvidenceDTO `json:"evidence,omitempty"`
	Coverage ResourceRelationshipCoverageDTO `json:"coverage"`
}

// ResourceRelationshipSelectorTargetDTO identifies a selector's target type,
// never a fabricated concrete object. For namespaced targets, the namespace is
// inherited from the source record.
type ResourceRelationshipSelectorTargetDTO struct {
	Group    string        `json:"group"`
	Version  string        `json:"version"`
	Resource string        `json:"resource"`
	Kind     string        `json:"kind"`
	Scope    ResourceScope `json:"scope"`
}

type ResourceRelationshipSelectorDTO struct {
	Target      ResourceRelationshipSelectorTargetDTO `json:"target"`
	Source      ResourceRelationshipSourceDTO         `json:"source"`
	MatchLabels map[string]string                     `json:"matchLabels"`
	Coverage    ResourceRelationshipCoverageDTO       `json:"coverage"`
}

type ResourceRelationshipRecord struct {
	Version        int                                                            `json:"version"`
	Resource       ResourceIdentityDTO                                            `json:"resource"`
	Owners         []ResourceOwnerReferenceDTO                                    `json:"owners,omitempty"`
	References     []ResourceReferenceDTO                                         `json:"references,omitempty"`
	Labels         map[string]string                                              `json:"labels,omitempty"`
	Selectors      []ResourceRelationshipSelectorDTO                              `json:"selectors,omitempty"`
	Coverage       ResourceRelationshipCoverageDTO                                `json:"coverage"`
	FamilyCoverage map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO `json:"familyCoverage,omitempty"`
}

// ResourceRelationshipSnapshotMetadata proves which family extractors ran,
// including successful observations that produced no items or evidence.
type ResourceRelationshipSnapshotMetadata struct {
	Version         int                                                            `json:"version"`
	FamilyCoverage  map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO `json:"familyCoverage,omitempty"`
	SourceItems     int                                                            `json:"sourceItems"`
	EvidenceRecords int                                                            `json:"evidenceRecords"`
}

// ResourceRelationshipCarrier is embedded in list DTOs with json:"-".
type ResourceRelationshipCarrier struct {
	Resource       ResourceIdentityDTO
	Owners         []ResourceOwnerReferenceDTO
	References     []ResourceReferenceDTO
	Labels         map[string]string
	Selectors      []ResourceRelationshipSelectorDTO
	Coverage       ResourceRelationshipCoverageDTO
	FamilyCoverage map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO
}

type ResourceRelationshipMetadataProvider interface {
	ResourceRelationshipMetadata() ResourceRelationshipRecord
}

func (c ResourceRelationshipCarrier) ResourceRelationshipMetadata() ResourceRelationshipRecord {
	return cloneResourceRelationshipRecord(ResourceRelationshipRecord{
		Version:        ResourceRelationshipRecordVersion,
		Resource:       c.Resource,
		Owners:         c.Owners,
		References:     c.References,
		Labels:         c.Labels,
		Selectors:      c.Selectors,
		Coverage:       c.Coverage,
		FamilyCoverage: c.FamilyCoverage,
	})
}

// ExtractResourceRelationships preserves raw order and duplicates. Snapshot
// execution is the single authoritative normalization boundary.
func ExtractResourceRelationships[I any](items []I) []ResourceRelationshipRecord {
	out := make([]ResourceRelationshipRecord, 0, len(items))
	for i := range items {
		provider, ok := any(items[i]).(ResourceRelationshipMetadataProvider)
		if !ok {
			continue
		}
		out = append(out, provider.ResourceRelationshipMetadata())
	}
	return out
}

// NormalizeResourceRelationshipRecords defensively copies and validates all
// mutable evidence, then deterministically sorts and exactly deduplicates it.
// Invalid bounded evidence is discarded whole and only its family is degraded.
func NormalizeResourceRelationshipRecords(records []ResourceRelationshipRecord) []ResourceRelationshipRecord {
	if records == nil {
		return nil
	}
	type keyedRecord struct {
		key     string
		encoded string
		record  ResourceRelationshipRecord
	}
	keyed := make([]keyedRecord, 0, len(records))
	for _, record := range records {
		cloned := cloneResourceRelationshipRecordWithBoundedSelectors(record)
		if cloned.Version == 0 {
			cloned.Version = ResourceRelationshipRecordVersion
		}
		normalizeRecordEvidence(&cloned)
		payload, _ := json.Marshal(cloned)
		keyed = append(keyed, keyedRecord{key: resourceRelationshipSortKey(cloned.Resource), encoded: string(payload), record: cloned})
	}
	sort.SliceStable(keyed, func(i, j int) bool {
		if keyed[i].key != keyed[j].key {
			return keyed[i].key < keyed[j].key
		}
		return keyed[i].encoded < keyed[j].encoded
	})
	out := make([]ResourceRelationshipRecord, 0, len(keyed))
	previous := ""
	for i, item := range keyed {
		if i > 0 && item.encoded == previous {
			continue
		}
		out = append(out, item.record)
		previous = item.encoded
	}
	return out
}

func NormalizeResourceRelationshipSnapshotMetadata(metadata *ResourceRelationshipSnapshotMetadata) *ResourceRelationshipSnapshotMetadata {
	if metadata == nil {
		return nil
	}
	out := *metadata
	if out.Version == 0 {
		out.Version = ResourceRelationshipSnapshotMetadataVersion
	}
	out.FamilyCoverage = cloneFamilyCoverage(metadata.FamilyCoverage)
	return &out
}

func cloneResourceRelationshipRecordWithBoundedSelectors(record ResourceRelationshipRecord) ResourceRelationshipRecord {
	invalid := len(record.Selectors) > ResourceRelationshipMaxSelectors
	if !invalid {
		for _, selector := range record.Selectors {
			if len(selector.MatchLabels) > ResourceRelationshipMaxSelectorMatchLabels {
				invalid = true
				break
			}
		}
	}
	if invalid {
		record.Selectors = nil
	}
	cloned := cloneResourceRelationshipRecord(record)
	if invalid {
		degradeFamily(&cloned, ResourceRelationshipFamilySelector)
	}
	return cloned
}

func normalizeRecordEvidence(record *ResourceRelationshipRecord) {
	invalidFamilies := make(map[ResourceRelationshipFamily]bool)
	unknownRelationshipType := false
	for _, owner := range record.Owners {
		if strings.TrimSpace(owner.APIVersion) == "" || strings.TrimSpace(owner.Kind) == "" || strings.TrimSpace(owner.Name) == "" || strings.TrimSpace(owner.UID) == "" {
			invalidFamilies[ResourceRelationshipFamilyOwner] = true
			break
		}
	}

	if record.Labels != nil && !validLabelMap(record.Labels, ResourceRelationshipMaxLabels, ResourceRelationshipMaxLabelBytes) {
		record.Labels = nil
		degradeFamily(record, ResourceRelationshipFamilyLabels)
	} else if len(record.Labels) == 0 {
		record.Labels = nil
	}

	if len(record.Selectors) > ResourceRelationshipMaxSelectors {
		invalidFamilies[ResourceRelationshipFamilySelector] = true
	} else {
		selectorBytes := 0
		for _, selector := range record.Selectors {
			if len(selector.MatchLabels) > ResourceRelationshipMaxSelectorMatchLabels {
				invalidFamilies[ResourceRelationshipFamilySelector] = true
				break
			}
			selectorBytes += resourceRelationshipSelectorBytes(selector)
			if selectorBytes > ResourceRelationshipMaxSelectorsBytes || !validSelectorTarget(selector.Target, record.Resource) || !validLabelMap(selector.MatchLabels, ResourceRelationshipMaxSelectorMatchLabels, ResourceRelationshipMaxSelectorBytes) {
				invalidFamilies[ResourceRelationshipFamilySelector] = true
				break
			}
		}
	}

	for _, reference := range record.References {
		family, mapped := relationshipFamilyForType(reference.Type)
		if !mapped {
			unknownRelationshipType = true
			continue
		}
		if reference.Target.Validate() != nil || (reference.Evidence.Selector != nil && !validLabelMap(reference.Evidence.Selector, ResourceRelationshipMaxSelectorMatchLabels, ResourceRelationshipMaxSelectorBytes)) {
			invalidFamilies[family] = true
		}
	}
	for family := range invalidFamilies {
		degradeFamily(record, family)
	}
	if unknownRelationshipType {
		degradeRelationshipCoverage(&record.Coverage)
	}
	if invalidFamilies[ResourceRelationshipFamilyOwner] {
		record.Owners = nil
	} else {
		record.Owners = exactSortDedup(record.Owners)
		if len(record.Owners) == 0 {
			record.Owners = nil
		}
	}
	if invalidFamilies[ResourceRelationshipFamilySelector] {
		record.Selectors = nil
	} else {
		record.Selectors = exactSortDedup(record.Selectors)
		if len(record.Selectors) == 0 {
			record.Selectors = nil
		}
	}
	references := make([]ResourceReferenceDTO, 0, len(record.References))
	for _, reference := range record.References {
		family, mapped := relationshipFamilyForType(reference.Type)
		if !mapped || invalidFamilies[family] {
			continue
		}
		references = append(references, reference)
	}
	record.References = exactSortDedup(references)
	if len(record.References) == 0 {
		record.References = nil
	}
}

func exactSortDedup[T any](values []T) []T {
	if values == nil {
		return nil
	}
	type keyed struct {
		encoded string
		value   T
	}
	items := make([]keyed, 0, len(values))
	for _, value := range values {
		payload, _ := json.Marshal(value)
		items = append(items, keyed{encoded: string(payload), value: value})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].encoded < items[j].encoded })
	out := make([]T, 0, len(items))
	previous := ""
	for i, item := range items {
		if i > 0 && item.encoded == previous {
			continue
		}
		out = append(out, item.value)
		previous = item.encoded
	}
	return out
}

func validSelectorTarget(target ResourceRelationshipSelectorTargetDTO, source ResourceIdentityDTO) bool {
	if strings.TrimSpace(target.Version) == "" || strings.TrimSpace(target.Resource) == "" || strings.TrimSpace(target.Kind) == "" {
		return false
	}
	switch target.Scope {
	case ResourceScopeCluster:
		return true
	case ResourceScopeNamespaced:
		return source.Scope == ResourceScopeNamespaced && strings.TrimSpace(source.Namespace) != ""
	default:
		return false
	}
}

func resourceRelationshipSelectorBytes(selector ResourceRelationshipSelectorDTO) int {
	total := len(selector.Target.Group) + len(selector.Target.Version) + len(selector.Target.Resource) + len(selector.Target.Kind) + len(selector.Target.Scope) + len(selector.Source.Type) + len(selector.Source.FieldPath)
	for key, value := range selector.MatchLabels {
		total += len(key) + len(value)
	}
	return total
}

func validLabelMap(values map[string]string, maxEntries, maxBytes int) bool {
	if len(values) > maxEntries {
		return false
	}
	total := 0
	for key, value := range values {
		if !utf8.ValidString(key) || !utf8.ValidString(value) || len(validation.IsQualifiedName(key)) != 0 || len(validation.IsValidLabelValue(value)) != 0 {
			return false
		}
		total += len(key) + len(value)
		if total > maxBytes {
			return false
		}
	}
	return true
}

func degradeFamily(record *ResourceRelationshipRecord, family ResourceRelationshipFamily) {
	if family == "" {
		return
	}
	if record.FamilyCoverage == nil {
		record.FamilyCoverage = make(map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO)
	}
	coverage, exists := record.FamilyCoverage[family]
	if !exists {
		coverage = ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoveragePartial, Completeness: ResourceRelationshipCompletenessPartial}
	} else {
		if coverage.Coverage == ResourceRelationshipCoverageFull {
			coverage.Coverage = ResourceRelationshipCoveragePartial
		}
		if coverage.Completeness == ResourceRelationshipCompletenessComplete {
			coverage.Completeness = ResourceRelationshipCompletenessPartial
		}
	}
	record.FamilyCoverage[family] = coverage
	degradeRelationshipCoverage(&record.Coverage)
}

func degradeRelationshipCoverage(coverage *ResourceRelationshipCoverageDTO) {
	switch coverage.Coverage {
	case ResourceRelationshipCoverageFull:
		coverage.Coverage = ResourceRelationshipCoveragePartial
	case ResourceRelationshipCoveragePartial, ResourceRelationshipCoverageUnknown:
	default:
		coverage.Coverage = ResourceRelationshipCoverageUnknown
	}
	switch coverage.Completeness {
	case ResourceRelationshipCompletenessComplete:
		coverage.Completeness = ResourceRelationshipCompletenessPartial
	case ResourceRelationshipCompletenessPartial, ResourceRelationshipCompletenessUnknown:
	default:
		coverage.Completeness = ResourceRelationshipCompletenessUnknown
	}
}

var relationshipTypeFamilies = map[ResourceRelationshipType]ResourceRelationshipFamily{
	ResourceRelationshipTypeOwnerReference:  ResourceRelationshipFamilyOwner,
	ResourceRelationshipTypeObjectReference: ResourceRelationshipFamilyObjectReference,
	ResourceRelationshipTypeSelector:        ResourceRelationshipFamilySelector,
	ResourceRelationshipTypeNamespace:       ResourceRelationshipFamilyNamespace,
	ResourceRelationshipTypeKindDefinition:  ResourceRelationshipFamilyKindDefinition,
	ResourceRelationshipTypeVirtual:         ResourceRelationshipFamilyVirtual,
}

func relationshipFamilyForType(relationshipType ResourceRelationshipType) (ResourceRelationshipFamily, bool) {
	family, ok := relationshipTypeFamilies[relationshipType]
	return family, ok
}

func resourceRelationshipSortKey(resource ResourceIdentityDTO) string {
	return strings.Join([]string{resource.Group, resource.Version, resource.Resource, resource.Kind, string(resource.Scope), resource.Namespace, resource.Name, resource.UID}, "\x00")
}

func cloneResourceRelationshipRecord(record ResourceRelationshipRecord) ResourceRelationshipRecord {
	out := record
	if record.Owners != nil {
		out.Owners = make([]ResourceOwnerReferenceDTO, len(record.Owners))
		for i, owner := range record.Owners {
			out.Owners[i] = owner
			out.Owners[i].Controller = cloneBool(owner.Controller)
			out.Owners[i].BlockOwnerDeletion = cloneBool(owner.BlockOwnerDeletion)
		}
	}
	if record.References != nil {
		out.References = make([]ResourceReferenceDTO, len(record.References))
		for i, reference := range record.References {
			out.References[i] = reference
			out.References[i].Evidence.Selector = cloneStringMap(reference.Evidence.Selector)
		}
	}
	out.Labels = cloneStringMap(record.Labels)
	if record.Selectors != nil {
		out.Selectors = make([]ResourceRelationshipSelectorDTO, len(record.Selectors))
		for i, selector := range record.Selectors {
			out.Selectors[i] = selector
			out.Selectors[i].MatchLabels = cloneStringMap(selector.MatchLabels)
		}
	}
	out.FamilyCoverage = cloneFamilyCoverage(record.FamilyCoverage)
	return out
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func cloneFamilyCoverage(values map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO) map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO {
	if values == nil {
		return nil
	}
	out := make(map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO, len(values))
	for family, coverage := range values {
		out[family] = coverage
	}
	return out
}

func cloneBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
