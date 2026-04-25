package runtime

import (
	"context"
	"sync"
	"time"
)

type LogLevel string

const (
	LogLevelDebug LogLevel = "debug"
	LogLevelInfo  LogLevel = "info"
	LogLevelWarn  LogLevel = "warn"
	LogLevelError LogLevel = "error"
)

type LogEntry struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Level     LogLevel  `json:"level"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
}

// LogReader exposes read-only access to runtime logs for HTTP handlers.
type LogReader interface {
	List(ctx context.Context) []LogEntry
}

// LogBuffer is a bounded in-memory ring buffer of log entries.
type LogBuffer struct {
	mu       sync.RWMutex
	entries  []LogEntry
	nextID   int64
	capacity int
}

func NewLogBuffer(capacity int) *LogBuffer {
	if capacity <= 0 {
		capacity = 512
	}
	return &LogBuffer{
		entries:  make([]LogEntry, 0, capacity),
		capacity: capacity,
	}
}

func (b *LogBuffer) Append(level LogLevel, source, msg string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.nextID++
	entry := LogEntry{
		ID:        formatLogID(b.nextID),
		Timestamp: time.Now().UTC(),
		Level:     level,
		Source:    source,
		Message:   msg,
	}

	if len(b.entries) < b.capacity {
		b.entries = append(b.entries, entry)
		return
	}

	// Ring-buffer: drop oldest, append newest.
	copy(b.entries[0:], b.entries[1:])
	b.entries[len(b.entries)-1] = entry
}

func (b *LogBuffer) List(_ context.Context) []LogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	out := make([]LogEntry, len(b.entries))
	copy(out, b.entries)
	return out
}

func formatLogID(n int64) string {
	return "log-" + time.Now().UTC().Format("20060102T150405.000Z07") + "-" + itoa(n)
}

// small, allocation-free itoa for non-negative integers
func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
