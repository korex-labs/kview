package dataplane

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

const signalInvestigationRelatedSignalLimit = 12

type SignalInvestigationRequest struct {
	Signal dto.NamespaceInsightSignalDTO `json:"signal"`
}

type SignalInvestigationResult struct {
	Signal           dto.NamespaceInsightSignalDTO    `json:"signal"`
	Diagnosis        SignalInvestigationDiagnosis     `json:"diagnosis"`
	Helpers          []SignalInvestigationHelperRun   `json:"helpers,omitempty"`
	PrimaryResource  SignalInvestigationResourceRef   `json:"primaryResource"`
	RelatedResources []SignalInvestigationResourceRef `json:"relatedResources,omitempty"`
	RelatedSignals   []dto.NamespaceInsightSignalDTO  `json:"relatedSignals,omitempty"`
	ContextSignals   []dto.NamespaceInsightSignalDTO  `json:"contextSignals,omitempty"`
	EvidenceSections []SignalInvestigationSection     `json:"evidenceSections,omitempty"`
	ExportMarkdown   string                           `json:"exportMarkdown"`
	GeneratedAt      int64                            `json:"generatedAt"`
	Meta             SnapshotMetadata                 `json:"meta,omitempty"`
}

type SignalInvestigationDiagnosis struct {
	Summary    string                    `json:"summary"`
	Confidence string                    `json:"confidence"`
	Evidence   []SignalInvestigationItem `json:"evidence,omitempty"`
	NextSteps  []SignalInvestigationItem `json:"nextSteps,omitempty"`
	Unknowns   []SignalInvestigationItem `json:"unknowns,omitempty"`
}

type SignalInvestigationHelperRun struct {
	Name      string                    `json:"name"`
	Status    string                    `json:"status"`
	Summary   string                    `json:"summary,omitempty"`
	Evidence  []SignalInvestigationItem `json:"evidence,omitempty"`
	NextSteps []SignalInvestigationItem `json:"nextSteps,omitempty"`
	Unknowns  []SignalInvestigationItem `json:"unknowns,omitempty"`
}

type SignalInvestigationResourceRef struct {
	Kind       string `json:"kind"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name"`
	Relation   string `json:"relation"`
	Confidence string `json:"confidence,omitempty"`
	Evidence   string `json:"evidence,omitempty"`
}

type SignalInvestigationSection struct {
	Title string                    `json:"title"`
	Items []SignalInvestigationItem `json:"items"`
}

type SignalInvestigationItem struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

func BuildSignalInvestigation(
	signal dto.NamespaceInsightSignalDTO,
	resourceSignals []dto.NamespaceInsightSignalDTO,
	namespaceSignals []dto.NamespaceInsightSignalDTO,
	meta SnapshotMetadata,
) SignalInvestigationResult {
	primary := primaryInvestigationResource(signal)
	relatedSignals := relatedInvestigationSignals(signal, resourceSignals, namespaceSignals)
	contextSignals := contextInvestigationSignals(signal, relatedSignals, resourceSignals, namespaceSignals)
	relatedResources := relatedInvestigationResources(primary, relatedSignals)
	diagnosis := signalInvestigationDiagnosis(signal, primary, relatedSignals, contextSignals, meta)
	sections := signalInvestigationSections(signal, primary, relatedSignals, relatedResources, contextSignals, diagnosis, meta)
	generatedAt := time.Now().UTC().Unix()
	out := SignalInvestigationResult{
		Signal:           signal,
		Diagnosis:        diagnosis,
		PrimaryResource:  primary,
		RelatedResources: relatedResources,
		RelatedSignals:   relatedSignals,
		ContextSignals:   contextSignals,
		EvidenceSections: sections,
		GeneratedAt:      generatedAt,
		Meta:             meta,
	}
	out.ExportMarkdown = signalInvestigationMarkdown(out)
	return out
}

