package clusterrolebindings

import (
	"context"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	kube "github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/dto"
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
	return kube.MarshalObjectYAML(rbCopy, "rbac.authorization.k8s.io/v1", "ClusterRoleBinding")
}
