import type { ApiDataplaneSearchItem } from "../../types/api";
import type { ListResourceKey } from "../../utils/k8sResources";
import { resolveResourceDrawerIdentity } from "../shared/resourceMapIdentity";

export type { ResourceDrawerDestination } from "../shared/resourceMapIdentity";

export function searchResultMapIdentity(item: ApiDataplaneSearchItem) {
  return resolveResourceDrawerIdentity({ resource: item.kind as ListResourceKey, namespace: item.namespace, name: item.name });
}
