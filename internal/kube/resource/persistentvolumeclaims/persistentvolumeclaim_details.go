package persistentvolumeclaims

import (
	"context"
	"encoding/json"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func GetPersistentVolumeClaimDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.PersistentVolumeClaimDetailsDTO, error) {
	pvc, err := c.Clientset.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := persistentVolumeClaimYAML(pvc)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !pvc.CreationTimestamp.IsZero() {
		createdAt = pvc.CreationTimestamp.Unix()
		age = int64(now.Sub(pvc.CreationTimestamp.Time).Seconds())
	}

	summary := dto.PersistentVolumeClaimSummaryDTO{
		Name:             pvc.Name,
		Namespace:        pvc.Namespace,
		Phase:            string(pvc.Status.Phase),
		StorageClassName: StringPtrValue(pvc.Spec.StorageClassName),
		VolumeName:       pvc.Spec.VolumeName,
		AccessModes:      AccessModesToStrings(pvc.Spec.AccessModes),
		RequestedStorage: pvcQuantityString(pvc.Spec.Resources.Requests[corev1.ResourceStorage]),
		Capacity:         pvcQuantityString(pvc.Status.Capacity[corev1.ResourceStorage]),
		VolumeMode:       VolumeModeString(pvc.Spec.VolumeMode),
		AgeSec:           age,
		CreatedAt:        createdAt,
	}

	spec := dto.PersistentVolumeClaimSpecDTO{
		AccessModes: AccessModesToStrings(pvc.Spec.AccessModes),
		VolumeMode:  VolumeModeString(pvc.Spec.VolumeMode),
		Requests: dto.PersistentVolumeClaimRequestsDTO{
			Storage: pvcQuantityString(pvc.Spec.Resources.Requests[corev1.ResourceStorage]),
		},
		Selector:      mapLabelSelector(pvc.Spec.Selector),
		DataSource:    mapPVCDataSource(pvc.Spec.DataSource),
		DataSourceRef: mapPVCDataSourceRef(pvc.Spec.DataSourceRef),
		Finalizers:    pvc.Finalizers,
	}

	status := dto.PersistentVolumeClaimStatusDTO{
		Phase:    string(pvc.Status.Phase),
		Capacity: pvcQuantityString(pvc.Status.Capacity[corev1.ResourceStorage]),
	}

	for _, cond := range pvc.Status.Conditions {
		lt := int64(0)
		if !cond.LastTransitionTime.IsZero() {
			lt = cond.LastTransitionTime.Unix()
		}
		status.Conditions = append(status.Conditions, dto.PersistentVolumeClaimConditionDTO{
			Type:               string(cond.Type),
			Status:             string(cond.Status),
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: lt,
		})
	}
	if len(status.Conditions) == 0 {
		status.Conditions = nil
	}

	metadata := dto.PersistentVolumeClaimMetadataDTO{
		Labels:      pvc.Labels,
		Annotations: pvc.Annotations,
	}

	return &dto.PersistentVolumeClaimDetailsDTO{
		Summary:  summary,
		Spec:     spec,
		Status:   status,
		Metadata: metadata,
		YAML:     string(y),
	}, nil
}

func GetPersistentVolumeClaimYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	pvc, err := c.Clientset.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := persistentVolumeClaimYAML(pvc)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func persistentVolumeClaimYAML(pvc *corev1.PersistentVolumeClaim) ([]byte, error) {
	pvcCopy := pvc.DeepCopy()
	pvcCopy.ManagedFields = nil
	b, err := json.Marshal(pvcCopy)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}

func mapPVCDataSource(ref *corev1.TypedLocalObjectReference) *dto.PersistentVolumeClaimDataRefDTO {
	if ref == nil {
		return nil
	}
	apiGroup := ""
	if ref.APIGroup != nil {
		apiGroup = *ref.APIGroup
	}
	return &dto.PersistentVolumeClaimDataRefDTO{
		Kind:     ref.Kind,
		Name:     ref.Name,
		APIGroup: apiGroup,
	}
}

func mapPVCDataSourceRef(ref *corev1.TypedObjectReference) *dto.PersistentVolumeClaimDataRefDTO {
	if ref == nil {
		return nil
	}
	apiGroup := ""
	if ref.APIGroup != nil {
		apiGroup = *ref.APIGroup
	}
	return &dto.PersistentVolumeClaimDataRefDTO{
		Kind:     ref.Kind,
		Name:     ref.Name,
		APIGroup: apiGroup,
	}
}

func mapLabelSelector(sel *metav1.LabelSelector) *dto.LabelSelectorDTO {
	if sel == nil {
		return nil
	}
	out := &dto.LabelSelectorDTO{
		MatchLabels: sel.MatchLabels,
	}
	for _, expr := range sel.MatchExpressions {
		out.MatchExpressions = append(out.MatchExpressions, dto.LabelSelectorExpression{
			Key:      expr.Key,
			Operator: string(expr.Operator),
			Values:   append([]string{}, expr.Values...),
		})
	}
	if len(out.MatchLabels) == 0 {
		out.MatchLabels = nil
	}
	if len(out.MatchExpressions) == 0 {
		out.MatchExpressions = nil
	}
	if out.MatchLabels == nil && out.MatchExpressions == nil {
		return nil
	}
	return out
}
