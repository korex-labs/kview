package dataplane

import (
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestResourceOwnershipRejectedEvidenceDowngradesCounts(t *testing.T) {
	for _, mode := range []string{"malformed", "wrong UID", "wrong kind", "wrong version", "ambiguous child", "multiple owners", "partial owner family"} {
		t.Run(mode, func(t *testing.T) {
			p, dep, rs := ownershipFixture(t, 3)
			pods, _ := peekNamespacedSnapshot(&p.podsStore, "apps")
			switch mode {
			case "malformed":
				pods.Relationships[1].Owners[0].APIVersion = ""
			case "wrong UID":
				pods.Relationships[1].Owners[0].UID = "deleted"
			case "wrong kind":
				pods.Relationships[1].Owners[0].Kind = "Deployment"
			case "wrong version":
				pods.Relationships[1].Owners[0].APIVersion = "apps/v9"
			case "ambiguous child":
				replacement := pods.Relationships[1]
				replacement.Resource.UID = "replacement"
				pods.Relationships = append(pods.Relationships, replacement)
				pods.Items = append(pods.Items, dto.PodListItemDTO{})
				pods.RelationshipMetadata = completeResourceMapRelationshipMetadata(4, 4)
			case "multiple owners":
				pods.Relationships[1].Owners = []dto.ResourceOwnerReferenceDTO{ownershipOwner(rs), ownershipOwner(dep)}
			case "partial owner family":
				pods.Relationships[1].FamilyCoverage = map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{dto.ResourceRelationshipFamilyOwner: {Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial}}
			}
			setNamespacedSnapshot(&p.podsStore, "apps", pods)
			response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
			if err != nil || len(response.PodGroups) != 1 {
				t.Fatalf("response=%+v err=%v", response, err)
			}
			group := response.PodGroups[0]
			want := 2
			if mode == "partial owner family" {
				want = 3
			}
			if group.CountComplete || group.ObservedCount != want {
				t.Fatalf("group=%+v", group)
			}
		})
	}
}

func TestResourceOwnershipProblemFirstSampleAndDuplicateState(t *testing.T) {
	p, dep, _ := ownershipFixture(t, 30)
	pods, _ := peekNamespacedSnapshot(&p.podsStore, "apps")
	pods.Items[29].ListHealthHint = "problem"
	pods.Items[28].UID = "replacement" // Unknown state cannot be read from another UID.
	setNamespacedSnapshot(&p.podsStore, "apps", pods)
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil {
		t.Fatal(err)
	}
	group := response.PodGroups[0]
	if group.Members[0].Identity.Name != "pod-0029" || group.Members[1].Identity.Name != "pod-0028" || group.States["problem"] != 1 || group.States["unknown"] != 1 {
		t.Fatalf("sample=%+v", group)
	}
	rs, _ := peekNamespacedSnapshot(&p.rsStore, "apps")
	rs.Items = append(rs.Items, rs.Items[0])
	setNamespacedSnapshot(&p.rsStore, "apps", rs)
	response, err = p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil || response.Nodes[1].ReplicaSet != nil {
		t.Fatalf("ambiguous state: %+v %v", response.Nodes, err)
	}
}

func TestResourceOwnershipOwnerReferenceAndVisualBudgets(t *testing.T) {
	t.Run("owner references", func(t *testing.T) {
		p, dep, rs := ownershipFixture(t, 2)
		pods, _ := peekNamespacedSnapshot(&p.podsStore, "apps")
		pods.Relationships[1].Owners = make([]dto.ResourceOwnerReferenceDTO, ResourceMapMaxScannedRecords+1)
		for i := range pods.Relationships[1].Owners {
			pods.Relationships[1].Owners[i] = ownershipOwner(rs)
		}
		setNamespacedSnapshot(&p.podsStore, "apps", pods)
		response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
		if err != nil || !response.Truncated || len(response.PodGroups) != 1 || response.PodGroups[0].CountComplete || response.PodGroups[0].ObservedCount != 1 {
			t.Fatalf("response=%+v err=%v", response, err)
		}
		if !strings.Contains(strings.Join(response.Coverage.Reasons, ";"), "owner reference scan limit") {
			t.Fatal("missing work-limit reason")
		}
	})
	t.Run("nodes plus groups", func(t *testing.T) {
		p, dep, rs := ownershipFixture(t, 1)
		rss, _ := peekNamespacedSnapshot(&p.rsStore, "apps")
		pods, _ := peekNamespacedSnapshot(&p.podsStore, "apps")
		for i := 0; i < 70; i++ {
			owner := rs
			owner.Name = fmt.Sprintf("rs-%03d", i)
			owner.UID = owner.Name
			rss.Items = append(rss.Items, dto.ReplicaSetDTO{})
			rss.Relationships = append(rss.Relationships, testResourceMapRecord(owner, ownershipOwner(dep)))
			pod := pods.Relationships[0].Resource
			pod.Name = fmt.Sprintf("child-%03d", i)
			pod.UID = pod.Name
			pods.Items = append(pods.Items, dto.PodListItemDTO{})
			pods.Relationships = append(pods.Relationships, testResourceMapRecord(pod, ownershipOwner(owner)))
		}
		rss.RelationshipMetadata = completeResourceMapRelationshipMetadata(len(rss.Items), len(rss.Relationships))
		pods.RelationshipMetadata = completeResourceMapRelationshipMetadata(len(pods.Items), len(pods.Relationships))
		setNamespacedSnapshot(&p.rsStore, "apps", rss)
		setNamespacedSnapshot(&p.podsStore, "apps", pods)
		response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
		if err != nil || !response.Truncated || len(response.Nodes)+len(response.PodGroups) != ResourceMapMaxNodes {
			t.Fatalf("nodes=%d groups=%d truncated=%v err=%v", len(response.Nodes), len(response.PodGroups), response.Truncated, err)
		}
	})
}

func TestResourceOwnershipLifecycleBudgetAndExplicitPodRoot(t *testing.T) {
	p, dep, _ := ownershipFixture(t, 2)
	pods, _ := peekNamespacedSnapshot(&p.podsStore, "apps")
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep, pods.Relationships[0].Resource}})
	if err != nil || len(response.PodGroups) != 1 || response.PodGroups[0].ObservedCount != 2 || len(response.PodGroups[0].Members) != 1 || !response.PodGroups[0].CountComplete {
		t.Fatalf("Pod seed count: %+v %v", response, err)
	}
	pods.Items = append(make([]dto.PodListItemDTO, ResourceMapMaxScannedRecords), pods.Items...)
	pods.RelationshipMetadata = completeResourceMapRelationshipMetadata(len(pods.Items), len(pods.Relationships))
	setNamespacedSnapshot(&p.podsStore, "apps", pods)
	response, err = p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil || response.PodGroups[0].States["unknown"] != 2 || !strings.Contains(strings.Join(response.Coverage.Reasons, ";"), "lifecycle scan limit") {
		t.Fatalf("state limit: %+v %v", response, err)
	}
}

func TestResourceOwnershipCacheOnlyManagerAndSourceGuard(t *testing.T) {
	m := newExplanationTestManager(t) // Panics on any Kubernetes client access.
	p, dep, _ := ownershipFixture(t, 2)
	m.planes["ctx"] = p
	response, err := m.ResourceOwnership("ctx", ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil || len(response.PodGroups) != 1 {
		t.Fatalf("response=%+v err=%v", response, err)
	}
	_, err = m.ResourceOwnership("unloaded", ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if !errors.Is(err, ErrResourceMapPlaneUnavailable) || len(m.planes) != 1 {
		t.Fatalf("manager mutated: %v", err)
	}
	file, err := parser.ParseFile(token.NewFileSet(), "resource_ownership.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	forbidden := map[string]bool{"PlaneForCluster": true, "GetClientsForContext": true, "hydrate": true, "refresh": true, "schedule": true}
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		name := selector.Sel.Name
		if forbidden[name] || (strings.HasSuffix(name, "Snapshot") && name != "collectOwnershipSnapshot") {
			t.Errorf("cache-only ownership calls forbidden method %s", name)
		}
		return true
	})
}
