package server

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/korex-labs/kview/v5/internal/investigation"
)

func TestInvestigationSnapshotRoutes_CreateListGetDelete(t *testing.T) {
	s, h := newTestServer(t)
	s.investigations = investigation.NewFileStore(filepath.Join(t.TempDir(), "snapshots.json"))

	payload := []byte(`{
		"title":"Investigate api CrashLoopBackOff",
		"triageState":"investigating",
		"signal":{"type":"pod_crash_loop_waiting","severity":"high"},
		"primaryResource":{"kind":"pods","namespace":"app-prod","name":"api-7f"},
		"relatedResources":[{"kind":"deployments","namespace":"app-prod","name":"api"}],
		"relatedSignalTypes":["pod_crash_loop_waiting"],
		"markdown":"# Investigation\n\nEvidence bundle.",
		"operatorNote":"Check recent rollout.",
		"runbookUrls":["https://runbooks.example.invalid/pods"],
		"source":"investigate-signal"
	}`)
	rec := doReqWithHeader(t, h, http.MethodPost, "/api/investigations/snapshots", map[string]string{
		"Authorization":   "Bearer " + testToken,
		"X-Kview-Context": "kind-dev",
		"Content-Type":    "application/json",
	}, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("create status: got %d body=%s", rec.Code, rec.Body.String())
	}
	var createResp struct {
		Active string                 `json:"active"`
		Item   investigation.Snapshot `json:"item"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if createResp.Active != "kind-dev" || createResp.Item.Context != "kind-dev" || createResp.Item.ID == "" {
		t.Fatalf("unexpected create response: %#v", createResp)
	}

	rec = doReqWithHeader(t, h, http.MethodGet, "/api/investigations/snapshots?kind=pods&namespace=app-prod&name=api-7f", map[string]string{
		"Authorization":   "Bearer " + testToken,
		"X-Kview-Context": "kind-dev",
	}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status: got %d body=%s", rec.Code, rec.Body.String())
	}
	var listResp struct {
		Active string                   `json:"active"`
		Items  []investigation.Snapshot `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listResp.Items) != 1 || listResp.Items[0].ID != createResp.Item.ID {
		t.Fatalf("unexpected list response: %#v", listResp)
	}

	rec = doReq(t, h, http.MethodGet, "/api/investigations/snapshots/"+createResp.Item.ID, testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status: got %d body=%s", rec.Code, rec.Body.String())
	}

	rec = doReq(t, h, http.MethodDelete, "/api/investigations/snapshots/"+createResp.Item.ID, testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete status: got %d body=%s", rec.Code, rec.Body.String())
	}

	rec = doReq(t, h, http.MethodGet, "/api/investigations/snapshots/"+createResp.Item.ID, testToken, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("get after delete: got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestInvestigationSnapshotRoutes_RejectInvalidCreate(t *testing.T) {
	s, h := newTestServer(t)
	s.investigations = investigation.NewFileStore(filepath.Join(t.TempDir(), "snapshots.json"))

	rec := doReq(t, h, http.MethodPost, "/api/investigations/snapshots", testToken, []byte(`{"title":"bad"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d body=%s", rec.Code, rec.Body.String())
	}
}
