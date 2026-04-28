package clusterroles

import (
	"context"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	kube "github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func GetClusterRoleDetails(ctx context.Context, c *cluster.Clients, name string) (*dto.ClusterRoleDetailsDTO, error) {
	role, err := c.Clientset.RbacV1().ClusterRoles().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := clusterRoleYAML(role)
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

	summary := dto.ClusterRoleSummaryDTO{
		Name:       role.Name,
		RulesCount: len(role.Rules),
		CreatedAt:  createdAt,
		AgeSec:     age,
	}

	return &dto.ClusterRoleDetailsDTO{
		Summary: summary,
		Rules:   kube.MapPolicyRules(role.Rules),
		YAML:    string(y),
	}, nil
}

func GetClusterRoleYAML(ctx context.Context, c *cluster.Clients, name string) (string, error) {
	role, err := c.Clientset.RbacV1().ClusterRoles().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := clusterRoleYAML(role)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func clusterRoleYAML(role *rbacv1.ClusterRole) ([]byte, error) {
	roleCopy := role.DeepCopy()
	roleCopy.ManagedFields = nil
	return kube.MarshalObjectYAML(roleCopy, "rbac.authorization.k8s.io/v1", "ClusterRole")
}
