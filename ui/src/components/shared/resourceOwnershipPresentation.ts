import type { ApiResourceIdentity, ResourceMapEdge, ResourceMapNode, ResourceOwnershipNode, ResourceOwnershipPodGroup } from "../../types/api";

export type PodGroupPresentationNode = {
  presentation: "podGroup";
  id: string;
  depth: number;
  owner: ApiResourceIdentity;
  group: ResourceOwnershipPodGroup;
  expanded: boolean;
  visibleMembers: number;
};
export type ResourceMapPresentationNode = ResourceMapNode | PodGroupPresentationNode;
export function isPodGroupNode(node: ResourceMapPresentationNode): node is PodGroupPresentationNode {
  return "presentation" in node && node.presentation === "podGroup";
}
export function presentationIdentity(node: ResourceMapPresentationNode): ApiResourceIdentity {
  return isPodGroupNode(node) ? node.owner : node.identity;
}

// Compare revisions within each actual Deployment, not across the release.
export function ownershipHistoryIDs(nodes: ResourceOwnershipNode[], edges: ResourceMapEdge[]): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, ResourceOwnershipNode[]>();
  for (const edge of edges) {
    const child = byId.get(edge.to);
    if (edge.type !== "owner" || !edge.resolved || !child) continue;
    const list = children.get(edge.from) || [];
    list.push(child);
    children.set(edge.from, list);
  }
  const hidden = new Set<string>();
  for (const [ownerId, list] of children) {
    const owner = byId.get(ownerId)?.identity;
    if (owner?.group === "apps" && owner.resource === "deployments") {
      const replicas = list.filter((node) => node.availability === "present" && node.identity.group === "apps" && node.identity.resource === "replicasets");
      const latest = Math.max(0, ...replicas.map((node) => node.replicaSet?.revision || 0));
      for (const node of replicas) {
        if (node.replicaSet && node.replicaSet.desired === 0 && node.replicaSet.revision > 0 && node.replicaSet.revision < latest) hidden.add(node.id);
      }
    }
    if (owner?.group === "batch" && owner.resource === "cronjobs") {
      // Complete is supplied only for verified successful terminal cached Jobs;
      // failed, active and legacy/unknown state deliberately fail open.
      for (const node of list) if (node.availability === "present" && node.identity.group === "batch" && node.identity.resource === "jobs" && node.jobStatus === "Complete") hidden.add(node.id);
    }
  }
  // Ownership branches only. Do not hide separately declared manifest roots or
  // shared children with a visible owner, and never follow reference edges.
  const declared = new Set(edges.filter((edge) => edge.type === "helmManifest").map((edge) => edge.to));
  for (const id of declared) hidden.delete(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      const owners = edges.filter((edge) => edge.type === "owner" && edge.resolved && edge.to === node.id);
      if (!declared.has(node.id) && !hidden.has(node.id) && owners.length && owners.every((edge) => hidden.has(edge.from))) {
        hidden.add(node.id); changed = true;
      }
    }
  }
  return hidden;
}

// Only collapse leaf Pods whose sole relationship is an exact, resolved owner
// edge to a visible resource. References, ambiguous owners, and the target stay
// explicit. Counts describe this returned map, never a complete cluster census.
export function visibleOwnerPodGroups(nodes: ResourceMapNode[], edges: ResourceMapEdge[], targetId: string): ResourceOwnershipPodGroup[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incident = new Map<string, ResourceMapEdge[]>();
  for (const edge of edges) {
    for (const id of new Set([edge.from, edge.to])) {
      const list = incident.get(id) || [];
      list.push(edge);
      incident.set(id, list);
    }
  }
  const members = new Map<string, ResourceMapNode[]>();
  for (const node of nodes) {
    if (node.id === targetId || node.current || node.availability !== "present" || node.identity.group !== "" || node.identity.resource !== "pods" || node.identity.kind !== "Pod") continue;
    const relationships = incident.get(node.id) || [];
    if (relationships.length !== 1) continue;
    const edge = relationships[0];
    const owner = byId.get(edge.from);
    if (edge.to !== node.id || edge.type !== "owner" || !edge.resolved || edge.confidence !== "exact" || !owner || owner.id === node.id || owner.availability !== "present") continue;
    const list = members.get(owner.id) || [];
    list.push(node);
    members.set(owner.id, list);
  }
  return [...members.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([ownerId, pods]) => {
    const id = `visible-pod-group:${ownerId}`;
    if (pods.length < 2 || byId.has(id)) return [];
    return [{ id, ownerId, observedCount: pods.length, countComplete: false, membersTruncated: false, states: { Unknown: pods.length }, members: pods.sort((a, b) => a.id.localeCompare(b.id)) }];
  });
}

export function ownershipPresentation(nodes: ResourceMapNode[], edges: ResourceMapEdge[], groups: ResourceOwnershipPodGroup[], expandedGroup: string | null, maxNodes = Infinity): { nodes: ResourceMapPresentationNode[]; edges: ResourceMapEdge[]; truncated: boolean } {
  // Ordinary Resource Map callers retain their existing membership and ordering.
  const ordered = Number.isFinite(maxNodes) ? [...nodes].sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)) || a.depth - b.depth || a.id.localeCompare(b.id)) : nodes;
  const projected: ResourceMapPresentationNode[] = ordered.slice(0, Math.max(0, maxNodes));
  let truncated = projected.length < nodes.length;
  const projectedEdges = [...edges];
  const byId = new Map(projected.map((node) => [node.id, node]));
  const membershipEdge = (from: string, to: string): ResourceMapEdge => ({
    id: `pod-group:${from}:${to}`, from, to, type: "owner", confidence: "high", resolved: true,
    source: { type: "product" }, evidence: { description: "Presentation of cached immediate-owner Pod membership" },
  });
  for (const group of [...groups].sort((a, b) => a.id.localeCompare(b.id))) {
    const owner = byId.get(group.ownerId);
    if (!owner || isPodGroupNode(owner)) continue;
    if (byId.has(group.id)) continue;
    if (projected.length >= maxNodes) { truncated = true; continue; }
    const expanded = expandedGroup === group.id;
    const card: PodGroupPresentationNode = { presentation: "podGroup", id: group.id, depth: owner.depth + 1, owner: owner.identity, group, expanded, visibleMembers: 0 };
    projected.push(card);
    byId.set(card.id, card);
    projectedEdges.push(membershipEdge(owner.id, group.id));
    if (expanded) {
      const members = [...new Map(group.members.map((member) => [member.id, member])).values()].sort((a, b) => a.id.localeCompare(b.id));
      for (const member of members.slice(0, 10)) {
        if (!byId.has(member.id)) {
          if (projected.length >= maxNodes) { truncated = true; continue; }
          projected.push({ ...member, depth: owner.depth + 2 });
          byId.set(member.id, member);
        }
        card.visibleMembers += 1;
        projectedEdges.push(membershipEdge(group.id, member.id));
      }
    }
  }
  return { nodes: projected, edges: projectedEdges.filter((edge) => byId.has(edge.from) && byId.has(edge.to)), truncated };
}
