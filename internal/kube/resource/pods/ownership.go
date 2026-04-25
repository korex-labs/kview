package pods

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/types"
)

// IsPodOwnedBy reports whether pod has an owner reference with the given kind that
// matches by UID or name.
func IsPodOwnedBy(pod *corev1.Pod, kind string, uid types.UID, name string) bool {
	for _, ref := range pod.OwnerReferences {
		if ref.Kind != kind {
			continue
		}
		if ref.UID == uid || ref.Name == name {
			return true
		}
	}
	return false
}
