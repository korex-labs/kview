package persistentvolumes

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
	pvcs "github.com/korex-labs/kview/internal/kube/resource/persistentvolumeclaims"
)

func GetPersistentVolumeDetails(ctx context.Context, c *cluster.Clients, name string) (*dto.PersistentVolumeDetailsDTO, error) {
	pv, err := c.Clientset.CoreV1().PersistentVolumes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := persistentVolumeYAML(pv)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !pv.CreationTimestamp.IsZero() {
		createdAt = pv.CreationTimestamp.Unix()
		age = int64(now.Sub(pv.CreationTimestamp.Time).Seconds())
	}

	summary := dto.PersistentVolumeSummaryDTO{
		Name:             pv.Name,
		Phase:            string(pv.Status.Phase),
		Capacity:         pvCapacityString(pv),
		AccessModes:      pvcs.AccessModesToStrings(pv.Spec.AccessModes),
		StorageClassName: pv.Spec.StorageClassName,
		ReclaimPolicy:    string(pv.Spec.PersistentVolumeReclaimPolicy),
		VolumeMode:       pvcs.VolumeModeString(pv.Spec.VolumeMode),
		ClaimRef:         mapPVClaimRef(pv.Spec.ClaimRef),
		AgeSec:           age,
		CreatedAt:        createdAt,
	}

	spec := dto.PersistentVolumeSpecDTO{
		AccessModes:      pvcs.AccessModesToStrings(pv.Spec.AccessModes),
		VolumeMode:       pvcs.VolumeModeString(pv.Spec.VolumeMode),
		StorageClassName: pv.Spec.StorageClassName,
		ReclaimPolicy:    string(pv.Spec.PersistentVolumeReclaimPolicy),
		MountOptions:     mapMountOptions(pv.Spec.MountOptions),
		VolumeSource:     mapPersistentVolumeSource(pv.Spec.PersistentVolumeSource),
	}

	status := dto.PersistentVolumeStatusDTO{
		Phase:    string(pv.Status.Phase),
		Capacity: pvCapacityString(pv),
	}

	metadata := dto.PersistentVolumeMetadataDTO{
		Labels:      pv.Labels,
		Annotations: pv.Annotations,
	}

	return &dto.PersistentVolumeDetailsDTO{
		Summary:  summary,
		Spec:     spec,
		Status:   status,
		Metadata: metadata,
		YAML:     string(y),
	}, nil
}

