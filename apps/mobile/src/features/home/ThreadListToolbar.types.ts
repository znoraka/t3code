import type { MenuAction } from "@react-native-menu/menu";

export interface ThreadListToolbarProps {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly filterActions: MenuAction[];
  readonly filterCustomized: boolean;
  readonly onFilterSelect: (id: string) => void;
  readonly onOpenEnvironments: () => void;
  // [FORK] lempire: only the Home header offers pull requests; the sidebar copy omits it.
  readonly onOpenPullRequests?: () => void;
  readonly onRequestVisibility?: () => void;
}
