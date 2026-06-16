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
	if !bundle.Dashboard.SignalViews.Enabled || bundle.Dashboard.SignalViews.NamePrefix == "" {
		t.Fatalf("expected dashboard signal view policy: %#v", bundle.Dashboard.SignalViews)
	}
	if len(bundle.Dashboard.SignalViews.State) == 0 {
		t.Fatalf("expected dashboard signal view state policy: %#v", bundle.Dashboard.SignalViews)
	}
	if len(bundle.Dashboard.SignalFilterCategories) == 0 {
		t.Fatal("expected dashboard signal filter category policy")
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
		if resource.Key != "dashboard" && (!resource.ListView.QuickFilters.Search || !resource.ListView.QuickFilters.Tag) {
			t.Fatalf("%s: expected list quick filter policy", resource.Key)
		}
		if resource.ListView.DefaultSort.Field == "" || resource.ListView.DefaultSort.Direction == "" {
			t.Fatalf("%s: expected default sort policy", resource.Key)
		}
		if resource.ListView.FilterLabel == "" {
			t.Fatalf("%s: expected filter label", resource.Key)
		}
		if len(resource.ListView.Identity) == 0 {
			t.Fatalf("%s: expected identity fields", resource.Key)
		}
		if len(resource.ListView.SearchFields) == 0 {
			t.Fatalf("%s: expected search fields", resource.Key)
		}
		if resource.Key == "dashboard" {
			if resource.ListView.SavedViews.Enabled {
				t.Fatalf("%s: dashboard should not expose saved resource views", resource.Key)
			}
		} else {
			if !resource.ListView.SavedViews.Enabled {
				t.Fatalf("%s: expected saved view policy", resource.Key)
			}
			if resource.ListView.SavedViews.NamePrefix == "" {
				t.Fatalf("%s: expected saved view name prefix", resource.Key)
			}
			if len(resource.ListView.SavedViews.Location) == 0 || len(resource.ListView.SavedViews.State) == 0 {
				t.Fatalf("%s: expected saved view compatibility dimensions", resource.Key)
			}
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
	first.Resources[0].ListView.Identity[0] = "changed"
	first.Resources[1].ListView.SavedViews.Location[0] = "changed"
	first.SidebarGroups[0].Items[0] = "changed"
	first.Dashboard.SignalViews.State[0] = "changed"
	first.Dashboard.SignalFilterCategories[0].Label = "changed"

	second := Bundle()
	if second.Resources[0].Label == "changed" {
		t.Fatal("resource descriptors were not copied")
	}
	if second.Resources[0].ListView.QuickFilters.Search {
		t.Fatal("dashboard list view policy was not preserved")
	}
	if second.Resources[0].ListView.DefaultSort.Field != "name" {
		t.Fatal("default sort policy was not preserved")
	}
	if second.Resources[0].ListView.Identity[0] != "name" {
		t.Fatal("identity fields were not copied")
	}
	if second.Resources[1].ListView.SavedViews.Location[0] != "context" {
		t.Fatal("saved view policy was not copied")
	}
	if second.SidebarGroups[0].Items[0] == "changed" {
		t.Fatal("sidebar group items were not copied")
	}
	if second.Dashboard.SignalViews.State[0] != "filters" {
		t.Fatal("dashboard signal view policy was not copied")
	}
	if second.Dashboard.SignalFilterCategories[0].Label == "changed" {
		t.Fatal("dashboard signal filter categories were not copied")
	}
}
