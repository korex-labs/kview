package events

import (
	"context"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectIdentity prevents optional evidence crossing same-name replacements.
// The caller owns the exact cluster/context; all object fields must match.
type ObjectIdentity struct {
	Namespace string
	Name      string
	UID       string
}

func LatestEventsByObjectIdentity(ctx context.Context, c *cluster.Clients, namespace, kind string) (map[ObjectIdentity]dto.EventBriefDTO, error) {
	list, err := c.Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make(map[ObjectIdentity]dto.EventBriefDTO)
	for _, e := range list.Items {
		ref := e.InvolvedObject
		if ref.Kind != kind || ref.Namespace != namespace || ref.Name == "" || ref.UID == "" {
			continue
		}
		key := ObjectIdentity{Namespace: ref.Namespace, Name: ref.Name, UID: string(ref.UID)}
		last := eventLastSeen(e).Unix()
		prev, ok := out[key]
		if !ok || last > prev.LastSeen {
			out[key] = dto.EventBriefDTO{Type: e.Type, Reason: e.Reason, LastSeen: last}
		}
	}
	return out, nil
}
