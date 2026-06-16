package viewmeta

import "testing"

func TestBundleHasConsistentDescriptors(t *testing.T) {
	bundle := Bundle()
	if len(bundle.Resources) == 0 {
		t.Fatal("expected resource descriptors")
	}
	if len(bundle.SidebarGroups) == 0 {
		t.Fatal("expected sidebar groups")
	}

	byKey := map[string]ResourceDescriptor{}
	for _, resource := range bundle.Resources {
		if resource.Key == "" {
			t.Fatal("resource key is empty")
		}
		if resource.Label == "" {
			t.Fatalf("%s: label is empty", resource.Key)
		}
		if resource.Icon == "" {
			t.Fatalf("%s: icon is empty", resource.Key)
		}
		if resource.Access.Resource == "" {
			t.Fatalf("%s: access resource is empty", resource.Key)
		}
		if _, exists := byKey[resource.Key]; exists {
			t.Fatalf("%s: duplicate descriptor", resource.Key)
		}
		byKey[resource.Key] = resource
	}

	for _, key := range []string{"dashboard", "pods", "namespaces", "helm", "helmcharts"} {
		if _, exists := byKey[key]; !exists {
			t.Fatalf("missing descriptor for %s", key)
		}
	}

	for _, group := range bundle.SidebarGroups {
		if group.ID == "" || group.Label == "" || group.Icon == "" {
			t.Fatalf("group has incomplete metadata: %#v", group)
		}
		if len(group.Items) == 0 {
			t.Fatalf("%s: group has no items", group.ID)
		}
		for _, item := range group.Items {
			if _, exists := byKey[item]; !exists {
				t.Fatalf("%s: group references unknown resource %s", group.ID, item)
			}
		}
	}
}

func TestBundleReturnsCopies(t *testing.T) {
	first := Bundle()
	first.Resources[0].Label = "changed"
	first.SidebarGroups[0].Items[0] = "changed"

	second := Bundle()
	if second.Resources[0].Label == "changed" {
		t.Fatal("resource descriptors were not copied")
	}
	if second.SidebarGroups[0].Items[0] == "changed" {
		t.Fatal("sidebar group items were not copied")
	}
}
