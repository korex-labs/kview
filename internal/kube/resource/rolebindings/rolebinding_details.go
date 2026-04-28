package rolebindings

import (
	"context"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	kube "github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func GetRoleBindingDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.RoleBindingDetailsDTO, error) {
	rb, err := c.Clientset.RbacV1().RoleBindings(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := roleBindingYAML(rb)
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
		Namespace: rb.Namespace,
		CreatedAt: createdAt,
		AgeSec:    age,
	}

	roleRef := dto.RoleRefDTO{
		Kind:     rb.RoleRef.Kind,
		Name:     rb.RoleRef.Name,
		APIGroup: rb.RoleRef.APIGroup,
	}

	return &dto.RoleBindingDetailsDTO{
		Summary:  summary,
		RoleRef:  roleRef,
		Subjects: kube.MapRoleBindingSubjects(rb.Namespace, rb.Subjects),
		YAML:     string(y),
	}, nil
}

func GetRoleBindingYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	rb, err := c.Clientset.RbacV1().RoleBindings(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := roleBindingYAML(rb)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func roleBindingYAML(rb *rbacv1.RoleBinding) ([]byte, error) {
	rbCopy := rb.DeepCopy()
	rbCopy.ManagedFields = nil
	return kube.MarshalObjectYAML(rbCopy, "rbac.authorization.k8s.io/v1", "RoleBinding")
}
