package relationships

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// Capture copies canonical identity and universal Kubernetes owner metadata from
// an object. It deliberately ignores labels, annotations, and object specs.
// Metadata identity and the complete ownerReferences list are fully observed here.
// Later explicit-reference mappers must set or downgrade reference-specific
// coverage independently; absent References do not make this metadata family partial.
func Capture(object metav1.Object, descriptor IdentityDescriptor) dto.ResourceRelationshipCarrier {
	namespace := object.GetNamespace()
	if descriptor.Scope == dto.ResourceScopeCluster {
		namespace = ""
	}

	ownerReferences := object.GetOwnerReferences()
	var owners []dto.ResourceOwnerReferenceDTO
	if ownerReferences != nil {
		owners = make([]dto.ResourceOwnerReferenceDTO, len(ownerReferences))
		for i, owner := range ownerReferences {
			owners[i] = dto.ResourceOwnerReferenceDTO{
				APIVersion:         owner.APIVersion,
				Kind:               owner.Kind,
				Name:               owner.Name,
				UID:                string(owner.UID),
				Controller:         cloneBool(owner.Controller),
				BlockOwnerDeletion: cloneBool(owner.BlockOwnerDeletion),
			}
		}
	}

	return dto.ResourceRelationshipCarrier{
		Resource: dto.ResourceIdentityDTO{
			Group:     descriptor.Group,
			Version:   descriptor.Version,
			Resource:  descriptor.Resource,
			Kind:      descriptor.Kind,
			Scope:     descriptor.Scope,
			Namespace: namespace,
			Name:      object.GetName(),
			UID:       string(object.GetUID()),
		},
		Owners: owners,
		Coverage: dto.ResourceRelationshipCoverageDTO{
			Coverage:     dto.ResourceRelationshipCoverageFull,
			Completeness: dto.ResourceRelationshipCompletenessComplete,
		},
		FamilyCoverage: map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{
			dto.ResourceRelationshipFamilyOwner: {
				Coverage:     dto.ResourceRelationshipCoverageFull,
				Completeness: dto.ResourceRelationshipCompletenessComplete,
			},
		},
	}
}

func cloneBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
