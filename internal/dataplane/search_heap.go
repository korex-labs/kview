package dataplane

// A max-heap retains only the earliest limit+offset matches while scanning the
// name index, whose ordering differs from search's kind-priority ordering.
type searchRowHeap []dataplaneSearchRow

func (h searchRowHeap) Len() int           { return len(h) }
func (h searchRowHeap) Less(i, j int) bool { return searchRowLess(h[j], h[i]) }
func (h searchRowHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *searchRowHeap) Push(x any)        { *h = append(*h, x.(dataplaneSearchRow)) }
func (h *searchRowHeap) Pop() any {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}
