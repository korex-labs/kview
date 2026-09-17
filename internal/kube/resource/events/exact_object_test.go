package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func exactEventsFixture(t *testing.T, handler http.HandlerFunc) *cluster.Clients {
	t.Helper()
	source := httptest.NewServer(handler)
	t.Cleanup(source.Close)
	client, err := kubernetes.NewForConfig(&rest.Config{Host: source.URL})
	if err != nil {
		t.Fatal(err)
	}
	return &cluster.Clients{Clientset: client}
}

func TestExactObjectEventsBoundsAndErrors(t *testing.T) {
	for _, tc := range []struct {
		name      string
		maxCalls  int32
		mode      string
		wantError bool
	}{
		{"empty is one call", 1, "empty", false},
		{"never-ending pagination", 10, "continue", true},
		{"oversized page", 1, "oversized", true},
		{"denied continuation discards partial results", 2, "denied", true},
		{"unsupported selector has no fallback", 1, "badselector", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			clients := exactEventsFixture(t, func(w http.ResponseWriter, r *http.Request) {
				call := calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path != "/api/v1/namespaces/apps/events" {
					t.Errorf("wrong scope %q", r.URL.Path)
				}
				if r.URL.Query().Get("fieldSelector") == "" {
					t.Error("broad fallback LIST")
				}
				if r.URL.Query().Get("limit") != "500" {
					t.Error("unbounded page")
				}
				list := corev1.EventList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "EventList"}}
				switch tc.mode {
				case "oversized":
					list.Items = make([]corev1.Event, 501)
				case "badselector":
					w.WriteHeader(400)
					_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"BadRequest","code":400}`))
					return
				case "denied":
					if call == 2 {
						w.WriteHeader(403)
						_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403}`))
						return
					}
					list.Items = []corev1.Event{{
						ObjectMeta:     metav1.ObjectMeta{Name: "matched", Namespace: "apps"},
						InvolvedObject: corev1.ObjectReference{APIVersion: "example.com/v1", Kind: "Widget", Name: "demo", Namespace: "apps", UID: "uid-1"},
						Reason:         "MustNotLeak", Type: "Warning",
					}}
					list.Continue = "next"
				case "continue":
					list.Continue = "next"
				}
				_ = json.NewEncoder(w).Encode(list)
			})
			result, err := ListEventsForExactObjectPage(context.Background(), clients, corev1.ObjectReference{APIVersion: "example.com/v1", Kind: "Widget", Name: "demo", Namespace: "apps", UID: "uid-1"}, ListOptions{})
			if (err != nil) != tc.wantError || calls.Load() != tc.maxCalls {
				t.Fatalf("calls=%d error=%v result=%+v", calls.Load(), err, result)
			}
			if err != nil && (result.Items != nil || result.Total != 0 || result.Limit != 0 || result.Offset != 0 || result.HasMore) {
				t.Fatal("partial success leaked")
			}
			if err == nil && (result.Items == nil || result.Total != 0 || result.Limit != MaxListLimit || result.HasMore) {
				t.Fatalf("empty envelope: %+v", result)
			}
		})
	}
}

func TestExactObjectEventsFilterThenPaginateAcrossVersions(t *testing.T) {
	target := corev1.ObjectReference{APIVersion: "example.com/v1", Kind: "Widget", Name: "demo", Namespace: "apps", UID: "uid-1"}
	items := []corev1.Event{}
	for i := 0; i < 4; i++ {
		ref := target
		ref.APIVersion = "example.com/v1beta1" // same group + UID across served versions
		typ := "Warning"
		if i == 3 {
			typ = "Normal"
		}
		items = append(items, corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("e%d", i), Namespace: "apps"}, InvolvedObject: ref, Type: typ, Reason: fmt.Sprintf("reason%d", i), Message: "match", LastTimestamp: metav1.NewTime(time.Unix(int64(i+1), 0))})
	}
	clients := exactEventsFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(corev1.EventList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "EventList"}, Items: items})
	})
	result, err := ListEventsForExactObjectPage(context.Background(), clients, target, ListOptions{Limit: 1, Offset: 1, Type: "warning", Query: "match"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 || result.Offset != 1 || result.Limit != 1 || !result.HasMore || len(result.Items) != 1 || result.Items[0].Reason != "reason1" {
		t.Fatalf("pagination=%+v", result)
	}
	result, err = ListEventsForExactObjectPage(context.Background(), clients, target, ListOptions{Limit: 999, Offset: 999})
	if err != nil || result.Limit != MaxListLimit || result.Offset != 4 || result.HasMore || len(result.Items) != 0 {
		t.Fatalf("clamped pagination=%+v error=%v", result, err)
	}
}
