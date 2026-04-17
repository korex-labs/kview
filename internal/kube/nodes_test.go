package kube

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestListNodesFollowsContinueTokens(t *testing.T) {
	var nodeListCalls int
	items, err := listAllNodePages(t.Context(), func(_ context.Context, listOpts metav1.ListOptions) (*corev1.NodeList, error) {
		nodeListCalls++
		if listOpts.Continue == "" {
			return &corev1.NodeList{
				ListMeta: metav1.ListMeta{Continue: "next"},
				Items: []corev1.Node{
					{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}},
				},
			}, nil
		}
		if listOpts.Continue != "next" {
			t.Fatalf("unexpected continue token %q", listOpts.Continue)
		}
		return &corev1.NodeList{
			Items: []corev1.Node{
				{ObjectMeta: metav1.ObjectMeta{Name: "node-b"}},
			},
		}, nil
	})

	if err != nil {
		t.Fatal(err)
	}
	if nodeListCalls != 2 {
		t.Fatalf("node list calls = %d, want 2", nodeListCalls)
	}
	if len(items.Items) != 2 || items.Items[0].Name != "node-a" || items.Items[1].Name != "node-b" {
		t.Fatalf("unexpected items: %+v", items)
	}
}
