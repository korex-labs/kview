package dto

type EventDTO struct {
	Type         string `json:"type"`
	Reason       string `json:"reason"`
	Message      string `json:"message"`
	Count        int32  `json:"count"`
	FirstSeen    int64  `json:"firstSeen"`
	LastSeen     int64  `json:"lastSeen"`
	FieldPath    string `json:"fieldPath,omitempty"`
	InvolvedKind string `json:"involvedKind,omitempty"`
	InvolvedName string `json:"involvedName,omitempty"`
}

type EventBriefDTO struct {
	Type     string `json:"type"`
	Reason   string `json:"reason"`
	LastSeen int64  `json:"lastSeen"`
}
