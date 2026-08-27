// CORE D1 ONLY — service names are resolved from the canonical catalog.
import { CoreCatalogService } from "./CoreCatalogService";

const cache = new Map<string, string>();
let loaded = false;

export async function resolveServiceName(serviceId?: string) {
  const id = String(serviceId || "").trim();
  if (!id) return "—";
  if (cache.has(id)) return cache.get(id)!;

  if (!loaded) {
    const services = await CoreCatalogService.listServices({ activeOnly: false });
    cache.clear();
    for (const service of services) {
      if (service.id) cache.set(service.id, String(service.name || "—"));
    }
    loaded = true;
  }

  return cache.get(id) || "—";
}
