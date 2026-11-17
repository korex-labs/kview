package dataplane

import (
	"sort"
	"strings"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// TemplateReferenceCandidates preserves the detail helper's deliberately narrow
// contract: imagePullSecrets and direct Secret/ConfigMap volumes only. Secret
// image pulls take precedence, otherwise the first Secret volume and the last
// ConfigMap volume supply the display source. Environment/projected/CSI refs
// are not part of this signal even though Resource Map retains those too.
func TemplateReferenceCandidates(template dto.PodTemplateSummaryDTO, volumes []dto.VolumeDTO) []dto.MissingReferenceDTO {
	secrets, configMaps := map[string]string{}, map[string]string{}
	for _, name := range template.ImagePullSecrets {
		if name = strings.TrimSpace(name); name != "" {
			secrets[name] = "imagePullSecret"
		}
	}
	for _, volume := range volumes {
		source := strings.TrimSpace(volume.Source)
		if source == "" {
			continue
		}
		switch strings.ToLower(volume.Type) {
		case "secret":
			if _, exists := secrets[source]; !exists {
				secrets[source] = "volume/" + volume.Name
			}
		case "configmap":
			configMaps[source] = "volume/" + volume.Name
		}
	}
	out := make([]dto.MissingReferenceDTO, 0, len(secrets)+len(configMaps))
	for name, source := range secrets {
		out = append(out, dto.MissingReferenceDTO{Kind: "Secret", Name: name, Source: source})
	}
	for name, source := range configMaps {
		out = append(out, dto.MissingReferenceDTO{Kind: "ConfigMap", Name: name, Source: source})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// TemplateReferenceInventory separates an observed empty inventory from a failed
// observation. Detail UI may still show known missing refs from the other family;
// History must require complete=true before interpreting absence as healthy.
type TemplateReferenceInventory struct {
	Names     map[string]struct{}
	Available bool
}

func MissingTemplateReferences(refs []dto.MissingReferenceDTO, secrets, configMaps TemplateReferenceInventory) ([]dto.MissingReferenceDTO, bool) {
	out := []dto.MissingReferenceDTO{}
	complete := true
	for _, ref := range refs {
		inventory := secrets
		switch ref.Kind {
		case "Secret":
		case "ConfigMap":
			inventory = configMaps
		default:
			complete = false
			continue
		}
		if !inventory.Available {
			complete = false
			continue
		}
		if _, exists := inventory.Names[ref.Name]; !exists {
			out = append(out, ref)
		}
	}
	return out, complete
}