func ApplySignalInvestigationHelpers(result *SignalInvestigationResult, helpers []SignalInvestigationHelperRun) {
	if result == nil || len(helpers) == 0 {
		return
	}
	for _, helper := range helpers {
		if !signalInvestigationHelperInformative(helper) {
			continue
		}
		result.Helpers = append(result.Helpers, helper)
		for _, item := range helper.Evidence {
			result.Diagnosis.Evidence = append(result.Diagnosis.Evidence, SignalInvestigationItem{
				Label: helper.Name + ": " + item.Label,
				Value: item.Value,
			})
		}
		for _, item := range helper.NextSteps {
			result.Diagnosis.NextSteps = append(result.Diagnosis.NextSteps, SignalInvestigationItem{
				Label: helper.Name + ": " + item.Label,
				Value: item.Value,
			})
		}
		for _, item := range helper.Unknowns {
			result.Diagnosis.Unknowns = append(result.Diagnosis.Unknowns, SignalInvestigationItem{
				Label: helper.Name + ": " + item.Label,
				Value: item.Value,
			})
		}
	}
	result.Diagnosis.Confidence = signalInvestigationConfidence(result.Diagnosis.Confidence, helpers)
	result.ExportMarkdown = signalInvestigationMarkdown(*result)
}

func signalInvestigationHelperInformative(helper SignalInvestigationHelperRun) bool {
	if len(helper.Evidence) > 0 || len(helper.NextSteps) > 0 || len(helper.Unknowns) > 0 {
		return true
	}
	switch helper.Status {
	case "no_findings", "skipped", "":
		return false
	default:
		return true
	}
}

func primaryInvestigationResource(signal dto.NamespaceInsightSignalDTO) SignalInvestigationResourceRef {
	kind := firstNonEmpty(signal.ResourceKind, signal.Kind)
	name := firstNonEmpty(signal.ResourceName, signal.Name, signal.Namespace)
	namespace := firstNonEmpty(signal.Namespace, signal.ScopeLocation)
	if strings.EqualFold(kind, "Namespace") {
		namespace = firstNonEmpty(namespace, name)
		name = namespace
	}
	if signal.Scope == ResourceSignalsScopeCluster {
		namespace = ""
	}
	return SignalInvestigationResourceRef{
		Kind:       kind,
		Namespace:  namespace,
		Name:       name,
		Relation:   "primary",
		Confidence: firstNonEmpty(signal.Confidence, "medium"),
		Evidence:   firstNonEmpty(signal.Reason, signal.ActualData),
	}
}

func relatedInvestigationSignals(signal dto.NamespaceInsightSignalDTO, groups ...[]dto.NamespaceInsightSignalDTO) []dto.NamespaceInsightSignalDTO {
	primary := primaryInvestigationResource(signal)
	seen := map[string]bool{}
	var out []dto.NamespaceInsightSignalDTO
	for _, group := range groups {
		for _, candidate := range group {
			if sameInvestigationSignal(signal, candidate) {
				continue
			}
			if !signalInvestigationStrongSignalMatches(primary, candidate) {
				continue
			}
			key := signalIdentityKey(candidate)
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, candidate)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Reason < out[j].Reason
	})
	if len(out) > signalInvestigationRelatedSignalLimit {
		out = out[:signalInvestigationRelatedSignalLimit]
	}
	return out
}

func contextInvestigationSignals(base dto.NamespaceInsightSignalDTO, strong []dto.NamespaceInsightSignalDTO, groups ...[]dto.NamespaceInsightSignalDTO) []dto.NamespaceInsightSignalDTO {
	primary := primaryInvestigationResource(base)
	seen := map[string]bool{}
	for _, signal := range strong {
		seen[signalIdentityKey(signal)] = true
	}
	var out []dto.NamespaceInsightSignalDTO
	for _, group := range groups {
		for _, candidate := range group {
			if sameInvestigationSignal(base, candidate) {
				continue
			}
			key := signalIdentityKey(candidate)
			if seen[key] {
				continue
			}
			if !signalInvestigationContextSignalMatches(base, primary, candidate) {
				continue
			}
			seen[key] = true
			out = append(out, candidate)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Reason < out[j].Reason
	})
	if len(out) > signalInvestigationRelatedSignalLimit {
		out = out[:signalInvestigationRelatedSignalLimit]
	}
	return out
}

