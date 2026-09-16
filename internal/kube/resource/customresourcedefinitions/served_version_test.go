package customresourcedefinitions

import "testing"

func TestCRDRequestVersionMustBeServed(t *testing.T) {
	version := func(name string, served, storage bool) interface{} {
		return map[string]interface{}{"name": name, "served": served, "storage": storage}
	}
	for _, tt := range []struct {
		name     string
		versions []interface{}
		want     string
	}{
		{"prefer served storage", []interface{}{version("v1beta1", true, false), version("v1", true, true)}, "v1"},
		{"never request unserved storage", []interface{}{version("v1", false, true), version("v1beta1", true, false)}, "v1beta1"},
		{"no served versions", []interface{}{version("v1", false, true)}, ""},
		{"skip malformed and unnamed", []interface{}{"bad", version("", true, true), version("v1", true, false)}, "v1"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := crdStorageVersion(map[string]interface{}{"spec": map[string]interface{}{"versions": tt.versions}})
			if got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
}
