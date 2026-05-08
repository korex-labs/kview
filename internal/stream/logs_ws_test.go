package stream

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestLogStreamControlMessage_ErrorShape(t *testing.T) {
	msg, err := json.Marshal(logStreamControlMessage{
		KviewLogStream: true,
		Type:           "error",
		Message:        errors.New("stream ID 93; INTERNAL_ERROR; received from peer").Error(),
	})
	if err != nil {
		t.Fatalf("marshal control message: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(msg, &got); err != nil {
		t.Fatalf("unmarshal control message: %v", err)
	}

	if got["__kviewLogStream"] != true {
		t.Fatalf("expected kview log stream marker, got %#v", got["__kviewLogStream"])
	}
	if got["type"] != "error" {
		t.Fatalf("expected error type, got %#v", got["type"])
	}
	if got["message"] != "stream ID 93; INTERNAL_ERROR; received from peer" {
		t.Fatalf("unexpected message: %#v", got["message"])
	}
}
