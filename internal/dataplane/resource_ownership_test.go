package dataplane

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func ownershipOwner(id dto.ResourceIdentityDTO) dto.ResourceOwnerReferenceDTO {
	version := id.Version
	if id.Group != "" {
		version = id.Group + "/" + version
	}
	return dto.ResourceOwnerReferenceDTO{APIVersion: version, Kind: id.Kind, Name: id.Name, UID: id.UID}
}

func ownershipFixture(t *testing.T, fanout int) (*clusterPlane, dto.ResourceIdentityDTO, dto.ResourceIdentityDTO) {
	t.Helper()
	p := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	dep := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "web", "dep")
	rs := resourceMapIdentity("apps", "v1", "replicasets", "ReplicaSet", "apps", "web-current", "rs")
	setNamespacedSnapshot(&p.depsStore, "apps", DeploymentsSnapshot{Items: make([]dto.DeploymentListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(dep)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setNamespacedSnapshot(&p.rsStore, "apps", ReplicaSetsSnapshot{Items: []dto.ReplicaSetDTO{{Name: rs.Name, Namespace: rs.Namespace, UID: rs.UID, Revision: 2, Desired: 1}}, Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(rs, ownershipOwner(dep))}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	pods := PodsSnapshot{Meta: resourceMapMeta(), RelationshipMetadata: completeResourceMapRelationshipMetadata(fanout, fanout)}
	for i := 0; i < fanout; i++ {
		pod := resourceMapIdentity("", "v1", "pods", "Pod", "apps", fmt.Sprintf("pod-%04d", i), fmt.Sprintf("uid-%04d", i))
		pods.Items = append(pods.Items, dto.PodListItemDTO{Name: pod.Name, Namespace: pod.Namespace, UID: pod.UID, Phase: "Running"})
		pods.Relationships = append(pods.Relationships, testResourceMapRecord(pod, ownershipOwner(rs)))
	}
	setNamespacedSnapshot(&p.podsStore, "apps", pods)
	return p, dep, rs
}

func TestResourceOwnershipHighFanoutGroupedBeforeTopologyCap(t *testing.T) {
	p, dep, _ := ownershipFixture(t, 400)
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Nodes) != 2 || len(response.Edges) != 1 || len(response.PodGroups) != 1 {
		t.Fatalf("topology: nodes=%d edges=%d groups=%d", len(response.Nodes), len(response.Edges), len(response.PodGroups))
	}
	group := response.PodGroups[0]
	if group.ObservedCount != 400 || len(group.Members) != 10 || !group.CountComplete || !group.MembersTruncated || group.States["Running"] != 400 || response.Truncated {
		t.Fatalf("group=%+v truncated=%v", group, response.Truncated)
	}
	if response.Nodes[1].ReplicaSet == nil || response.Nodes[1].ReplicaSet.Revision != 2 {
		t.Fatal("same-snapshot lifecycle missing")
	}
	// Input record order must not alter the bounded member sample or topology.
	pods, _ := peekNamespacedSnapshot(&p.podsStore, "apps")
	for i, j := 0, len(pods.Relationships)-1; i < j; i, j = i+1, j-1 {
		pods.Relationships[i], pods.Relationships[j] = pods.Relationships[j], pods.Relationships[i]
	}
	setNamespacedSnapshot(&p.podsStore, "apps", pods)
	again, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil || !reflect.DeepEqual(response, again) {
		t.Fatalf("non-deterministic projection: %v", err)
	}
}

func TestResourceOwnershipMultipleOwnersUIDAndUnknown(t *testing.T) {
	p, dep, rs := ownershipFixture(t, 3)
	second := rs
	second.Name = "other"
	second.UID = "rs-other"
	snapshot, _ := peekNamespacedSnapshot(&p.rsStore, "apps")
	snapshot.Items = append(snapshot.Items, dto.ReplicaSetDTO{Name: second.Name, Namespace: second.Namespace, UID: second.UID, Revision: 1})
	snapshot.Relationships = append(snapshot.Relationships, testResourceMapRecord(second, ownershipOwner(dep)))
	snapshot.RelationshipMetadata = completeResourceMapRelationshipMetadata(2, 2)
	setNamespacedSnapshot(&p.rsStore, "apps", snapshot)
	pods, _ := peekNamespacedSnapshot(&p.podsStore, "apps")
	pods.Relationships[1].Owners = []dto.ResourceOwnerReferenceDTO{ownershipOwner(second)}
	replacement := rs
	replacement.UID = "deleted-owner"
	pods.Relationships[2].Owners = []dto.ResourceOwnerReferenceDTO{ownershipOwner(replacement)}
	pods.RelationshipMetadata = nil // visible evidence, never exact count/absence
	setNamespacedSnapshot(&p.podsStore, "apps", pods)
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep, rs}})
	if err != nil || len(response.Nodes) != 3 || len(response.PodGroups) != 2 {
		t.Fatalf("response=%+v err=%v", response, err)
	}
	for _, group := range response.PodGroups {
		if group.ObservedCount != 1 || group.CountComplete {
			t.Fatalf("group=%+v", group)
		}
	}
	// Wrong canonical version is not matched through kind/name compatibility.
	wrong := dep
	wrong.Version = "v9"
	response, err = p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{wrong}})
	if err != nil || response.Roots[0].Resolved || len(response.Nodes) != 0 {
		t.Fatalf("canonical collision: %+v %v", response, err)
	}
}

