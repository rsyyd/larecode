import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface ContextQuery {
  root: string;
  query: string;
  maxFiles: number;
}

export interface RelevanceScore {
  file: string;
  score: number;
}

export interface ContextResult {
  files: RelevanceScore[];
  budgetUsed: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next"]);

export class Context {
  private files: string[] = [];

  index(root: string): number {
    this.files = [];
    this.walk(root, root);
    return this.files.length;
  }

  private walk(root: string, dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        this.walk(root, full);
      } else {
        this.files.push(relative(root, full));
      }
    }
  }

  search(query: ContextQuery): ContextResult {
    // ponytail: substring scoring until T-18 ships relevance ranking
    const ranked = this.files
      .map((file) => {
        try {
          const content = readFileSync(join(query.root, file), "utf8").toLowerCase();
          const hits = content.split(query.query.toLowerCase()).length - 1;
          const nameBoost = file.toLowerCase().includes(query.query.toLowerCase()) ? 10 : 0;
          return { file, score: hits + nameBoost };
        } catch {
          return { file, score: 0 };
        }
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.maxFiles);
    return { files: ranked, budgetUsed: ranked.length };
  }
}