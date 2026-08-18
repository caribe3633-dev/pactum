/**
 * Report registry.
 * Destination: src/lib/reporting/registry.ts
 *
 * A module adds a report by calling registerReport once. The engine never
 * imports a module; modules push into the engine. That inversion is what
 * keeps the renderer free of business logic.
 */

import { ReportDefinition } from './types';

const REGISTRY = new Map<string, ReportDefinition<any>>();

export function registerReport<T>(def: ReportDefinition<T>): void {
  if (REGISTRY.has(def.id)) {
    // Hot reload re-runs module bodies; replacing is correct, warning is noise.
    REGISTRY.set(def.id, def);
    return;
  }
  REGISTRY.set(def.id, def);
}

export function getReport(id: string): ReportDefinition<any> | undefined {
  return REGISTRY.get(id);
}

/** All reports, or only those in one scope. Sorted for a stable picker. */
export function listReports(scope?: string): ReportDefinition<any>[] {
  const all = Array.from(REGISTRY.values());
  const filtered = scope ? all.filter(r => r.scope === scope) : all;
  return filtered.sort((a, b) => a.scope.localeCompare(b.scope) || a.label.localeCompare(b.label));
}

export function listScopes(): string[] {
  return Array.from(new Set(Array.from(REGISTRY.values()).map(r => r.scope))).sort();
}
