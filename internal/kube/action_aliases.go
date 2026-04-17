package kube

import kubeactions "github.com/alex-mamchenkov/kview/internal/kube/actions"

// Keep the public kube action API stable while mutation implementation lives in
// internal/kube/actions.
var ErrUnknownAction = kubeactions.ErrUnknownAction

type ActionRequest = kubeactions.ActionRequest
type ActionResult = kubeactions.ActionResult
type ActionHandler = kubeactions.ActionHandler
type ActionRegistry = kubeactions.ActionRegistry

func NewActionRegistry() *ActionRegistry {
	return kubeactions.NewActionRegistry()
}
