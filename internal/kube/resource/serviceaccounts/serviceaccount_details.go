package serviceaccounts

import (
	"context"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func GetServiceAccountDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.ServiceAccountDetailsDTO, error) {
	sa, err := c.Clientset.CoreV1().ServiceAccounts(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := serviceAccountYAML(sa)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !sa.CreationTimestamp.IsZero() {
		createdAt = sa.CreationTimestamp.Unix()
		age = int64(now.Sub(sa.CreationTimestamp.Time).Seconds())
	}

	summary := dto.ServiceAccountSummaryDTO{
		Name:                         sa.Name,
		Namespace:                    sa.Namespace,
		ImagePullSecretsCount:        len(sa.ImagePullSecrets),
		SecretsCount:                 len(sa.Secrets),
		AutomountServiceAccountToken: sa.AutomountServiceAccountToken,
		CreatedAt:                    createdAt,
		AgeSec:                       age,
	}

	metadata := dto.ServiceAccountMetadataDTO{
		Labels:      sa.Labels,
		Annotations: sa.Annotations,
	}

	return &dto.ServiceAccountDetailsDTO{
		Summary:  summary,
		Metadata: metadata,
		YAML:     string(y),
	}, nil
}

func GetServiceAccountYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	sa, err := c.Clientset.CoreV1().ServiceAccounts(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := serviceAccountYAML(sa)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func ListRoleBindingsForServiceAccount(
	ctx context.Context,
	c *cluster.Clients,
	namespace,
	name string,
) ([]dto.RoleBindingListItemDTO, error) {
	items, err := c.Clientset.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.RoleBindingListItemDTO, 0, len(items.Items))
	for _, rb := range items.Items {
		if !roleBindingHasServiceAccountSubject(rb.Subjects, namespace, name) {
			continue
		}

		age := int64(0)
		if !rb.CreationTimestamp.IsZero() {
			age = int64(now.Sub(rb.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.RoleBindingListItemDTO{
			Name:          rb.Name,
			Namespace:     rb.Namespace,
			RoleRefKind:   rb.RoleRef.Kind,
			RoleRefName:   rb.RoleRef.Name,
			SubjectsCount: len(rb.Subjects),
			AgeSec:        age,
		})
	}

	return out, nil
}

func roleBindingHasServiceAccountSubject(subjects []rbacv1.Subject, namespace, name string) bool {
	for _, s := range subjects {
		if s.Kind != "ServiceAccount" || s.Name != name {
			continue
		}
		subjectNS := s.Namespace
		if subjectNS == "" {
			subjectNS = namespace
		}
		if subjectNS == namespace {
			return true
		}
	}
	return false
}

func serviceAccountYAML(sa *corev1.ServiceAccount) ([]byte, error) {
	saCopy := sa.DeepCopy()
	saCopy.ManagedFields = nil
	return kube.MarshalObjectYAML(saCopy, "v1", "ServiceAccount")
}
