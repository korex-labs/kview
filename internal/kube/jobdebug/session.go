package jobdebug

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	kubeactions "github.com/korex-labs/kview/internal/kube/actions"
)

const (
	sessionTTL          = 30 * time.Minute
	finalLogSweepWindow = 5 * time.Second
)

type SourceKind string

const (
	SourceJob     SourceKind = "Job"
	SourceCronJob SourceKind = "CronJob"
)

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{sessions: map[string]*Session{}}
}

type StartRequest struct {
	Context   string
	Kind      SourceKind
	Namespace string
	Name      string
}

type StartResponse struct {
	ID        string `json:"id"`
	Context   string `json:"context"`
	Namespace string `json:"namespace"`
	JobName   string `json:"jobName,omitempty"`
}

type Record struct {
	Type         string `json:"type"`
	Timestamp    int64  `json:"timestamp"`
	Level        string `json:"level,omitempty"`
	Phase        string `json:"phase,omitempty"`
	Message      string `json:"message,omitempty"`
	JobName      string `json:"jobName,omitempty"`
	Pod          string `json:"pod,omitempty"`
	Container    string `json:"container,omitempty"`
	Line         string `json:"line,omitempty"`
	EventType    string `json:"eventType,omitempty"`
	Reason       string `json:"reason,omitempty"`
	InvolvedKind string `json:"involvedKind,omitempty"`
	InvolvedName string `json:"involvedName,omitempty"`
}

type Session struct {
	id         string
	context    string
	namespace  string
	source     SourceKind
	sourceName string
	clients    *cluster.Clients
	cancel     context.CancelFunc

	mu      sync.Mutex
	records []Record
	closed  bool
	jobName string
	logged  map[string]bool
}

func (m *Manager) Start(ctx context.Context, clients *cluster.Clients, req StartRequest) (*StartResponse, error) {
	if clients == nil {
		return nil, fmt.Errorf("nil clients")
	}
	if req.Context == "" || req.Namespace == "" || req.Name == "" {
		return nil, fmt.Errorf("context, namespace, and name are required")
	}

	id := randomID()
	runCtx, cancel := context.WithCancel(context.Background())
	s := &Session{
		id:         id,
		context:    req.Context,
		namespace:  req.Namespace,
		source:     req.Kind,
		sourceName: req.Name,
		clients:    clients,
		cancel:     cancel,
		logged:     map[string]bool{},
	}

	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()

	s.append(Record{Type: "status", Phase: "creating", Message: fmt.Sprintf("Creating debug Job from %s %s/%s", req.Kind, req.Namespace, req.Name)})

	var job *batchv1.Job
	var err error
	switch req.Kind {
	case SourceJob:
		job, err = kubeactions.BuildJobRerun(ctx, clients, req.Namespace, req.Name, id)
	case SourceCronJob:
		job, err = kubeactions.BuildCronJobRun(ctx, clients, req.Namespace, req.Name, id)
	default:
		err = fmt.Errorf("unsupported source kind %q", req.Kind)
	}
	if err != nil {
		s.fail(err)
		cancel()
		return nil, err
	}

	created, err := clients.Clientset.BatchV1().Jobs(req.Namespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		s.fail(err)
		cancel()
		return nil, err
	}
	s.setJobName(created.Name)
	s.append(Record{Type: "status", Phase: "waiting", JobName: created.Name, Message: fmt.Sprintf("Created Job %s/%s", req.Namespace, created.Name)})

	go s.run(runCtx)
	go m.expireLater(id, sessionTTL)

	return &StartResponse{ID: id, Context: req.Context, Namespace: req.Namespace, JobName: created.Name}, nil
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	return s, ok
}

func (m *Manager) Close(id string) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if ok {
		s.cancel()
		s.close()
	}
}

func (m *Manager) Stop(ctx context.Context, id string) (*StartResponse, error) {
	s, ok := m.Get(id)
	if !ok {
		return nil, fmt.Errorf("debug run not found")
	}
	jobName := s.currentJobName()
	if jobName == "" {
		return nil, fmt.Errorf("debug run has no Job yet")
	}
	s.append(Record{Type: "status", Phase: "stopping", JobName: jobName, Message: fmt.Sprintf("Deleting Job %s/%s", s.namespace, jobName)})
	policy := metav1.DeletePropagationBackground
	err := s.clients.Clientset.BatchV1().Jobs(s.namespace).Delete(ctx, jobName, metav1.DeleteOptions{
		PropagationPolicy: &policy,
	})
	if err != nil && !apierrors.IsNotFound(err) {
		s.append(Record{Type: "status", Level: "error", Phase: "stopping", JobName: jobName, Message: err.Error()})
		return nil, err
	}
	s.append(Record{Type: "status", Phase: "stopped", JobName: jobName, Message: fmt.Sprintf("Stopped Job %s/%s", s.namespace, jobName)})
	s.cancel()
	return &StartResponse{ID: s.id, Context: s.context, Namespace: s.namespace, JobName: jobName}, nil
}