func signalInvestigationStrongSignalMatches(primary SignalInvestigationResourceRef, candidate dto.NamespaceInsightSignalDTO) bool {
	candidateKind := firstNonEmpty(candidate.ResourceKind, candidate.Kind)
	candidateName := firstNonEmpty(candidate.ResourceName, candidate.Name, candidate.Namespace)
	candidateNamespace := firstNonEmpty(candidate.Namespace, candidate.ScopeLocation)
	if primary.Namespace != "" && candidateNamespace != "" && candidateNamespace != primary.Namespace {
		return false
	}
	return candidateKind == primary.Kind && candidateName == primary.Name
}

func signalInvestigationContextSignalMatches(base dto.NamespaceInsightSignalDTO, primary SignalInvestigationResourceRef, candidate dto.NamespaceInsightSignalDTO) bool {
	if signalInvestigationStrongSignalMatches(primary, candidate) {
		return false
	}
	if base.SignalType != "" && candidate.SignalType == base.SignalType {
		return true
	}
	candidateNamespace := firstNonEmpty(candidate.Namespace, candidate.ScopeLocation)
	return primary.Namespace != "" && candidateNamespace == primary.Namespace
}

func relatedInvestigationResources(primary SignalInvestigationResourceRef, signals []dto.NamespaceInsightSignalDTO) []SignalInvestigationResourceRef {
	seen := map[string]bool{resourceRefKey(primary): true}
	var out []SignalInvestigationResourceRef
	for _, signal := range signals {
		ref := primaryInvestigationResource(signal)
		if ref.Kind == "" || ref.Name == "" {
			continue
		}
		key := resourceRefKey(ref)
		if seen[key] {
			continue
		}
		seen[key] = true
		ref.Relation = relationForRelatedSignal(primary, signal)
		ref.Confidence = firstNonEmpty(signal.Confidence, "medium")
		ref.Evidence = signal.Reason
		out = append(out, ref)
	}
	return out
}

func signalInvestigationSections(
	signal dto.NamespaceInsightSignalDTO,
	primary SignalInvestigationResourceRef,
	relatedSignals []dto.NamespaceInsightSignalDTO,
	relatedResources []SignalInvestigationResourceRef,
	contextSignals []dto.NamespaceInsightSignalDTO,
	diagnosis SignalInvestigationDiagnosis,
	meta SnapshotMetadata,
) []SignalInvestigationSection {
	sections := []SignalInvestigationSection{
		{
			Title: "Diagnosis",
			Items: compactInvestigationItems([]SignalInvestigationItem{
				{Label: "Summary", Value: diagnosis.Summary},
				{Label: "Confidence", Value: diagnosis.Confidence},
			}),
		},
		{
			Title: "Selected signal",
			Items: compactInvestigationItems([]SignalInvestigationItem{
				{Label: "Type", Value: signal.SignalType},
				{Label: "Severity", Value: signal.Severity},
				{Label: "Reason", Value: signal.Reason},
				{Label: "Actual data", Value: signal.ActualData},
				{Label: "Calculated data", Value: signal.CalculatedData},
				{Label: "Likely cause", Value: signal.LikelyCause},
				{Label: "Suggested action", Value: signal.SuggestedAction},
				{Label: "History key", Value: signal.HistoryKey},
			}),
		},
		{
			Title: "Primary resource",
			Items: compactInvestigationItems([]SignalInvestigationItem{
				{Label: "Kind", Value: primary.Kind},
				{Label: "Namespace", Value: primary.Namespace},
				{Label: "Name", Value: primary.Name},
				{Label: "Evidence", Value: primary.Evidence},
			}),
		},
	}
	if len(relatedSignals) > 0 {
		sections = append(sections, SignalInvestigationSection{
			Title: "Strong evidence",
			Items: []SignalInvestigationItem{
				{Label: "Same-resource signals", Value: fmt.Sprintf("%d cached signal(s) matched the primary resource identity", len(relatedSignals))},
				{Label: "Strongly related resources", Value: fmt.Sprintf("%d resource(s) referenced by strong signal evidence", len(relatedResources))},
			},
		})
	}
	if len(contextSignals) > 0 {
		sections = append(sections, SignalInvestigationSection{
			Title: "Context",
			Items: []SignalInvestigationItem{
				{Label: "Weak context signals", Value: fmt.Sprintf("%d cached signal(s) matched the namespace or signal type but are not direct resource relations", len(contextSignals))},
			},
		})
	}
	sections = append(sections, SignalInvestigationSection{
		Title: "Manual follow-up",
		Items: compactInvestigationItems([]SignalInvestigationItem{
			{Label: "Events", Value: "Review warning events for the primary resource and related resources around the first/last seen timestamps."},
			{Label: "Logs", Value: "For workload signals, inspect current and previous container logs for the selected pod or owner pods."},
			{Label: "YAML", Value: "Compare selectors, owner references, image refs, resource requests/limits, env/config/secret refs, and Helm-managed annotations."},
			{Label: "Snapshot freshness", Value: signalInvestigationFreshness(meta)},
		}),
	})
	return sections
}

