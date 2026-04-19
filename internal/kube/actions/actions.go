package actions

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/korex-labs/kview/internal/cluster"
)

// ErrUnknownAction is returned when an action is not registered.
var ErrUnknownAction = errors.New("unknown action")

// ActionRequest describes a mutation action to perform on a resource.
type ActionRequest struct {
	Group      string         `json:"group"`
	Resource   string         `json:"resource"`
	APIVersion string         `json:"apiVersion"`
	Namespace  string         `json:"namespace"`
	Name       string         `json:"name"`
	Action     string         `json:"action"`
	Params     map[string]any `json:"params,omitempty"`
}

// ActionResult describes the outcome of an action.
type ActionResult struct {
	Status  string         `json:"status"`
	Message string         `json:"message,omitempty"`
	Details map[string]any `json:"details,omitempty"`
}

// ActionHandler processes a single action type.
type ActionHandler func(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error)

// ActionRegistry maps action names to handlers.
type ActionRegistry struct {
	mu       sync.RWMutex
	handlers map[string]ActionHandler
}

// NewActionRegistry creates an empty registry.
func NewActionRegistry() *ActionRegistry {
	return &ActionRegistry{handlers: make(map[string]ActionHandler)}
}

// Register adds a handler for the given action name.
func (r *ActionRegistry) Register(action string, h ActionHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[action] = h
}

// Execute dispatches the request to the registered handler.
// Returns an error with a descriptive message if the action is not registered.
func (r *ActionRegistry) Execute(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	r.mu.RLock()
	h, ok := r.handlers[req.Action]
	r.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownAction, req.Action)
	}

	return h(ctx, c, req)
}
