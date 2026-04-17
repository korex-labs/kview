package kube

import (
	"context"
	"fmt"
	"sync"

	"github.com/alex-mamchenkov/kview/internal/cluster"
)

// CapabilitiesRequest specifies the resource to check capabilities for.
type CapabilitiesRequest struct {
	Group     string
	Resource  string
	Namespace string
	Name      string
}

// CapabilitiesResult reports which mutation verbs are allowed.
type CapabilitiesResult struct {
	Delete bool `json:"delete"`
	Update bool `json:"update"`
	Patch  bool `json:"patch"`
	Create bool `json:"create"`
}

// CheckCapabilities runs parallel SelfSubjectAccessReview calls for delete, update, patch, and create.
func CheckCapabilities(ctx context.Context, c *cluster.Clients, req CapabilitiesRequest) (*CapabilitiesResult, error) {
	verbs := []string{"delete", "update", "patch", "create"}
	allowed := make([]bool, len(verbs))

	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error

	for i, verb := range verbs {
		wg.Add(1)
		go func(idx int, v string) {
			defer wg.Done()

			ns := &req.Namespace
			if req.Namespace == "" {
				ns = nil
			}

			res, err := SelfSubjectAccessReview(ctx, c, AccessReviewRequest{
				Verb:      v,
				Resource:  req.Resource,
				Group:     req.Group,
				Namespace: ns,
				Name:      req.Name,
			})
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = fmt.Errorf("access review for %s: %w", v, err)
				}
				mu.Unlock()
				return
			}
			mu.Lock()
			allowed[idx] = res.Allowed
			mu.Unlock()
		}(i, verb)
	}

	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	return &CapabilitiesResult{
		Delete: allowed[0],
		Update: allowed[1],
		Patch:  allowed[2],
		Create: allowed[3],
	}, nil
}
