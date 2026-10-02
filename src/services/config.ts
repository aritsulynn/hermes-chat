// Config — the `config.yaml` surface.
//
// Wraps `hermes_cli/web_routers/analytics.py` + `config_env.py`. Transport only.
import { configObject, configRaw, configSchema } from './api';

export interface RawConfig {
  yaml: string;
  path: string;
}

export interface ConfigSchemaField {
  category: string;
  description: string;
  type: string;
  options: Array<{ value: string; label: string }>;
  default: unknown;
}

export interface ConfigSchema {
  fields: Record<string, ConfigSchemaField>;
  categoryOrder: string[];
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

export async function getRawConfig(opsGet: OpsGet, profile?: string | null): Promise<RawConfig> {
  const r = rec(await opsGet(configRaw(profile)));
  return { yaml: str(r.yaml), path: str(r.path) };
}

/** Full-document replacement of config.yaml. Backend validates the YAML. */
export async function saveRawConfig(opsMut: OpsMut, yamlText: string, profile?: string | null): Promise<void> {
  await opsMut(configRaw(profile), 'PUT', { yaml_text: yamlText, ...(profile ? { profile } : {}) });
}

/** The normalized config object (used to count/verify saved keys). */
export async function getConfigObject(opsGet: OpsGet, profile?: string | null): Promise<Record<string, unknown>> {
  return rec(await opsGet(configObject(profile)));
}

/** Schema-driven metadata for the form surface. */
export async function getConfigSchema(opsGet: OpsGet, profile?: string | null): Promise<ConfigSchema> {
  const r = rec(await opsGet(configSchema(profile)));
  const fields: Record<string, ConfigSchemaField> = {};
  for (const [key, raw] of Object.entries(rec(r.fields))) {
    const f = rec(raw);
    const options: Array<{ value: string; label: string }> = [];
    if (Array.isArray(f.options)) {
      for (const o of f.options) {
        const opt = rec(o);
        options.push({ value: str(opt.value), label: str(opt.label) || str(opt.value) });
      }
    }
    fields[key] = {
      category: str(f.category),
      description: str(f.description),
      type: str(f.type),
      options,
      default: f.default,
    };
  }
  return {
    fields,
    categoryOrder: Array.isArray(r.category_order) ? r.category_order.map(str).filter(Boolean) : [],
  };
}
