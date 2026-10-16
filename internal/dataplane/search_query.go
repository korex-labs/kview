package dataplane

import (
	"strings"
	"unicode"
)

// Search syntax is deliberately small: whitespace-separated AND terms, with
// key:value or key:"value with spaces" filters. Only double quotes around an
// entire filter value are recognized; escapes and operators are not supported.
// Invalid filters remain literal text (including quotes), never match-all.
const (
	maxSearchQueryBytes = 4096
	maxSearchQueryTerms = 64
)

type searchTerm struct {
	key   string // empty means a literal, multi-field substring term
	value string
}

func searchQueryTerms(query string) []searchTerm {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	literal := func() []searchTerm { return []searchTerm{{value: strings.ToLower(query)}} }
	if len(query) > maxSearchQueryBytes {
		return literal()
	}
	var terms []searchTerm
	for rest := query; rest != ""; {
		end := strings.IndexFunc(rest, unicode.IsSpace)
		if end < 0 {
			end = len(rest)
		}
		// A quoted filter consumes through its closing quote and any suffix.
		// Unclosed quotes consume the remaining query as one literal term.
		colon := strings.IndexByte(rest[:end], ':')
		if colon >= 0 && colon+1 < len(rest) && rest[colon+1] == '"' {
			close := strings.IndexByte(rest[colon+2:], '"')
			if close < 0 {
				end = len(rest)
			} else {
				end = colon + 2 + close + 1
				if suffix := strings.IndexFunc(rest[end:], unicode.IsSpace); suffix >= 0 {
					end += suffix
				} else {
					end = len(rest)
				}
			}
		}
		terms = append(terms, parseSearchTerm(rest[:end]))
		if len(terms) > maxSearchQueryTerms {
			return literal()
		}
		rest = strings.TrimLeftFunc(rest[end:], unicode.IsSpace)
	}
	return terms
}

func parseSearchTerm(raw string) searchTerm {
	raw = strings.ToLower(raw)
	literal := searchTerm{value: raw}
	key, value, ok := strings.Cut(raw, ":")
	if !ok || value == "" {
		return literal
	}
	if strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"") && len(value) >= 2 {
		value = value[1 : len(value)-1]
	}
	if strings.TrimSpace(value) == "" || strings.ContainsAny(value, "\"\\") {
		return literal
	}
	switch key {
	case "ns", "namespace":
		key = "namespace"
	case "context", "cluster":
		key = "cluster"
	case "name", "health", "status", "signal":
		// These are existing cached strings, not a closed enum.
	case "kind":
		value = canonicalSearchKind(value)
		if value == "" {
			return literal
		}
	case "attention":
		if value != "true" && value != "false" {
			return literal
		}
	default:
		return literal
	}
	return searchTerm{key: key, value: value}
}

// Explicit pairs avoid fuzzy kind matches and incorrect plural stripping.
func canonicalSearchKind(value string) string {
	for _, pair := range [][2]string{
		{"namespace", "namespaces"}, {"pod", "pods"},
		{"deployment", "deployments"}, {"node", "nodes"},
		{"persistentvolume", "persistentvolumes"}, {"clusterrole", "clusterroles"},
		{"clusterrolebinding", "clusterrolebindings"}, {"customresourcedefinition", "customresourcedefinitions"},
		{"clusterresource", "clusterresources"}, {"service", "services"},
		{"ingress", "ingresses"}, {"networkpolicy", "networkpolicies"},
		{"persistentvolumeclaim", "persistentvolumeclaims"}, {"configmap", "configmaps"},
		{"secret", "secrets"}, {"serviceaccount", "serviceaccounts"},
		{"role", "roles"}, {"rolebinding", "rolebindings"},
		{"helmrelease", "helmreleases"}, {"daemonset", "daemonsets"},
		{"statefulset", "statefulsets"}, {"replicaset", "replicasets"},
		{"job", "jobs"}, {"cronjob", "cronjobs"},
		{"horizontalpodautoscaler", "horizontalpodautoscalers"}, {"resourcequota", "resourcequotas"},
		{"limitrange", "limitranges"}, {"customresource", "customresources"},
	} {
		if value == pair[0] || value == pair[1] {
			return pair[1]
		}
	}
	switch value {
	case "pvc", "pvcs":
		return "persistentvolumeclaims"
	case "pv", "pvs":
		return "persistentvolumes"
	case "hpa", "hpas":
		return "horizontalpodautoscalers"
	case "crd", "crds":
		return "customresourcedefinitions"
	}
	return ""
}
