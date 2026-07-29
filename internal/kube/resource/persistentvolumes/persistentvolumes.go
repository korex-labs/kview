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
			Labels:           pv.Labels,
			Annotations:      pv.Annotations,
			Phase:            string(pv.Status.Phase),
			Capacity:         pvCapacityString(&pv),
			AccessModes:      pvcs.AccessModesToStrings(pv.Spec.AccessModes),
			StorageClassName: pv.Spec.StorageClassName,
			ReclaimPolicy:    string(pv.Spec.PersistentVolumeReclaimPolicy),
			VolumeMode:       pvcs.VolumeModeString(pv.Spec.VolumeMode),
			VolumeSourceType: pvSourceTypeString(pv.Spec.PersistentVolumeSource),
			NodeAffinity:     pvNodeAffinityStrings(pv.Spec.NodeAffinity),
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

func pvSourceTypeString(src corev1.PersistentVolumeSource) string {
	switch {
	case src.Local != nil:
		return "Local"
	case src.HostPath != nil:
		return "HostPath"
	case src.CSI != nil:
		return "CSI"
	case src.NFS != nil:
		return "NFS"
	case src.AWSElasticBlockStore != nil:
		return "AWS EBS"
	case src.GCEPersistentDisk != nil:
		return "GCE PD"
	case src.AzureDisk != nil:
		return "Azure Disk"
	case src.AzureFile != nil:
		return "Azure File"
	case src.CephFS != nil:
		return "CephFS"
	case src.Cinder != nil:
		return "Cinder"
	case src.FC != nil:
		return "FC"
	case src.FlexVolume != nil:
		return "FlexVolume"
	case src.Flocker != nil:
		return "Flocker"
	case src.Glusterfs != nil:
		return "Glusterfs"
	case src.ISCSI != nil:
		return "iSCSI"
	case src.PhotonPersistentDisk != nil:
		return "Photon PD"
	case src.PortworxVolume != nil:
		return "Portworx"
	case src.Quobyte != nil:
		return "Quobyte"
	case src.RBD != nil:
		return "RBD"
	case src.ScaleIO != nil:
		return "ScaleIO"
	case src.StorageOS != nil:
		return "StorageOS"
	case src.VsphereVolume != nil:
		return "vSphere"
	default:
		return ""
	}
}

func pvNodeAffinityStrings(affinity *corev1.VolumeNodeAffinity) []string {
	if affinity == nil || affinity.Required == nil {
		return nil
	}
	seen := map[string]struct{}{}
	out := []string{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	for _, term := range affinity.Required.NodeSelectorTerms {
		for _, expr := range term.MatchExpressions {
			key := strings.TrimSpace(expr.Key)
			if !isNodeNameAffinityKey(key) {
				continue
			}
			for _, value := range expr.Values {
				add(value)
			}
		}
		for _, field := range term.MatchFields {
			if strings.TrimSpace(field.Key) != "metadata.name" {
				continue
			}
			for _, value := range field.Values {
				add(value)
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func isNodeNameAffinityKey(key string) bool {
	switch key {
	case corev1.LabelHostname, "beta.kubernetes.io/hostname":
		return true
	default:
		return false
	}
}