func TestResourceOwnershipAbsencePerCellAndNoPlaneCreation(t *testing.T) {
	p, dep, _ := ownershipFixture(t, 0)
	missing := dep
	missing.Name = "missing"
	missing.UID = ""
	unknown := resourceMapIdentity("", "v1", "services", "Service", "apps", "unknown", "")
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{missing, unknown}})
	if err != nil || response.Roots[0].Availability != ResourceMapAvailabilityMissing || response.Roots[1].Availability != ResourceMapAvailabilityUnknown {
		t.Fatalf("roots=%+v err=%v", response.Roots, err)
	}
	m := &manager{planes: map[string]*clusterPlane{}}
	_, err = m.ResourceOwnership("unloaded", ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if !errors.Is(err, ErrResourceMapPlaneUnavailable) || len(m.planes) != 0 {
		t.Fatalf("plane creation: %v", err)
	}
}

func TestResourceOwnershipDepthCapsCyclesAndNonOwnerExclusion(t *testing.T) {
	p, dep, rs := ownershipFixture(t, 3)
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}, Depth: 1})
	if err != nil || !response.Truncated || len(response.PodGroups) != 0 {
		t.Fatalf("depth: %+v %v", response, err)
	}
	// A cycle is bounded and remains an ownership edge; explicit references do not recurse.
	snapshot, _ := peekNamespacedSnapshot(&p.depsStore, "apps")
	snapshot.Relationships[0].Owners = []dto.ResourceOwnerReferenceDTO{ownershipOwner(rs)}
	unrelated := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "unrelated", "other")
	snapshot.Items = append(snapshot.Items, dto.DeploymentListItemDTO{})
	snapshot.Relationships = append(snapshot.Relationships, testResourceMapRecord(unrelated))
	snapshot.Relationships[0].References = []dto.ResourceReferenceDTO{testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, unrelated, "spec.reference", "not ownership")}
	snapshot.RelationshipMetadata = completeResourceMapRelationshipMetadata(2, 2)
	setNamespacedSnapshot(&p.depsStore, "apps", snapshot)
	response, err = p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}, Depth: 4})
	if err != nil || len(response.Nodes) != 2 || len(response.Edges) != 2 {
		t.Fatalf("cycle/reference: %+v %v", response, err)
	}
	if _, err = p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}, Depth: 5}); err == nil {
		t.Fatal("accepted oversized depth")
	}
	if _, err = p.ResourceOwnership(ResourceOwnershipRequest{Identities: make([]dto.ResourceIdentityDTO, 101)}); err == nil {
		t.Fatal("accepted oversized roots")
	}
}

func TestResourceOwnershipScanLimitAndNodeLimit(t *testing.T) {
	p, dep, _ := ownershipFixture(t, ResourceMapMaxScannedRecords+5)
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil || !response.Truncated || response.Cache.ScannedRecords != ResourceMapMaxScannedRecords || response.PodGroups[0].CountComplete || len(response.PodGroups[0].Members) > ResourceOwnershipMaxMembers {
		t.Fatalf("scan bound: %v %+v", err, response.Cache)
	}
	p, dep, rs := ownershipFixture(t, 0)
	snapshot, _ := peekNamespacedSnapshot(&p.rsStore, "apps")
	for i := 0; i < 150; i++ {
		id := rs
		id.Name = fmt.Sprint(i)
		id.UID = id.Name
		snapshot.Items = append(snapshot.Items, dto.ReplicaSetDTO{})
		snapshot.Relationships = append(snapshot.Relationships, testResourceMapRecord(id, ownershipOwner(dep)))
	}
	snapshot.RelationshipMetadata = completeResourceMapRelationshipMetadata(len(snapshot.Items), len(snapshot.Relationships))
	setNamespacedSnapshot(&p.rsStore, "apps", snapshot)
	response, err = p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{dep}})
	if err != nil || !response.Truncated || len(response.Nodes) != ResourceMapMaxNodes {
		t.Fatalf("node bound: %v %d", err, len(response.Nodes))
	}
}

func TestResourceOwnershipJobTerminalStateSurvivesPersistenceAndFailsOpen(t *testing.T) {
	p := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	cj := resourceMapIdentity("batch", "v1", "cronjobs", "CronJob", "apps", "schedule", "cj")
	setNamespacedSnapshot(&p.cjStore, "apps", CronJobsSnapshot{Items: make([]dto.CronJobDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(cj)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	jobs := JobsSnapshot{Meta: resourceMapMeta()}
	for i := 0; i < 4; i++ {
		id := resourceMapIdentity("batch", "v1", "jobs", "Job", "apps", fmt.Sprint(i), fmt.Sprint(i))
		item := dto.JobDTO{Name: id.Name, Namespace: id.Namespace, UID: id.UID, Status: "Complete", SuccessfulTerminal: i != 0}
		if i == 2 {
			item.Failed = 1
		}
		if i == 3 {
			item.UID = "replacement"
		}
		jobs.Items = append(jobs.Items, item)
		jobs.Relationships = append(jobs.Relationships, testResourceMapRecord(id, ownershipOwner(cj)))
	}
	jobs.RelationshipMetadata = completeResourceMapRelationshipMetadata(4, 4)
	data, _ := json.Marshal(jobs)
	var hydrated JobsSnapshot
	if err := json.Unmarshal(data, &hydrated); err != nil {
		t.Fatal(err)
	}
	setNamespacedSnapshot(&p.jobsStore, "apps", hydrated)
	response, err := p.ResourceOwnership(ResourceOwnershipRequest{Identities: []dto.ResourceIdentityDTO{cj}})
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range response.Nodes {
		if node.Identity.Kind == "Job" && (node.JobStatus == "Complete") != (node.Identity.Name == "1") {
			t.Fatalf("unsafe history: %+v", node)
		}
	}
}
