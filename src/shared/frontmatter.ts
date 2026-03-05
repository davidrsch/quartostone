// src/shared/frontmatter.ts
// Shared frontmatter types used by both client and server.

/**
 * Typed shape of a Quarto/Markdown document's YAML frontmatter block.
 * The index signature allows arbitrary extra keys from `yaml.parse`.
 */
export interface Frontmatter {
  [key: string]: unknown;
  title?: string;
  author?: string;
  date?: string;
  categories?: string[];
  description?: string;
  draft?: boolean;
  icon?: string;
}
