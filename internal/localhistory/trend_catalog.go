package localhistory

import (
	"context"
	"sort"
)

const TrendCatalogLimit = 4096

type TrendOption struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}
type TrendCatalog struct {
	Rules      []TrendOption `json:"rules"`
	Nodes      []TrendOption `json:"nodes"`
	Namespaces []TrendOption `json:"namespaces"`
	Truncated  bool          `json:"truncated"`
}

func NewTrendCatalog() TrendCatalog {
	return TrendCatalog{Rules: []TrendOption{}, Nodes: []TrendOption{}, Namespaces: []TrendOption{}}
}

// AddTrendOption retains a deterministic bounded set without allocating a full
// inventory copy. True reports a distinct choice omitted by the cap.
func AddTrendOption(rows *[]TrendOption, option TrendOption) bool {
	i := sort.Search(len(*rows), func(i int) bool { return (*rows)[i].Key >= option.Key })
	if i < len(*rows) && (*rows)[i].Key == option.Key {
		return false
	}
	overflow := len(*rows) == TrendCatalogLimit
	if overflow && i == len(*rows) {
		return true
	}
	if !overflow {
		*rows = append(*rows, TrendOption{})
	}
	copy((*rows)[i+1:], (*rows)[i:len(*rows)-1])
	(*rows)[i] = option
	return overflow
}
func catalogFromSeries(all map[string]map[string]*TrendSeries) TrendCatalog {
	out, _ := catalogFromSeriesContext(context.Background(), all)
	return out
}

func catalogFromSeriesContext(ctx context.Context, all map[string]map[string]*TrendSeries) (TrendCatalog, error) {
	out := NewTrendCatalog()
	for kind, dest := range map[string]*[]TrendOption{"rules": &out.Rules, "nodes": &out.Nodes, "namespaces": &out.Namespaces} {
		for _, s := range all[kind] {
			if err := ctx.Err(); err != nil {
				return out, err
			}
			if AddTrendOption(dest, TrendOption{Key: s.Key, Label: s.Label}) {
				out.Truncated = true
			}
		}
	}
	return out, ctx.Err()
}
