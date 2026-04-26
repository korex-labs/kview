package kube

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	clientexec "k8s.io/client-go/util/exec"
)

type ContainerCommandRequest struct {
	Namespace  string `json:"namespace"`
	Pod        string `json:"pod"`
	Container  string `json:"container"`
	Command    string `json:"command"`
	Workdir    string `json:"workdir"`
	OutputType string `json:"outputType"`
	FileName   string `json:"fileName"`
	Compress   bool   `json:"compress"`
}

type ContainerCommandResult struct {
	Stdout       string `json:"stdout,omitempty"`
	Stderr       string `json:"stderr,omitempty"`
	OutputBase64 string `json:"outputBase64,omitempty"`
	ExitCode     int    `json:"exitCode"`
	DurationMs   int64  `json:"durationMs"`
	FileName     string `json:"fileName,omitempty"`
	Compressed   bool   `json:"compressed,omitempty"`
	Error        string `json:"error,omitempty"`
}

type ContainerCommandClient struct {
	Clientset  kubernetes.Interface
	RestConfig *rest.Config
}

func (c ContainerCommandClient) Run(ctx context.Context, req ContainerCommandRequest) (ContainerCommandResult, error) {
	ns := strings.TrimSpace(req.Namespace)
	pod := strings.TrimSpace(req.Pod)
	container := strings.TrimSpace(req.Container)
	command := strings.TrimSpace(req.Command)
	if ns == "" || pod == "" || container == "" || command == "" {
		return ContainerCommandResult{}, fmt.Errorf("namespace, pod, container, and command are required")
	}
	if c.Clientset == nil || c.RestConfig == nil {
		return ContainerCommandResult{}, fmt.Errorf("kubernetes client is not configured")
	}

	execCommand := buildContainerShellCommand(command, req.Workdir)
	restClient := c.Clientset.CoreV1().RESTClient()
	kubeReq := restClient.Post().
		Resource("pods").
		Namespace(ns).
		Name(pod).
		SubResource("exec").
		Param("container", container).
		Param("stdin", "false").
		Param("stdout", "true").
		Param("stderr", "true").
		Param("tty", "false")
	for _, c := range execCommand {
		kubeReq = kubeReq.Param("command", c)
	}

	executor, err := remotecommand.NewSPDYExecutor(c.RestConfig, http.MethodPost, kubeReq.URL())
	if err != nil {
		return ContainerCommandResult{}, fmt.Errorf("create executor: %w", err)
	}

	start := time.Now()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	streamErr := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
		Tty:    false,
	})

	result := ContainerCommandResult{
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		ExitCode:   0,
		DurationMs: time.Since(start).Milliseconds(),
	}
	if streamErr != nil {
		result.ExitCode = 1
		result.Error = streamErr.Error()
		if exitErr, ok := streamErr.(clientexec.ExitError); ok {
			result.ExitCode = exitErr.ExitStatus()
		}
	}

	if req.OutputType == "file" {
		payload := stdout.Bytes()
		fileName := strings.TrimSpace(req.FileName)
		if fileName == "" {
			fileName = "container-command-output.txt"
		}
		if req.Compress {
			var compressed bytes.Buffer
			gz := gzip.NewWriter(&compressed)
			if _, err := gz.Write(payload); err != nil {
				return ContainerCommandResult{}, fmt.Errorf("compress output: %w", err)
			}
			if err := gz.Close(); err != nil {
				return ContainerCommandResult{}, fmt.Errorf("finish compressed output: %w", err)
			}
			payload = compressed.Bytes()
			if !strings.HasSuffix(fileName, ".gz") {
				fileName += ".gz"
			}
			result.Compressed = true
		}
		result.OutputBase64 = base64.StdEncoding.EncodeToString(payload)
		result.FileName = fileName
		result.Stdout = ""
	}

	return result, nil
}

func buildContainerShellCommand(command string, workdir string) []string {
	shellCommand := strings.TrimSpace(command)
	if wd := strings.TrimSpace(workdir); wd != "" {
		shellCommand = "cd " + shellQuote(wd) + " && " + shellCommand
	}
	return []string{"/bin/sh", "-lc", shellCommand}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