func GetPersistentVolumeYAML(ctx context.Context, c *cluster.Clients, name string) (string, error) {
	pv, err := c.Clientset.CoreV1().PersistentVolumes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := persistentVolumeYAML(pv)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func persistentVolumeYAML(pv *corev1.PersistentVolume) ([]byte, error) {
	pvCopy := pv.DeepCopy()
	pvCopy.ManagedFields = nil
	b, err := json.Marshal(pvCopy)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}

func mapPVClaimRef(ref *corev1.ObjectReference) *dto.PersistentVolumeClaimRefDTO {
	if ref == nil || ref.Name == "" {
		return nil
	}
	return &dto.PersistentVolumeClaimRefDTO{
		Namespace: strings.TrimSpace(ref.Namespace),
		Name:      ref.Name,
	}
}

func mapMountOptions(options []string) []string {
	if len(options) == 0 {
		return nil
	}
	out := make([]string, 0, len(options))
	for _, opt := range options {
		if strings.TrimSpace(opt) == "" {
			continue
		}
		out = append(out, opt)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func mapPersistentVolumeSource(src corev1.PersistentVolumeSource) dto.PersistentVolumeSourceDTO {
	out := dto.PersistentVolumeSourceDTO{}
	add := func(label, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		out.Details = append(out.Details, dto.PersistentVolumeSourceDetailDTO{Label: label, Value: value})
	}
	addBool := func(label string, value bool) {
		add(label, mapYesNo(value))
	}

	switch {
	case src.CSI != nil:
		out.Type = "CSI"
		add("Driver", src.CSI.Driver)
		add("Volume Handle", src.CSI.VolumeHandle)
		add("FS Type", src.CSI.FSType)
		addBool("Read Only", src.CSI.ReadOnly)
	case src.NFS != nil:
		out.Type = "NFS"
		add("Server", src.NFS.Server)
		add("Path", src.NFS.Path)
		addBool("Read Only", src.NFS.ReadOnly)
	case src.HostPath != nil:
		out.Type = "HostPath"
		add("Path", src.HostPath.Path)
		add("Type", hostPathTypeString(src.HostPath.Type))
	case src.Local != nil:
		out.Type = "Local"
		add("Path", src.Local.Path)
	case src.AWSElasticBlockStore != nil:
		out.Type = "AWS EBS"
		add("Volume ID", src.AWSElasticBlockStore.VolumeID)
		add("FS Type", src.AWSElasticBlockStore.FSType)
		add("Partition", fmt.Sprintf("%d", src.AWSElasticBlockStore.Partition))
		addBool("Read Only", src.AWSElasticBlockStore.ReadOnly)
	case src.GCEPersistentDisk != nil:
		out.Type = "GCE PD"
		add("PD Name", src.GCEPersistentDisk.PDName)
		add("FS Type", src.GCEPersistentDisk.FSType)
		add("Partition", fmt.Sprintf("%d", src.GCEPersistentDisk.Partition))
		addBool("Read Only", src.GCEPersistentDisk.ReadOnly)
	case src.AzureDisk != nil:
		out.Type = "Azure Disk"
		add("Disk Name", src.AzureDisk.DiskName)
		add("Disk URI", src.AzureDisk.DataDiskURI)
		add("FS Type", pvcs.StringPtrValue(src.AzureDisk.FSType))
		add("Caching Mode", azureDiskCachingModeString(src.AzureDisk.CachingMode))
		add("Kind", azureDiskKindString(src.AzureDisk.Kind))
		if src.AzureDisk.ReadOnly != nil {
			addBool("Read Only", *src.AzureDisk.ReadOnly)
		}
	case src.AzureFile != nil:
		out.Type = "Azure File"
		add("Share Name", src.AzureFile.ShareName)
		addBool("Read Only", src.AzureFile.ReadOnly)
	case src.CephFS != nil:
		out.Type = "CephFS"
		add("Monitors", strings.Join(src.CephFS.Monitors, ", "))
		add("Path", src.CephFS.Path)
		addBool("Read Only", src.CephFS.ReadOnly)
	case src.Cinder != nil:
		out.Type = "Cinder"
		add("Volume ID", src.Cinder.VolumeID)
		add("FS Type", src.Cinder.FSType)
		addBool("Read Only", src.Cinder.ReadOnly)
	case src.FC != nil:
		out.Type = "FC"
		add("Target WWNs", strings.Join(src.FC.TargetWWNs, ", "))
		if src.FC.Lun != nil {
			add("LUN", fmt.Sprintf("%d", *src.FC.Lun))
		}
		add("FS Type", src.FC.FSType)
		addBool("Read Only", src.FC.ReadOnly)
	case src.FlexVolume != nil:
		out.Type = "FlexVolume"
		add("Driver", src.FlexVolume.Driver)
		add("FS Type", src.FlexVolume.FSType)
		addBool("Read Only", src.FlexVolume.ReadOnly)
	case src.Flocker != nil:
		out.Type = "Flocker"
		add("Dataset Name", src.Flocker.DatasetName)
		add("Dataset UUID", src.Flocker.DatasetUUID)
	case src.Glusterfs != nil:
		out.Type = "Glusterfs"
		add("Endpoints", src.Glusterfs.EndpointsName)
		add("Path", src.Glusterfs.Path)
		addBool("Read Only", src.Glusterfs.ReadOnly)
	case src.ISCSI != nil:
		out.Type = "iSCSI"
		add("Target Portal", src.ISCSI.TargetPortal)
		add("IQN", src.ISCSI.IQN)
		add("FS Type", src.ISCSI.FSType)
		add("LUN", fmt.Sprintf("%d", src.ISCSI.Lun))
		addBool("Read Only", src.ISCSI.ReadOnly)
	case src.PhotonPersistentDisk != nil:
		out.Type = "Photon PD"
		add("PD ID", src.PhotonPersistentDisk.PdID)
		add("FS Type", src.PhotonPersistentDisk.FSType)
	case src.PortworxVolume != nil:
		out.Type = "Portworx"
		add("Volume ID", src.PortworxVolume.VolumeID)
		add("FS Type", src.PortworxVolume.FSType)
		addBool("Read Only", src.PortworxVolume.ReadOnly)
	case src.Quobyte != nil:
		out.Type = "Quobyte"
		add("Registry", src.Quobyte.Registry)
		add("Volume", src.Quobyte.Volume)
		addBool("Read Only", src.Quobyte.ReadOnly)
	case src.RBD != nil:
		out.Type = "RBD"
		add("Monitors", strings.Join(src.RBD.CephMonitors, ", "))
		add("Pool", src.RBD.RBDPool)
		add("Image", src.RBD.RBDImage)
		add("FS Type", src.RBD.FSType)
		addBool("Read Only", src.RBD.ReadOnly)
	case src.ScaleIO != nil:
		out.Type = "ScaleIO"
		add("Gateway", src.ScaleIO.Gateway)
		add("System", src.ScaleIO.System)
		add("Volume", src.ScaleIO.VolumeName)
		add("FS Type", src.ScaleIO.FSType)
		addBool("Read Only", src.ScaleIO.ReadOnly)
	case src.StorageOS != nil:
		out.Type = "StorageOS"
		add("Volume", src.StorageOS.VolumeName)
		add("FS Type", src.StorageOS.FSType)
		addBool("Read Only", src.StorageOS.ReadOnly)
	case src.VsphereVolume != nil:
		out.Type = "vSphere"
		add("Volume Path", src.VsphereVolume.VolumePath)
		add("FS Type", src.VsphereVolume.FSType)
	default:
		out.Type = "Other"
	}

	if len(out.Details) == 0 {
		out.Details = nil
	}
	return out
}

func mapYesNo(v bool) string {
	if v {
		return "Yes"
	}
	return "No"
}

func hostPathTypeString(t *corev1.HostPathType) string {
	if t == nil {
		return ""
	}
	return string(*t)
}

func azureDiskCachingModeString(mode *corev1.AzureDataDiskCachingMode) string {
	if mode == nil {
		return ""
	}
	return string(*mode)
}

func azureDiskKindString(kind *corev1.AzureDataDiskKind) string {
	if kind == nil {
		return ""
	}
	return string(*kind)
}
