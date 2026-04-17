package clusterrolebindings

import (
	"context"
	"encoding/json"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	kube "github.com/alex-mamchenkov/kview/internal/kube"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func GetClusterRoleBindingDetails(ctx context.Context, c *cluster.Clients, name string) (*dto.ClusterRoleBindingDetailsDTO, error) {
	rb, err := c.Clientset.RbacV1().ClusterRoleBindings().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := clusterRoleBindingYAML(rb)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !rb.CreationTimestamp.IsZero() {
		createdAt = rb.CreationTimestamp.Unix()
		age = int64(now.Sub(rb.CreationTimestamp.Time).Seconds())
	}

	summary := dto.BindingSummaryDTO{
		Name:      rb.Name,
		CreatedAt: createdAt,
		AgeSec:    age,
	}

	roleRef := dto.RoleRefDTO{
		Kind:     rb.RoleRef.Kind,
		Name:     rb.RoleRef.Name,
		APIGroup: rb.RoleRef.APIGroup,
	}

	return &dto.ClusterRoleBindingDetailsDTO{
		Summary:  summary,
		RoleRef:  roleRef,
		Subjects: kube.MapRoleBindingSubjects("", rb.Subjects),
		YAML:     string(y),
	}, nil
}

func GetClusterRoleBindingYAML(ctx context.Context, c *cluster.Clients, name string) (string, error) {
	rb, err := c.Clientset.RbacV1().ClusterRoleBindings().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := clusterRoleBindingYAML(rb)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func clusterRoleBindingYAML(rb *rbacv1.ClusterRoleBinding) ([]byte, error) {
	rbCopy := rb.DeepCopy()
	rbCopy.ManagedFields = nil
	b, err := json.Marshal(rbCopy)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}