func signalInvestigationDiagnosis(
	signal dto.NamespaceInsightSignalDTO,
	primary SignalInvestigationResourceRef,
	relatedSignals []dto.NamespaceInsightSignalDTO,
	contextSignals []dto.NamespaceInsightSignalDTO,
	meta SnapshotMetadata,
) SignalInvestigationDiagnosis {
	resource := valueOrDash(resourceDisplayName(primary.Kind, primary.Namespace, primary.Name))
	signalLabel := firstNonEmpty(signal.SignalType, signal.Reason, "selected signal")
	summary := fmt.Sprintf("%s on %s.", signalLabel, resource)
	if len(relatedSignals) > 0 || len(contextSignals) > 0 {
		summary = fmt.Sprintf("%s Found %d same-resource signal(s) and %d weak context signal(s).", summary, len(relatedSignals), len(contextSignals))
	}
	confidence := "medium"
	if len(relatedSignals) == 0 {
		confidence = "low"
	}
	var evidence []SignalInvestigationItem
	for _, related := range relatedSignals {
		evidence = append(evidence, SignalInvestigationItem{
			Label: firstNonEmpty(related.SignalType, "same-resource signal"),
			Value: related.Reason,
		})
		if len(evidence) >= 5 {
			break
		}
	}
	var nextSteps []SignalInvestigationItem
	var unknowns []SignalInvestigationItem
	if freshness := signalInvestigationFreshness(meta); freshness != "" {
		unknowns = append(unknowns, SignalInvestigationItem{Label: "Snapshot freshness", Value: freshness})
	}
	return SignalInvestigationDiagnosis{
		Summary:    summary,
		Confidence: confidence,
		Evidence:   evidence,
		NextSteps:  nextSteps,
		Unknowns:   unknowns,
	}
}

