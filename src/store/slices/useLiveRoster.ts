// Live roster slice — the agent's todo list and the polled subagent roster.
// Setters are returned because the WS handlers (todo.updated) and session
// resets also write them.
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { normalizeSubagents } from '../../utils/messages';
import type { SubagentRow, TodoItem } from '../../utils/messages';
import type { StoreCtx } from '../ctx';

export interface LiveRosterSlice {
  todos: TodoItem[];
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  subagents: SubagentRow[];
  setSubagents: Dispatch<SetStateAction<SubagentRow[]>>;
}

export function useLiveRosterSlice({ generating, sessionId, gw }: StoreCtx): LiveRosterSlice {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [subagents, setSubagents] = useState<SubagentRow[]>([]);

  // Live subagent roster — polled while a turn runs (subagent.list is scoped to
  // this session). Cheap: the RPC returns a small snapshot.
  useEffect(() => {
    const g = gw.current;
    if (!generating || !sessionId || !g) return;
    let live = true;
    const sameRows = (a: SubagentRow[], b: SubagentRow[]) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (
          x.subagent_id !== y.subagent_id ||
          x.status !== y.status ||
          x.tool_count !== y.tool_count ||
          x.last_tool !== y.last_tool
        )
          return false;
      }
      return true;
    };
    const tick = () => {
      g.subagents(sessionId)
        .then((r) => {
          if (!live) return;
          const next = normalizeSubagents(r);
          // New array every tick re-renders the dock even when nothing changed.
          setSubagents((prev) => (sameRows(prev, next) ? prev : next));
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 3500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [generating, sessionId, gw]);

  return { todos, setTodos, subagents, setSubagents };
}