func (m *Manager) expireLater(id string, ttl time.Duration) {
	time.Sleep(ttl)
	m.Close(id)
}

func (s *Session) Stream(ctx context.Context, conn *websocket.Conn) {
	idx := 0
	for {
		s.mu.Lock()
		if idx < len(s.records) {
			rec := s.records[idx]
			idx++
			s.mu.Unlock()
			if err := conn.WriteJSON(rec); err != nil {
				return
			}
			continue
		}
		closed := s.closed
		s.mu.Unlock()
		if closed {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func (s *Session) run(ctx context.Context) {
	defer s.close()
	go s.watchJob(ctx)
	go s.watchEvents(ctx)
	s.watchPods(ctx)
}

func (s *Session) watchJob(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(1 * time.Second):
		}
		jobName := s.currentJobName()
		if jobName == "" {
			continue
		}
		job, err := s.clients.Clientset.BatchV1().Jobs(s.namespace).Get(ctx, jobName, metav1.GetOptions{})
		if err != nil {
			if !apierrors.IsNotFound(err) {
				s.append(Record{Type: "status", Level: "warning", Phase: "waiting", Message: err.Error(), JobName: jobName})
			}
			continue
		}
		if job.Status.Active > 0 {
			s.append(Record{Type: "status", Phase: "running", JobName: jobName, Message: fmt.Sprintf("%d active, %d succeeded, %d failed", job.Status.Active, job.Status.Succeeded, job.Status.Failed)})
		}
		for _, cond := range job.Status.Conditions {
			if cond.Status != corev1.ConditionTrue {
				continue
			}
			switch cond.Type {
			case batchv1.JobComplete:
				s.append(Record{Type: "status", Phase: "succeeded", JobName: jobName, Reason: cond.Reason, Message: firstNonEmpty(cond.Message, "Job completed")})
				s.cancel()
				return
			case batchv1.JobFailed:
				s.append(Record{Type: "status", Level: "error", Phase: "failed", JobName: jobName, Reason: cond.Reason, Message: firstNonEmpty(cond.Message, "Job failed")})
				s.cancel()
				return
			}
		}
	}
}

func (s *Session) watchPods(ctx context.Context) {
	seenLogs := map[string]bool{}
	seenPrevious := map[string]int32{}
	for {
		select {
		case <-ctx.Done():
			s.captureFinalPodLogs(seenPrevious)
			return
		case <-time.After(750 * time.Millisecond):
		}
		s.capturePodLogs(ctx, seenLogs, seenPrevious, true)
	}
}

func (s *Session) captureFinalPodLogs(seenPrevious map[string]int32) {
	ctx, cancel := context.WithTimeout(context.Background(), finalLogSweepWindow)
	defer cancel()

	s.append(Record{Type: "status", Phase: "capturing", Message: "Capturing final container logs"})
	s.capturePodLogs(ctx, map[string]bool{}, seenPrevious, false)
}

func (s *Session) capturePodLogs(ctx context.Context, seenLogs map[string]bool, seenPrevious map[string]int32, follow bool) {
	pods, err := s.clients.Clientset.CoreV1().Pods(s.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "kview.korex-labs.io/run-id=" + s.id,
	})
	if err != nil {
		if ctx.Err() == nil {
			s.append(Record{Type: "status", Level: "warning", Phase: "waiting", Message: "pod watch: " + err.Error()})
		}
		return
	}
	for i := range pods.Items {
		pod := pods.Items[i]
		s.append(Record{Type: "pod", Pod: pod.Name, Phase: string(pod.Status.Phase), Message: pod.Status.Message, Reason: pod.Status.Reason})
		initStatuses := mapContainerStatuses(pod.Status.InitContainerStatuses)
		containerStatuses := mapContainerStatuses(pod.Status.ContainerStatuses)
		for _, c := range pod.Spec.InitContainers {
			s.captureContainerLogs(ctx, pod.Name, c.Name, initStatuses[c.Name], seenLogs, seenPrevious, follow)
		}
		for _, c := range pod.Spec.Containers {
			s.captureContainerLogs(ctx, pod.Name, c.Name, containerStatuses[c.Name], seenLogs, seenPrevious, follow)
		}
	}
}

func (s *Session) captureContainerLogs(ctx context.Context, pod, container string, status corev1.ContainerStatus, seenLogs map[string]bool, seenPrevious map[string]int32, follow bool) {
	key := pod + "/" + container
	if !seenLogs[key] {
		seenLogs[key] = true
		if follow {
			go s.streamContainerLogs(ctx, pod, container, false, true)
		} else if !s.hasLoggedContainer(pod, container, false) {
			s.streamContainerLogs(ctx, pod, container, false, false)
		}
	}
	if shouldCapturePreviousLogs(status, seenPrevious[key]) {
		seenPrevious[key] = status.RestartCount
		if follow {
			go s.streamContainerLogs(ctx, pod, container, true, false)
		} else {
			s.streamContainerLogs(ctx, pod, container, true, false)
		}
	}
}

