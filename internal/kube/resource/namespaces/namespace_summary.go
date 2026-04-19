package namespaces

import (
	"context"
	"fmt"
	"sync"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
	deployments "github.com/korex-labs/kview/internal/kube/resource/deployments"
	kubehelm "github.com/korex-labs/kview/internal/kube/resource/helm"
	kubejobs "github.com/korex-labs/kview/internal/kube/resource/jobs"
)

const maxProblematic = 10

func GetNamespaceSummary(ctx context.Context, c *cluster.Clients, namespace string) (*dto.NamespaceSummaryResourcesDTO, error) {
	var (
		mu          sync.Mutex
		result      dto.NamespaceSummaryResourcesDTO
		problematic []dto.ProblematicResource
		wg          sync.WaitGroup
		firstErr    error
	)

	setErr := func(err error) {
		mu.Lock()
		if firstErr == nil {
			firstErr = err
		}
		mu.Unlock()
	}

	// pods: count by phase + identify problematic
	wg.Add(1)
	go func() {
		defer wg.Done()
		pods, err := c.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			setErr(fmt.Errorf("list pods: %w", err))
			return
		}
		var health dto.NamespacePodHealth
		var probs []dto.ProblematicResource
		for _, p := range pods.Items {
			switch p.Status.Phase {
			case corev1.PodRunning:
				health.Running++
			case corev1.PodPending:
				health.Pending++
			case corev1.PodFailed:
				health.Failed++
			case corev1.PodSucceeded:
				health.Succeeded++
			default:
				health.Unknown++
			}
			if p.Status.Phase == corev1.PodFailed && len(probs) < maxProblematic {
				reason := "Failed"
				if p.Status.Reason != "" {
					reason = p.Status.Reason
				}
				probs = append(probs, dto.ProblematicResource{Kind: "Pod", Name: p.Name, Reason: reason})
			} else if p.Status.Phase == corev1.PodPending && len(probs) < maxProblematic {
				probs = append(probs, dto.ProblematicResource{Kind: "Pod", Name: p.Name, Reason: "Pending"})
			} else if p.Status.Phase == corev1.PodRunning {
				// check for not-ready containers
				for _, cs := range p.Status.ContainerStatuses {
					if !cs.Ready && len(probs) < maxProblematic {
						reason := "NotReady"
						if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
							reason = cs.State.Waiting.Reason
						}
						probs = append(probs, dto.ProblematicResource{Kind: "Pod", Name: p.Name, Reason: reason})
						break
					}
				}
			}
		}
		mu.Lock()
		result.PodHealth = health
		result.Counts.Pods = len(pods.Items)
		problematic = append(problematic, probs...)
		mu.Unlock()
	}()

	// deployments: count + health + problematic
	wg.Add(1)
	go func() {
		defer wg.Done()
		deps, err := c.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			setErr(fmt.Errorf("list deployments: %w", err))
			return
		}
		var dh dto.NamespaceDeploymentHealth
		var probs []dto.ProblematicResource
		for _, d := range deps.Items {
			desired := int32(0)
			if d.Spec.Replicas != nil {
				desired = *d.Spec.Replicas
			}
			status := deployments.DeploymentStatus(d, desired)
			switch status {
			case "Available":
				dh.Healthy++
			case "Progressing":
				dh.Progressing++
			default:
				if desired > 0 {
					dh.Degraded++
					if len(probs) < maxProblematic {
						probs = append(probs, dto.ProblematicResource{
							Kind:   "Deployment",
							Name:   d.Name,
							Reason: deploymentProblemReason(d, status),
						})
					}
				}
			}
		}
		mu.Lock()
		result.DeployHealth = dh
		result.Counts.Deployments = len(deps.Items)
		problematic = append(problematic, probs...)
		mu.Unlock()
	}()

	// jobs: count + identify failed
	wg.Add(1)
	go func() {
		defer wg.Done()
		jobs, err := c.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			setErr(fmt.Errorf("list jobs: %w", err))
			return
		}
		var probs []dto.ProblematicResource
		for _, j := range jobs.Items {
			if kubejobs.JobStatus(&j) == "Failed" && len(probs) < maxProblematic {
				probs = append(probs, dto.ProblematicResource{Kind: "Job", Name: j.Name, Reason: "Failed"})
			}
		}
		mu.Lock()
		result.Counts.Jobs = len(jobs.Items)
		problematic = append(problematic, probs...)
		mu.Unlock()
	}()

	// simple counts: statefulsets, daemonsets, cronjobs, services, ingresses, pvcs, configmaps, secrets
	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.StatefulSets = len(list.Items)
		mu.Unlock()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.DaemonSets = len(list.Items)
		mu.Unlock()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.CronJobs = len(list.Items)
		mu.Unlock()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.Services = len(list.Items)
		mu.Unlock()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.Ingresses = len(list.Items)
		mu.Unlock()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.PVCs = len(list.Items)
		mu.Unlock()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.ConfigMaps = len(list.Items)
		mu.Unlock()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		list, err := c.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		result.Counts.Secrets = len(list.Items)
		mu.Unlock()
	}()

	// helm releases
	wg.Add(1)
	go func() {
		defer wg.Done()
		releases, err := kubehelm.ListHelmReleases(ctx, c, namespace)
		if err != nil {
			return
		}
		var helmSlim []dto.NamespaceHelmRelease
		for _, r := range releases {
			helmSlim = append(helmSlim, dto.NamespaceHelmRelease{
				Name:     r.Name,
				Status:   r.Status,
				Revision: r.Revision,
			})
		}
		mu.Lock()
		result.Counts.HelmReleases = len(releases)
		result.HelmReleases = helmSlim
		mu.Unlock()
	}()

	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	// cap total problematic at maxProblematic
	if len(problematic) > maxProblematic {
		problematic = problematic[:maxProblematic]
	}
	result.Problematic = problematic
	if result.Problematic == nil {
		result.Problematic = []dto.ProblematicResource{}
	}

	return &result, nil
}

func deploymentProblemReason(d appsv1.Deployment, status string) string {
	if d.Status.UnavailableReplicas > 0 {
		return fmt.Sprintf("%d unavailable", d.Status.UnavailableReplicas)
	}
	if status == "Paused" {
		return "Paused"
	}
	if status == "ScaledDown" {
		return "ScaledDown"
	}
	for _, c := range d.Status.Conditions {
		if c.Type == appsv1.DeploymentAvailable && c.Status != corev1.ConditionTrue {
			if c.Reason != "" {
				return c.Reason
			}
		}
	}
	return status
}
