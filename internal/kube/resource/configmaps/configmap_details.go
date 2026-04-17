package configmaps

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func GetConfigMapDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.ConfigMapDetailsDTO, error) {
	cm, err := c.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	cmCopy := cm.DeepCopy()
	cmCopy.ManagedFields = nil
	b, err := json.Marshal(cmCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !cm.CreationTimestamp.IsZero() {
		createdAt = cm.CreationTimestamp.Unix()
		age = int64(now.Sub(cm.CreationTimestamp.Time).Seconds())
	}

	dataKeysCount := len(cm.Data)
	binaryKeysCount := len(cm.BinaryData)
	keysCount := dataKeysCount + binaryKeysCount

	keys := make([]dto.ConfigMapKeyDTO, 0, keysCount)
	keyNames := make([]string, 0, keysCount)
	var totalBytes int64

	for k, v := range cm.Data {
		size := int64(len(v))
		totalBytes += size
		keys = append(keys, dto.ConfigMapKeyDTO{
			Name:      k,
			Type:      "data",
			SizeBytes: size,
		})
		keyNames = append(keyNames, k)
	}

	for k, v := range cm.BinaryData {
		size := int64(len(v))
		totalBytes += size
		keys = append(keys, dto.ConfigMapKeyDTO{
			Name:      k,
			Type:      "binaryData",
			SizeBytes: size,
		})
		keyNames = append(keyNames, k)
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Name == keys[j].Name {
			return keys[i].Type < keys[j].Type
		}
		return keys[i].Name < keys[j].Name
	})
	sort.Strings(keyNames)

	var totalBytesPtr *int64
	if totalBytes > 0 {
		totalBytesPtr = &totalBytes
	}

	summary := dto.ConfigMapSummaryDTO{
		Name:            cm.Name,
		Namespace:       cm.Namespace,
		Immutable:       cm.Immutable,
		DataKeysCount:   dataKeysCount,
		BinaryKeysCount: binaryKeysCount,
		KeysCount:       keysCount,
		TotalBytes:      totalBytesPtr,
		CreatedAt:       createdAt,
		AgeSec:          age,
	}

	metadata := dto.ConfigMapMetadataDTO{
		Labels:      cm.Labels,
		Annotations: cm.Annotations,
	}

	return &dto.ConfigMapDetailsDTO{
		Summary:  summary,
		Keys:     keys,
		KeyNames: keyNames,
		Data:     configMapDataValues(cm.Data),
		Metadata: metadata,
		YAML:     string(y),
	}, nil
}

func configMapDataValues(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
