package server

import (
	"net/http"
	stdruntime "runtime"
	"time"

	"github.com/go-chi/chi/v5"
)

type performanceSnapshotDTO struct {
	CapturedAt time.Time            `json:"capturedAt"`
	Go         performanceGoDTO     `json:"go"`
	Memory     performanceMemoryDTO `json:"memory"`
	GC         performanceGCDTO     `json:"gc"`
}

type performanceGoDTO struct {
	Version    string `json:"version"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	Goroutines int    `json:"goroutines"`
	GOMAXPROCS int    `json:"gomaxprocs"`
}

type performanceMemoryDTO struct {
	AllocBytes        uint64 `json:"allocBytes"`
	TotalAllocBytes   uint64 `json:"totalAllocBytes"`
	SysBytes          uint64 `json:"sysBytes"`
	HeapAllocBytes    uint64 `json:"heapAllocBytes"`
	HeapInuseBytes    uint64 `json:"heapInuseBytes"`
	HeapIdleBytes     uint64 `json:"heapIdleBytes"`
	HeapReleasedBytes uint64 `json:"heapReleasedBytes"`
	StackInuseBytes   uint64 `json:"stackInuseBytes"`
}

type performanceGCDTO struct {
	NumGC        uint32 `json:"numGC"`
	PauseTotalNs uint64 `json:"pauseTotalNs"`
	NextGCBytes  uint64 `json:"nextGCBytes"`
	LastGCUnixNs uint64 `json:"lastGCUnixNs,omitempty"`
}

func (s *Server) registerPerformanceRoutes(api chi.Router) {
	api.Get("/performance/snapshot", func(w http.ResponseWriter, r *http.Request) {
		var mem stdruntime.MemStats
		stdruntime.ReadMemStats(&mem)

		writeJSON(w, http.StatusOK, performanceSnapshotDTO{
			CapturedAt: time.Now().UTC(),
			Go: performanceGoDTO{
				Version:    stdruntime.Version(),
				OS:         stdruntime.GOOS,
				Arch:       stdruntime.GOARCH,
				Goroutines: stdruntime.NumGoroutine(),
				GOMAXPROCS: stdruntime.GOMAXPROCS(0),
			},
			Memory: performanceMemoryDTO{
				AllocBytes:        mem.Alloc,
				TotalAllocBytes:   mem.TotalAlloc,
				SysBytes:          mem.Sys,
				HeapAllocBytes:    mem.HeapAlloc,
				HeapInuseBytes:    mem.HeapInuse,
				HeapIdleBytes:     mem.HeapIdle,
				HeapReleasedBytes: mem.HeapReleased,
				StackInuseBytes:   mem.StackInuse,
			},
			GC: performanceGCDTO{
				NumGC:        mem.NumGC,
				PauseTotalNs: mem.PauseTotalNs,
				NextGCBytes:  mem.NextGC,
				LastGCUnixNs: mem.LastGC,
			},
		})
	})
}
