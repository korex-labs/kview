package secrets

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func GetSecretDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.SecretDetailsDTO, error) {
	sec, err := c.Clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !sec.CreationTimestamp.IsZero() {
		createdAt = sec.CreationTimestamp.Unix()
		age = int64(now.Sub(sec.CreationTimestamp.Time).Seconds())
	}

	keyNames := make([]string, 0, len(sec.Data))
	for k := range sec.Data {
		keyNames = append(keyNames, k)
	}
	sort.Strings(keyNames)

	keys := make([]dto.SecretKeyDTO, 0, len(keyNames))
	for _, k := range keyNames {
		raw := sec.Data[k]
		keys = append(keys, dto.SecretKeyDTO{
			Name:      k,
			Value:     string(raw),
			SizeBytes: len(raw),
		})
	}

	// Generate YAML
	secCopy := sec.DeepCopy()
	secCopy.ManagedFields = nil
	b, err := json.Marshal(secCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	summary := dto.SecretSummaryDTO{
		Name:      sec.Name,
		Namespace: sec.Namespace,
		Type:      string(sec.Type),
		Immutable: sec.Immutable,
		KeysCount: len(sec.Data),
		CreatedAt: createdAt,
		AgeSec:    age,
	}

	metadata := dto.SecretMetadataDTO{
		Labels:      sec.Labels,
		Annotations: sec.Annotations,
	}

	return &dto.SecretDetailsDTO{
		Summary:  summary,
		Keys:     keys,
		KeyNames: keyNames,
		Metadata: metadata,
		YAML:     string(y),
	}, nil
}
