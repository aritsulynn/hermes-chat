// Shared types for the Kanban screen.
// Subset of the desktop KanbanTask — only what this screen reads, so a
// backend schema addition never breaks the build.
export interface KanbanTask {
  id: string;
  title: string;
  body?: string | null;
  status: string;
  assignee?: string | null;
  priority?: number | null;
  progress?: { done: number; total: number } | null;
  warnings?: { count: number } | null;
  comment_count?: number | null;
}

export interface KanbanColumn {
  name: string;
  tasks: KanbanTask[];
}

export interface KanbanBoardData {
  columns: KanbanColumn[];
}

export interface BoardMeta {
  slug: string;
  name?: string | null;
  is_current?: boolean;
  total?: number;
}