func signalInvestigationMarkdown(result SignalInvestigationResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Signal investigation\n\n")
	fmt.Fprintf(&b, "Generated at: %s\n\n", time.Unix(result.GeneratedAt, 0).UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "## Diagnosis\n\n")
	fmt.Fprintf(&b, "- Summary: %s\n", valueOrDash(result.Diagnosis.Summary))
	fmt.Fprintf(&b, "- Confidence: %s\n", valueOrDash(result.Diagnosis.Confidence))
	writeInvestigationItemsMarkdown(&b, "Evidence", result.Diagnosis.Evidence)
	writeInvestigationItemsMarkdown(&b, "Next steps", result.Diagnosis.NextSteps)
	writeInvestigationItemsMarkdown(&b, "Unknowns", result.Diagnosis.Unknowns)
	fmt.Fprintf(&b, "\n")
	writeInvestigationResourceMarkdown(&b, "Primary resource", result.PrimaryResource)
	fmt.Fprintf(&b, "\n## Selected signal\n\n")
	writeSignalMarkdown(&b, result.Signal)
	if len(result.RelatedSignals) > 0 {
		fmt.Fprintf(&b, "\n## Same-resource signals\n\n")
		for _, signal := range result.RelatedSignals {
			writeSignalMarkdown(&b, signal)
			fmt.Fprintf(&b, "\n")
		}
	}
	if len(result.RelatedResources) > 0 {
		fmt.Fprintf(&b, "\n## Related resources\n\n")
		for _, ref := range result.RelatedResources {
			writeInvestigationResourceMarkdown(&b, "", ref)
		}
	}
	if len(result.Helpers) > 0 {
		fmt.Fprintf(&b, "\n## Helper findings\n\n")
		for _, helper := range result.Helpers {
			fmt.Fprintf(&b, "### %s\n\n", helper.Name)
			fmt.Fprintf(&b, "- Status: %s\n", valueOrDash(helper.Status))
			if helper.Summary != "" {
				fmt.Fprintf(&b, "- Summary: %s\n", helper.Summary)
			}
			writeInvestigationItemsMarkdown(&b, "Evidence", helper.Evidence)
			writeInvestigationItemsMarkdown(&b, "Next steps", helper.NextSteps)
			writeInvestigationItemsMarkdown(&b, "Unknowns", helper.Unknowns)
			fmt.Fprintf(&b, "\n")
		}
	}
	if len(result.ContextSignals) > 0 {
		fmt.Fprintf(&b, "\n## Context signals\n\n")
		for _, signal := range result.ContextSignals {
			writeSignalMarkdown(&b, signal)
			fmt.Fprintf(&b, "\n")
		}
	}
	fmt.Fprintf(&b, "\n## Manual follow-up\n\n")
	fmt.Fprintf(&b, "- Events: warning events for primary and related resources\n")
	fmt.Fprintf(&b, "- Logs: current and previous container logs for workload resources\n")
	fmt.Fprintf(&b, "- YAML: selectors, owner refs, env/config/secret refs, resource settings, Helm metadata\n")
	if freshness := signalInvestigationFreshness(result.Meta); freshness != "" {
		fmt.Fprintf(&b, "- Snapshot freshness: %s\n", freshness)
	}
	return b.String()
}

func writeInvestigationItemsMarkdown(b *strings.Builder, title string, items []SignalInvestigationItem) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(b, "\n### %s\n\n", title)
	for _, item := range items {
		fmt.Fprintf(b, "- %s: %s\n", item.Label, item.Value)
	}
}

func writeSignalMarkdown(b *strings.Builder, signal dto.NamespaceInsightSignalDTO) {
	fmt.Fprintf(b, "- Type: %s\n", valueOrDash(signal.SignalType))
	fmt.Fprintf(b, "- Resource: %s %s\n", valueOrDash(firstNonEmpty(signal.ResourceKind, signal.Kind)), valueOrDash(firstNonEmpty(signal.ResourceName, signal.Name, signal.Namespace)))
	if signal.Namespace != "" {
		fmt.Fprintf(b, "- Namespace: %s\n", signal.Namespace)
	}
	fmt.Fprintf(b, "- Severity: %s\n", valueOrDash(signal.Severity))
	fmt.Fprintf(b, "- Reason: %s\n", valueOrDash(signal.Reason))
	if signal.ActualData != "" {
		fmt.Fprintf(b, "- Actual data: %s\n", signal.ActualData)
	}
	if signal.CalculatedData != "" {
		fmt.Fprintf(b, "- Calculated data: %s\n", signal.CalculatedData)
	}
	if signal.LikelyCause != "" {
		fmt.Fprintf(b, "- Likely cause: %s\n", signal.LikelyCause)
	}
	if signal.SuggestedAction != "" {
		fmt.Fprintf(b, "- Suggested action: %s\n", signal.SuggestedAction)
	}
}

