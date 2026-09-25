// Shared types for the Cron Jobs screen (REST payload shapes).
export interface CronJobItem {
  id: string;
  name?: string | null;
  prompt?: string | null;
  schedule?: { kind?: string; expr?: string; display?: string } | string;
  schedule_display?: string | null;
  enabled?: boolean;
  state?: string | null;
  deliver?: string | null;
  model?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  skills?: string[] | null;
  profile?: string | null;
}

export interface CronRunItem {
  id: string;
  title?: string | null;
  started_at?: number | string | null;
  ended_at?: number | string | null;
  last_active?: number | null;
  is_active?: boolean;
  message_count?: number | null;
  tool_call_count?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  reasoning_tokens?: number | null;
  estimated_cost_usd?: number | null;
  preview?: string | null;
  end_reason?: string | null;
  profile?: string | null;
}

export interface RunMessageItem {
  id?: string | number;
  role: string;
  content?: any;
  display_content?: any;
  name?: string;
  tool_name?: string;
  tool_calls?: any;
  reasoning?: string;
  reasoning_content?: string;
  timestamp?: number;
}