func (s *Session) watchEvents(ctx context.Context) {
	seen := map[string]bool{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(750 * time.Millisecond):
		}
		evs, err := s.clients.Clientset.CoreV1().Events(s.namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			s.append(Record{Type: "status", Level: "warning", Phase: "waiting", Message: "event watch: " + err.Error()})
			continue
		}
		jobName := s.currentJobName()
		for _, e := range evs.Items {
			kind := strings.TrimSpace(e.InvolvedObject.Kind)
			name := strings.TrimSpace(e.InvolvedObject.Name)
			if kind == "" || name == "" {
				continue
			}
			if !(kind == "Job" && name == jobName) && !(kind == "Pod" && strings.Contains(name, jobName)) {
				continue
			}
			key := string(e.UID) + "/" + e.ResourceVersion + "/" + fmt.Sprint(e.Count)
			if seen[key] {
				continue
			}
			seen[key] = true
			s.append(Record{
				Type:         "event",
				Level:        strings.ToLower(e.Type),
				EventType:    e.Type,
				Reason:       e.Reason,
				Message:      e.Message,
				InvolvedKind: kind,
				InvolvedName: name,
				Timestamp:    eventTime(e).Unix(),
			})
		}
	}
}

func (s *Session) streamContainerLogs(ctx context.Context, pod, container string, previous, follow bool) {
	opts := &corev1.PodLogOptions{Container: container, Follow: follow, Previous: previous}
	req := s.clients.Clientset.CoreV1().Pods(s.namespace).GetLogs(pod, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		if previous && (apierrors.IsBadRequest(err) || apierrors.IsNotFound(err)) {
			return
		}
		s.append(Record{Type: "status", Level: "warning", Phase: "running", Pod: pod, Container: container, Message: "logs: " + err.Error()})
		return
	}
	defer stream.Close()

	reader := bufio.NewReader(stream)
	for {
		line, err := reader.ReadString('\n')
		if strings.TrimRight(line, "\r\n") != "" {
			line = strings.TrimRight(line, "\r\n")
			if previous {
				line = "[previous] " + line
			}
			s.markLoggedContainer(pod, container, previous)
			s.append(Record{Type: "log", Pod: pod, Container: container, Line: line})
		}
		if err != nil {
			if err != io.EOF {
				s.append(Record{Type: "status", Level: "warning", Phase: "running", Pod: pod, Container: container, Message: "logs ended: " + err.Error()})
			}
			return
		}
	}
}

func mapContainerStatuses(items []corev1.ContainerStatus) map[string]corev1.ContainerStatus {
	out := make(map[string]corev1.ContainerStatus, len(items))
	for _, item := range items {
		out[item.Name] = item
	}
	return out
}

func shouldCapturePreviousLogs(status corev1.ContainerStatus, capturedRestartCount int32) bool {
	if status.RestartCount <= 0 || status.RestartCount <= capturedRestartCount {
		return false
	}
	return status.LastTerminationState.Terminated != nil
}

func (s *Session) markLoggedContainer(pod, container string, previous bool) {
	s.mu.Lock()
	if s.logged == nil {
		s.logged = map[string]bool{}
	}
	s.logged[containerLogKey(pod, container, previous)] = true
	s.mu.Unlock()
}

func (s *Session) hasLoggedContainer(pod, container string, previous bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.logged[containerLogKey(pod, container, previous)]
}

func containerLogKey(pod, container string, previous bool) string {
	if previous {
		return pod + "/" + container + "/previous"
	}
	return pod + "/" + container + "/current"
}

func (s *Session) append(rec Record) {
	if rec.Timestamp == 0 {
		rec.Timestamp = time.Now().Unix()
	}
	s.mu.Lock()
	s.records = append(s.records, rec)
	s.mu.Unlock()
}

func (s *Session) fail(err error) {
	s.append(Record{Type: "status", Level: "error", Phase: "failed", Message: err.Error()})
	s.close()
}

func (s *Session) close() {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
	}
	s.mu.Unlock()
}

func (s *Session) setJobName(name string) {
	s.mu.Lock()
	s.jobName = name
	s.mu.Unlock()
}

func (s *Session) currentJobName() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jobName
}

func randomID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func eventTime(e corev1.Event) time.Time {
	if !e.LastTimestamp.IsZero() {
		return e.LastTimestamp.Time
	}
	if !e.EventTime.IsZero() {
		return e.EventTime.Time
	}
	if !e.CreationTimestamp.IsZero() {
		return e.CreationTimestamp.Time
	}
	return time.Now()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
