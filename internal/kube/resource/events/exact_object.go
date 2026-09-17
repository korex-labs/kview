package events

import (
	"context"
	"fmt"

	"github.com/korex-labs/kview/v5/internal/cluster"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const exactObjectEventPageSize = 500
const exactObjectEventMaxPages = 10

// ListEventsForExactObjectPage never falls back to a broad name-based LIST.
// The caller must first GET and verify the target against the expected UID.
// Cluster-scoped objects require an all-namespace Event LIST: Events themselves
// are namespaced even when their involved object is not.
func ListEventsForExactObjectPage(ctx context.Context, c *cluster.Clients, target corev1.ObjectReference, opts ListOptions) (ListResult, error) {
	gv, err := schema.ParseGroupVersion(target.APIVersion)
	if err != nil || target.UID == "" || target.Kind == "" || target.Name == "" {
		return ListResult{}, fmt.Errorf("events require a complete exact object identity")
	}
	selector := fields.Set{
		"involvedObject.uid":       string(target.UID),
		"involvedObject.kind":      target.Kind,
		"involvedObject.name":      target.Name,
		"involvedObject.namespace": target.Namespace,
	}.AsSelector().String()
	options := metav1.ListOptions{FieldSelector: selector, Limit: exactObjectEventPageSize}
	items := make([]corev1.Event, 0)
	for page := 0; page < exactObjectEventMaxPages; page++ {
		list, err := c.Clientset.CoreV1().Events(target.Namespace).List(ctx, options)
		if err != nil {
			return ListResult{}, err
		}
		// Do not trust selector enforcement by aggregated/proxied API servers.
		// Bound memory even if the upstream ignores the requested page limit.
		if len(list.Items) > exactObjectEventPageSize {
			return ListResult{}, fmt.Errorf("exact object events exceeded page size limit")
		}
		for _, event := range list.Items {
			ref := event.InvolvedObject
			eventGV, err := schema.ParseGroupVersion(ref.APIVersion)
			if err == nil && eventGV.Group == gv.Group && ref.UID == target.UID && ref.Kind == target.Kind && ref.Name == target.Name && ref.Namespace == target.Namespace {
				items = append(items, event)
			}
		}
		if list.Continue == "" {
			if opts.Limit <= 0 {
				opts.Limit = MaxListLimit
			}
			return FilterAndPaginate(mapAndSortEvents(items), opts), nil
		}
		options.Continue = list.Continue
	}
	// Partial results would make total/empty claims misleading; fail explicitly.
	return ListResult{}, fmt.Errorf("exact object events exceeded %d pages; results are incomplete", exactObjectEventMaxPages)
}
