import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const NOTION_VERSION = "2022-06-28";
const DEFAULT_PAGE_ID = "3549ac2a722b80a38079c53d5c704017";
const DEFAULT_MARKDOWN = "src/hardhat/test/performance/phase4-notion-report.md";

const token = process.env.NOTION_API_KEY;
const pageId = normalizePageId(process.env.NOTION_PHASE4_PAGE_ID || DEFAULT_PAGE_ID);
const markdownPath = resolve(process.env.PHASE4_MARKDOWN_PATH || DEFAULT_MARKDOWN);
const dryRun = process.argv.includes("--dry-run");

const markdown = await readFile(markdownPath, "utf8");
const blocks = markdownToBlocks(markdown);

console.log(`Markdown: ${markdownPath}`);
console.log(`Page ID:  ${pageId}`);
console.log(`Blocks:   ${blocks.length}`);

if (dryRun) {
  console.log("Dry run only. No Notion write performed.");
  console.log(JSON.stringify(blocks.slice(0, 5), null, 2));
  process.exit(0);
}

if (!token) {
  throw new Error("Missing NOTION_API_KEY environment variable.");
}

const previousChildren = await listAllChildren(pageId);
const backupPath = await writeBackup(previousChildren);
console.log(`Backup:   ${backupPath}`);

const archivedOldIds = [];
const appendedNewIds = [];

try {
  for (const child of previousChildren) {
    await notion(`blocks/${child.id}`, {
      method: "PATCH",
      body: { archived: true },
    });
    archivedOldIds.push(child.id);
  }
  console.log(`Archived previous top-level blocks: ${previousChildren.length}`);

  for (const chunk of chunks(blocks, 50)) {
    const response = await notion(`blocks/${pageId}/children`, {
      method: "PATCH",
      body: { children: chunk },
    });
    appendedNewIds.push(...response.results.map((block) => block.id));
  }

  console.log(`Updated Notion page with ${blocks.length} blocks.`);
} catch (error) {
  console.error("Notion update failed. Restoring previous visible blocks...");

  for (const id of appendedNewIds) {
    await notion(`blocks/${id}`, {
      method: "PATCH",
      body: { archived: true },
    }).catch(() => {});
  }

  for (const id of archivedOldIds) {
    await notion(`blocks/${id}`, {
      method: "PATCH",
      body: { archived: false },
    }).catch(() => {});
  }

  throw error;
}

function normalizePageId(value) {
  const compact = value.replace(/-/g, "").trim();
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) {
    throw new Error(`Invalid Notion page ID: ${value}`);
  }
  return compact;
}

async function writeBackup(children) {
  const dir = resolve("notion-backups");
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `phase4-${timestamp}.json`);
  await writeFile(path, JSON.stringify({
    pageId,
    source: basename(markdownPath),
    savedAt: new Date().toISOString(),
    children,
  }, null, 2));
  return path;
}

async function listAllChildren(blockId) {
  const children = [];
  let cursor;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) {
      params.set("start_cursor", cursor);
    }
    const page = await notion(`blocks/${blockId}/children?${params.toString()}`);
    children.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);

  return children;
}

async function notion(path, options = {}) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Notion API ${response.status}: ${JSON.stringify(payload, null, 2)}`);
  }
  return payload;
}

function markdownToBlocks(input) {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || "plain text";
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      out.push(codeBlock(code.join("\n"), language));
      continue;
    }

    if (isTableStart(lines, i)) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i += 1;
      }
      out.push(tableBlock(tableLines));
      continue;
    }

    if (trimmed.startsWith("### ")) {
      out.push(heading("heading_3", trimmed.slice(4)));
      i += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      out.push(heading("heading_2", trimmed.slice(3)));
      i += 1;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      out.push(heading("heading_1", trimmed.slice(2)));
      i += 1;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      out.push(listItem(trimmed.slice(2)));
      i += 1;
      continue;
    }

    const paragraph = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("- ") &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("|")
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    out.push(paragraphBlock(paragraph.join(" ")));
  }

  return out;
}

function isTableStart(lines, index) {
  return (
    lines[index]?.trim().startsWith("|") &&
    lines[index + 1]?.trim().startsWith("|") &&
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[index + 1].trim())
  );
}

function heading(type, text) {
  return {
    object: "block",
    type,
    [type]: { rich_text: richText(text) },
  };
}

function paragraphBlock(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(text) },
  };
}

function listItem(text) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(text) },
  };
}

function codeBlock(text, language) {
  return {
    object: "block",
    type: "code",
    code: {
      language: notionLanguage(language),
      rich_text: plainChunks(text),
    },
  };
}

function tableBlock(lines) {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map(parseTableRow);
  const width = Math.max(...rows.map((row) => row.length));

  return {
    object: "block",
    type: "table",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: rows.map((row) => ({
        object: "block",
        type: "table_row",
        table_row: {
          cells: Array.from({ length: width }, (_, index) => richText(row[index] || "")),
        },
      })),
    },
  };
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function richText(text) {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(...plainChunks(text.slice(cursor, match.index)));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(...plainChunks(token.slice(1, -1), { code: true }));
    } else {
      parts.push(...plainChunks(token.slice(2, -2), { bold: true }));
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    parts.push(...plainChunks(text.slice(cursor)));
  }

  return parts.length ? parts : [];
}

function plainChunks(text, annotations = {}) {
  if (!text) {
    return [];
  }

  const chunksOut = [];
  for (let i = 0; i < text.length; i += 1900) {
    chunksOut.push({
      type: "text",
      text: { content: text.slice(i, i + 1900) },
      annotations,
    });
  }
  return chunksOut;
}

function notionLanguage(language) {
  const normalized = language.toLowerCase();
  if (normalized === "bash" || normalized === "sh" || normalized === "shell") {
    return "shell";
  }
  if (normalized === "json") {
    return "json";
  }
  return "plain text";
}

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}
