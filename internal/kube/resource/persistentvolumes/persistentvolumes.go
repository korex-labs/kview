package persistentvolumes

import (
	"context"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	pvcs "github.com/korex-labs/kview/v5/internal/kube/resource/persistentvolumeclaims"
)

func ListPersistentVolumes(ctx context.Context, c *cluster.Clients) ([]dto.PersistentVolumeDTO, error) {
	items, err := c.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.PersistentVolumeDTO, 0, len(items.Items))
	for _, pv := range items.Items {
		age := int64(0)
		if !pv.CreationTimestamp.IsZero() {
			age = int64(now.Sub(pv.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.PersistentVolumeDTO{
			Name:             pv.Name,
			Phase:            string(pv.Status.Phase),
			Capacity:         pvCapacityString(&pv),
			AccessModes:      pvcs.AccessModesToStrings(pv.Spec.AccessModes),
			StorageClassName: pv.Spec.StorageClassName,
			ReclaimPolicy:    string(pv.Spec.PersistentVolumeReclaimPolicy),
			VolumeMode:       pvcs.VolumeModeString(pv.Spec.VolumeMode),
			ClaimRef:         pvClaimRefString(pv.Spec.ClaimRef),
			AgeSec:           age,
		})
	}

	return out, nil
}

func pvCapacityString(pv *corev1.PersistentVolume) string {
	if pv == nil {
		return ""
	}
	if qty, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok && !qty.IsZero() {
		return qty.String()
	}
	return ""
}

func pvClaimRefString(ref *corev1.ObjectReference) string {
	if ref == nil || ref.Name == "" {
		return ""
	}
	ns := strings.TrimSpace(ref.Namespace)
	if ns == "" {
		return ref.Name
	}
	return ns + "/" + ref.Name
}
