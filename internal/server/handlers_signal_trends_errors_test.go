package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestTrendsQueryErrorClassification(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code int
		text string
	}{
		{fmt.Errorf("query: %w", localhistory.ErrTrendQueryLimit), 422, "shorter period"},
		{context.DeadlineExceeded, 408, "timed out"},
		{errors.New("private disk path"), 503, "storage unavailable"},
	} {
		w := httptest.NewRecorder()
		writeSignalTrendsError(w, tc.err)
		var body map[string]string
		if w.Code != tc.code || json.Unmarshal(w.Body.Bytes(), &body) != nil || !strings.Contains(body["message"], tc.text) {
			t.Fatal(w.Code, w.Body.String())
		}
		if tc.code == 422 && body["code"] != "history_query_limit" {
			t.Fatal(body)
		}
		if strings.Contains(w.Body.String(), "private disk path") {
			t.Fatal("storage detail leaked")
		}
	}
	w := httptest.NewRecorder()
	writeSignalTrendsError(w, context.Canceled)
	if w.Body.Len() != 0 {
		t.Fatal("cancelled request wrote error", w.Body.String())
	}
}
