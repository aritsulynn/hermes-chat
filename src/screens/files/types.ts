// Shared types for the Files screen (dashboard managed-files REST shapes).
export interface ManagedFileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
  mtime: number;
  mime_type: string | null;
}

export interface ManagedFilesResponse {
  root: string | null;
  path: string;
  parent: string | null;
  locked_root: string | null;
  can_change_path: boolean;
  entries: ManagedFileEntry[];
}

export interface ManagedFileReadResponse {
  name: string;
  path: string;
  size: number;
  mime_type: string;
  data_url: string;
  root: string | null;
  locked_root: string | null;
  can_change_path: boolean;
}
