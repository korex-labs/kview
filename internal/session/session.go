package session

import "time"

type Type string

const (
	TypeTerminal    Type = "terminal"
	TypePortForward Type = "portforward"
)

type Status string

const (
	StatusPending  Status = "pending"
	StatusStarting Status = "starting"
	StatusRunning  Status = "running"
	StatusStopping Status = "stopping"
	StatusStopped  Status = "stopped"
	StatusFailed   Status = "failed"
)

type ConnectionState string

const (
	ConnectionDisconnected ConnectionState = "disconnected"
	ConnectionConnecting   ConnectionState = "connecting"
	ConnectionConnected    ConnectionState = "connected"
	ConnectionClosing      ConnectionState = "closing"
	ConnectionClosed       ConnectionState = "closed"
)

type Session struct {
	ID              string            `json:"id"`
	Type            Type              `json:"type"`
	Title           string            `json:"title"`
	Status          Status            `json:"status"`
	CreatedAt       time.Time         `json:"createdAt"`
	UpdatedAt       time.Time         `json:"updatedAt"`
	TargetCluster   string            `json:"targetCluster,omitempty"`
	TargetNamespace string            `json:"targetNamespace,omitempty"`
	TargetResource  string            `json:"targetResource,omitempty"`
	TargetContainer string            `json:"targetContainer,omitempty"`
	ConnectionState ConnectionState   `json:"connectionState,omitempty"`
	Metadata        map[string]string `json:"metadata,omitempty"`
}
