package persistentvolumeclaims

import (
	"context"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListPersistentVolumeClaims(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.PersistentVolumeClaimDTO, error) {
	items, err := c.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.PersistentVolumeClaimDTO, 0, len(items.Items))
	for _, pvc := range items.Items {
		out = append(out, mapPersistentVolumeClaim(pvc, now))
	}

	return out, nil
}

func mapPersistentVolumeClaim(pvc corev1.PersistentVolumeClaim, now time.Time) dto.PersistentVolumeClaimDTO {
	age := int64(0)
	if !pvc.CreationTimestamp.IsZero() {
		age = int64(now.Sub(pvc.CreationTimestamp.Time).Seconds())
	}
	carrier := relationships.WithObjectReferences(
		relationships.Capture(&pvc, relationships.PersistentVolumeClaimDescriptor),
		relationships.PersistentVolumeClaimVolumeReference(pvc.Spec.VolumeName),
	)
	return dto.PersistentVolumeClaimDTO{
		ResourceRelationshipCarrier: carrier,
		Name:                        pvc.Name,
		Namespace:                   pvc.Namespace,
		Labels:                      pvc.Labels,
		Annotations:                 pvc.Annotations,
		Phase:                       string(pvc.Status.Phase),
		StorageClassName:            StringPtrValue(pvc.Spec.StorageClassName),
		VolumeName:                  pvc.Spec.VolumeName,
		AccessModes:                 AccessModesToStrings(pvc.Spec.AccessModes),
		RequestedStorage:            pvcQuantityString(pvc.Spec.Resources.Requests[corev1.ResourceStorage]),
		Capacity:                    pvcQuantityString(pvc.Status.Capacity[corev1.ResourceStorage]),
		VolumeMode:                  VolumeModeString(pvc.Spec.VolumeMode),
		AgeSec:                      age,
	}
}

func AccessModesToStrings(modes []corev1.PersistentVolumeAccessMode) []string {
	if len(modes) == 0 {
		return nil
	}
	out := make([]string, 0, len(modes))
	for _, mode := range modes {
		out = append(out, string(mode))
	}
	return out
}

func VolumeModeString(mode *corev1.PersistentVolumeMode) string {
	if mode == nil {
		return ""
	}
	return string(*mode)
}

func StringPtrValue(val *string) string {
	if val == nil {
		return ""
	}
	return *val
}

func pvcQuantityString(qty resource.Quantity) string {
	if qty.IsZero() {
		return ""
	}
	return qty.String()
}
