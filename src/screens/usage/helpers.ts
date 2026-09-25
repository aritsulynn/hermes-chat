// Pure helpers for the Usage screen.
export interface ToolSkillItem {
  name: string;
  count: number;
  percentage?: number;
}

export function normalizeToolSkillList(raw: any, keyField: 'tool' | 'skill'): ToolSkillItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item, idx) => {
      if (typeof item === 'string') {
        return { name: item, count: 1 };
      }
      if (typeof item === 'object' && item !== null) {
        const name = String(item[keyField] ?? item.name ?? item.id ?? item.key ?? `Item ${idx + 1}`);
        const count = typeof item.count === 'number' ? item.count : Number(item.count || item.total || item.calls || 0);
        const percentage = typeof item.percentage === 'number' ? item.percentage : undefined;
        return { name, count, percentage };
      }
      return { name: String(item), count: 1 };
    });
  }
  if (typeof raw === 'object' && raw !== null) {
    return Object.entries(raw).map(([key, val]) => {
      if (typeof val === 'number') {
        return { name: key, count: val };
      }
      if (typeof val === 'object' && val !== null) {
        const item = val as any;
        const name = String(item[keyField] ?? item.name ?? key);
        const count = typeof item.count === 'number' ? item.count : Number(item.count || item.total || item.calls || 0);
        const percentage = typeof item.percentage === 'number' ? item.percentage : undefined;
        return { name, count, percentage };
      }
      return { name: key, count: Number(val) || 0 };
    });
  }
  return [];
}
