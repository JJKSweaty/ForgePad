export type LibraryFilters = {
  query: string;
  type: string;
  difficulty: string;
  topic: string;
  status: string;
  bookmarked: boolean;
  archived: boolean;
  sort: string;
};
export const defaultLibraryFilters: LibraryFilters = {
  query: "",
  type: "",
  difficulty: "",
  topic: "",
  status: "",
  bookmarked: false,
  archived: false,
  sort: "recent",
};
