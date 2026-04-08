package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net/http"

	"kview/internal/cluster"
	"kview/internal/kube"
	kubeactions "kview/internal/kube/actions"
	"kview/internal/launcher"
	"kview/internal/runtime"
	"kview/internal/server"
)

// runtimeLogger mirrors kubeconfig discovery messages into both stderr and runtime logs.
type runtimeLogger struct{ rt runtime.RuntimeManager }

func (l runtimeLogger) Printf(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	log.Printf("%s", msg)
	l.rt.Log(runtime.LogLevelInfo, "kubeconfig", msg)
}

func main() {
	addr := flag.String("listen", "127.0.0.1:10443", "listen address")
	open := flag.Bool("open", true, "open browser (deprecated, use --mode)")
	modeFlag := flag.String("mode", "", "launch mode: browser|webview|server")
	flag.Parse()

	// Initialize runtime manager first so we can capture startup logs including kubeconfig discovery.
	rt := runtime.NewManager()

	mgr, err := cluster.NewManagerWithLogger(runtimeLogger{rt: rt})
	if err != nil {
		log.Fatalf("init cluster manager: %v", err)
	}

	token := randomToken(24)
	srv := server.New(mgr, rt, token)

	srv.Actions().Register("scale", kubeactions.HandleDeploymentScale)
	srv.Actions().Register("restart", kubeactions.HandleDeploymentRestart)
	srv.Actions().Register("delete", kubeactions.HandleDeploymentDelete)

	srv.Actions().Register("helm.uninstall", kube.HandleHelmUninstall)
	srv.Actions().Register("helm.upgrade", kube.HandleHelmUpgrade)
	srv.Actions().Register("helm.reinstall", kube.HandleHelmReinstall)

	srv.Actions().Register("pod.delete", kubeactions.HandlePodDelete)

	srv.Actions().Register("daemonset.restart", kubeactions.HandleDaemonSetRestart)
	srv.Actions().Register("daemonset.delete", kubeactions.HandleDaemonSetDelete)

	srv.Actions().Register("statefulset.scale", kubeactions.HandleStatefulSetScale)
	srv.Actions().Register("statefulset.restart", kubeactions.HandleStatefulSetRestart)
	srv.Actions().Register("statefulset.delete", kubeactions.HandleStatefulSetDelete)

	srv.Actions().Register("replicaset.scale", kubeactions.HandleReplicaSetScale)
	srv.Actions().Register("replicaset.delete", kubeactions.HandleReplicaSetDelete)

	srv.Actions().Register("job.delete", kubeactions.HandleJobDelete)

	srv.Actions().Register("cronjob.delete", kubeactions.HandleCronJobDelete)

	srv.Actions().Register("service.delete", kubeactions.HandleServiceDelete)

	srv.Actions().Register("ingress.delete", kubeactions.HandleIngressDelete)

	srv.Actions().Register("configmap.delete", kubeactions.HandleConfigMapDelete)

	srv.Actions().Register("secret.delete", kubeactions.HandleSecretDelete)

	srv.Actions().Register("serviceaccount.delete", kubeactions.HandleServiceAccountDelete)

	srv.Actions().Register("role.delete", kubeactions.HandleRoleDelete)

	srv.Actions().Register("rolebinding.delete", kubeactions.HandleRoleBindingDelete)

	srv.Actions().Register("clusterrole.delete", kubeactions.HandleClusterRoleDelete)

	srv.Actions().Register("clusterrolebinding.delete", kubeactions.HandleClusterRoleBindingDelete)

	srv.Actions().Register("persistentvolumeclaims.delete", kubeactions.HandlePVCDelete)

	srv.Actions().Register("persistentvolumes.delete", kubeactions.HandlePVDelete)

	srv.Actions().Register("nodes.delete", kubeactions.HandleNodeDelete)

	srv.Actions().Register("namespaces.delete", kubeactions.HandleNamespaceDelete)

	srv.Actions().Register("customresourcedefinitions.delete", kubeactions.HandleCRDDelete)
	srv.Actions().Register("custom.workload", kubeactions.HandleCustomWorkloadAction)

	url := fmt.Sprintf("http://%s/?token=%s", *addr, token)
	log.Printf("kview listening on http://%s", *addr)
	log.Printf("open: %s", url)
	rt.Log(runtime.LogLevelInfo, "startup", fmt.Sprintf("listening on http://%s", *addr))
	rt.Log(runtime.LogLevelInfo, "startup", fmt.Sprintf("application URL: %s", url))

	mode, err := launcher.ResolveMode(*modeFlag, *open, defaultMode)
	if err != nil {
		log.Fatalf("invalid mode: %v", err)
	}
	rt.Log(runtime.LogLevelInfo, "startup", fmt.Sprintf("launch mode: %s", mode))

	if mode != launcher.ModeServer {
		go func() {
			if err := launcher.Launch(mode, url); err != nil {
				log.Printf("launcher error: %v", err)
				rt.Log(runtime.LogLevelError, "launcher", err.Error())
			} else {
				rt.Log(runtime.LogLevelInfo, "launcher", "launcher started")
			}
		}()
	}

	if err := http.ListenAndServe(*addr, srv.Router()); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func randomToken(nbytes int) string {
	b := make([]byte, nbytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
