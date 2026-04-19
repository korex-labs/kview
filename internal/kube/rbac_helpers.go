package kube

import (
	"strings"

	rbacv1 "k8s.io/api/rbac/v1"

	"github.com/korex-labs/kview/internal/kube/dto"
)

func MapPolicyRules(rules []rbacv1.PolicyRule) []dto.PolicyRuleDTO {
	if len(rules) == 0 {
		return nil
	}
	out := make([]dto.PolicyRuleDTO, 0, len(rules))
	for _, r := range rules {
		item := dto.PolicyRuleDTO{
			APIGroups:       cleanStringSlice(r.APIGroups),
			Resources:       cleanStringSlice(r.Resources),
			Verbs:           cleanStringSlice(r.Verbs),
			ResourceNames:   cleanStringSlice(r.ResourceNames),
			NonResourceURLs: cleanStringSlice(r.NonResourceURLs),
		}
		if len(item.APIGroups) == 0 {
			item.APIGroups = nil
		}
		if len(item.Resources) == 0 {
			item.Resources = nil
		}
		if len(item.Verbs) == 0 {
			item.Verbs = nil
		}
		if len(item.ResourceNames) == 0 {
			item.ResourceNames = nil
		}
		if len(item.NonResourceURLs) == 0 {
			item.NonResourceURLs = nil
		}
		out = append(out, item)
	}
	return out
}

func MapRoleBindingSubjects(bindingNamespace string, subjects []rbacv1.Subject) []dto.SubjectDTO {
	if len(subjects) == 0 {
		return nil
	}
	out := make([]dto.SubjectDTO, 0, len(subjects))
	for _, s := range subjects {
		ns := strings.TrimSpace(s.Namespace)
		if s.Kind == "ServiceAccount" && ns == "" {
			ns = bindingNamespace
		}
		out = append(out, dto.SubjectDTO{
			Kind:      strings.TrimSpace(s.Kind),
			Name:      strings.TrimSpace(s.Name),
			Namespace: ns,
		})
	}
	return out
}

func cleanStringSlice(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		val := strings.TrimSpace(item)
		if val == "" {
			continue
		}
		out = append(out, val)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
