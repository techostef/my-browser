import { DownloadTask } from "../../types";

export type DownloadGridItem =
  | {
      type: "folder";
      path: string;
      name: string;
      source: "private" | "device";
      isDeviceRoot?: boolean;
    }
  | { type: "file"; task: DownloadTask };

export type FolderGridItem = Extract<DownloadGridItem, { type: "folder" }>;

export type SortKey =
  | "name_asc"
  | "name_desc"
  | "date_newest"
  | "date_oldest"
  | "size_largest"
  | "size_smallest"
  | "duration_longest"
  | "duration_shortest"
  | "type";

export type FilterType = "all" | "video" | "audio" | "image" | "other";
