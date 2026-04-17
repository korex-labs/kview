package configmaps

import "testing"

func TestConfigMapDataValuesPreservesColonValues(t *testing.T) {
	values := configMapDataValues(map[string]string{
		"database.url": "postgres://user:pass@db:5432/app?sslmode=disable",
		"message":      "stage: ready\nnext: deploy",
	})

	if got := values["database.url"]; got != "postgres://user:pass@db:5432/app?sslmode=disable" {
		t.Fatalf("database.url = %q", got)
	}
	if got := values["message"]; got != "stage: ready\nnext: deploy" {
		t.Fatalf("message = %q", got)
	}
}

func TestConfigMapDataValuesClonesMap(t *testing.T) {
	source := map[string]string{"key": "before"}
	values := configMapDataValues(source)
	source["key"] = "after"

	if got := values["key"]; got != "before" {
		t.Fatalf("key = %q", got)
	}
}
