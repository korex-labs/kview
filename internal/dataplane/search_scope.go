package dataplane

import "strings"

// SearchScope optionally partitions cached results for namespace-first clients.
// Empty fields preserve unscoped search. When both are set they are intersected.
// Explicit ns:/namespace: query filters override these preference fields.
type SearchScope struct {
	Namespace        string
	ExcludeNamespace string
	kind             string
}

func effectiveSearchScope(query string, scopes []SearchScope) SearchScope {
	var scope SearchScope
	if len(scopes) > 0 {
		scope = scopes[0]
	}
	for _, term := range searchQueryTerms(query) {
		if term.key == "namespace" {
			scope.Namespace = term.value
			scope.ExcludeNamespace = ""
		}
		if term.key == "kind" {
			scope.kind = term.value
		}
	}
	return scope
}

func (s SearchScope) matchesNamespace(namespace string) bool {
	return (s.Namespace == "" || namespace == s.Namespace) &&
		(s.ExcludeNamespace == "" || namespace != s.ExcludeNamespace)
}

func (s SearchScope) matchesKind(kind ResourceKind) bool {
	return s.kind == "" || string(kind) == s.kind
}

// Search keys already carry encoded identity fields; reject unrelated rows
// before JSON decoding. This still scans the existing name-ordered index.
func (s SearchScope) indexKeyMatcher(cluster string) func([]byte) bool {
	clusterKey, kindKey := keyPart(cluster), keyPart(s.kind)
	namespaceKey, excludedKey := keyPart(s.Namespace), keyPart(s.ExcludeNamespace)
	return func(key []byte) bool {
		parts := strings.Split(string(key), searchKeySeparator)
		if len(parts) != 5 {
			return true // Let the existing value decoder handle legacy/malformed keys.
		}
		return (cluster == "" || parts[1] == clusterKey) &&
			(s.kind == "" || parts[2] == kindKey) &&
			(s.Namespace == "" || parts[3] == namespaceKey) &&
			(s.ExcludeNamespace == "" || parts[3] != excludedKey)
	}
}