func writeInvestigationResourceMarkdown(b *strings.Builder, title string, ref SignalInvestigationResourceRef) {
	if title != "" {
		fmt.Fprintf(b, "## %s\n\n", title)
	}
	fmt.Fprintf(b, "- Kind: %s\n", valueOrDash(ref.Kind))
	if ref.Namespace != "" {
		fmt.Fprintf(b, "- Namespace: %s\n", ref.Namespace)
	}
	fmt.Fprintf(b, "- Name: %s\n", valueOrDash(ref.Name))
	fmt.Fprintf(b, "- Relation: %s\n", valueOrDash(ref.Relation))
	if ref.Evidence != "" {
		fmt.Fprintf(b, "- Evidence: %s\n", ref.Evidence)
	}
	fmt.Fprintf(b, "\n")
}

func relationForRelatedSignal(primary SignalInvestigationResourceRef, signal dto.NamespaceInsightSignalDTO) string {
	kind := firstNonEmpty(signal.ResourceKind, signal.Kind)
	name := firstNonEmpty(signal.ResourceName, signal.Name, signal.Namespace)
	if kind == primary.Kind && name == primary.Name {
		return "same resource"
	}
	if signal.Namespace != "" && signal.Namespace == primary.Namespace {
		return "same namespace"
	}
	if signal.ScopeLocation != "" && signal.ScopeLocation == primary.Namespace {
		return "same namespace"
	}
	if signal.SignalType != "" {
		return "same signal type"
	}
	return "related signal"
}

func sameInvestigationSignal(a, b dto.NamespaceInsightSignalDTO) bool {
	if a.HistoryKey != "" && b.HistoryKey != "" {
		return a.HistoryKey == b.HistoryKey
	}
	return signalIdentityKey(a) == signalIdentityKey(b)
}

func signalIdentityKey(signal dto.NamespaceInsightSignalDTO) string {
	return strings.Join([]string{
		signal.HistoryKey,
		signal.SignalType,
		firstNonEmpty(signal.ResourceKind, signal.Kind),
		firstNonEmpty(signal.ResourceName, signal.Name, signal.Namespace),
		signal.Namespace,
		signal.Reason,
	}, "\x00")
}

func resourceRefKey(ref SignalInvestigationResourceRef) string {
	return strings.Join([]string{ref.Kind, ref.Namespace, ref.Name}, "\x00")
}

func resourceDisplayName(kind, namespace, name string) string {
	switch {
	case namespace != "" && name != "":
		return fmt.Sprintf("%s %s/%s", kind, namespace, name)
	case name != "":
		return fmt.Sprintf("%s %s", kind, name)
	default:
		return kind
	}
}

func signalInvestigationConfidence(current string, helpers []SignalInvestigationHelperRun) string {
	evidenceCount := 0
	unknownCount := 0
	for _, helper := range helpers {
		evidenceCount += len(helper.Evidence)
		unknownCount += len(helper.Unknowns)
	}
	if evidenceCount >= 2 && unknownCount == 0 {
		return "high"
	}
	if evidenceCount > 0 {
		return "medium"
	}
	return firstNonEmpty(current, "low")
}

func compactInvestigationItems(items []SignalInvestigationItem) []SignalInvestigationItem {
	out := make([]SignalInvestigationItem, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.Value) == "" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func signalInvestigationFreshness(meta SnapshotMetadata) string {
	if !meta.ObservedAt.IsZero() {
		return meta.ObservedAt.UTC().Format(time.RFC3339)
	}
	if meta.Freshness != "" {
		return string(meta.Freshness)
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func valueOrDash(value string) string {
	if strings.TrimSpace(value) == "" {
		return "-"
	}
	return value
}
