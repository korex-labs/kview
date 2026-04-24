package roles

import (
	"context"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	kube "github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func GetRoleDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.RoleDetailsDTO, error) {
	role, err := c.Clientset.RbacV1().Roles(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := roleYAML(role)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !role.CreationTimestamp.IsZero() {
		createdAt = role.CreationTimestamp.Unix()
		age = int64(now.Sub(role.CreationTimestamp.Time).Seconds())
	}

	summary := dto.RoleSummaryDTO{
		Name:       role.Name,
		Namespace:  role.Namespace,
		RulesCount: len(role.Rules),
		CreatedAt:  createdAt,
		AgeSec:     age,
	}

	return &dto.RoleDetailsDTO{
		Summary: summary,
		Rules:   kube.MapPolicyRules(role.Rules),
		YAML:    string(y),
	}, nil
}

func GetRoleYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	role, err := c.Clientset.RbacV1().Roles(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := roleYAML(role)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func roleYAML(role *rbacv1.Role) ([]byte, error) {
	roleCopy := role.DeepCopy()
	roleCopy.ManagedFields = nil
	return kube.MarshalObjectYAML(roleCopy, "rbac.authorization.k8s.io/v1", "Role")
}
