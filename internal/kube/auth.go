package kube

import (
	"context"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

type AccessReviewRequest struct {
	Verb      string
	Resource  string
	Group     string
	Namespace *string
	Name      string
}

type AccessReviewResult struct {
	Allowed bool
	Reason  string
}

func SelfSubjectAccessReview(ctx context.Context, c *cluster.Clients, req AccessReviewRequest) (AccessReviewResult, error) {
	attrs := &authorizationv1.ResourceAttributes{
		Verb:     req.Verb,
		Resource: req.Resource,
		Group:    req.Group,
	}
	if req.Namespace != nil && *req.Namespace != "" {
		attrs.Namespace = *req.Namespace
	}
	if req.Name != "" {
		attrs.Name = req.Name
	}

	review := &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: attrs,
		},
	}

	res, err := c.Clientset.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, review, metav1.CreateOptions{})
	if err != nil {
		return AccessReviewResult{}, err
	}

	return AccessReviewResult{
		Allowed: res.Status.Allowed,
		Reason:  res.Status.Reason,
	}, nil
}
