/**
 * Aave publishes proposal metadata to IPFS in two shapes, and both are live:
 *
 *  - JSON (`application/json`) — the early governor v2 AIPs, e.g. AIP 5:
 *      {"title":"AIP 5: Adding CRV to Aave","shortDescription":"…","description":"…"}
 *  - Markdown with YAML front matter (`text/plain`) — everything from ~2022 on, and every
 *    governance v3 proposal:
 *      ---
 *      title: Add 1INCH to Aave v2 market
 *      shortDescription: Add 1INCH as collateral on the Aave V2 market
 *      ---
 *      ## Simple Summary
 *      …
 *
 * The front matter carries the human title; the body's first heading is a section name
 * ("Simple Summary"), so falling back to the body alone would mis-title the proposal.
 */

export interface AaveMetadata {
  title: string | null;
  description: string;
}

/** Parse an IPFS metadata document in either shape. Returns null if it is neither. */
export function parseAaveMetadata(text: string): AaveMetadata | null {
  return parseJsonMetadata(text) ?? parseFrontMatterMetadata(text);
}

interface AaveMetadataJson {
  title?: unknown;
  description?: unknown;
  shortDescription?: unknown;
}

function parseJsonMetadata(text: string): AaveMetadata | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (body == null || typeof body !== 'object') return null;

  const metadata = body as AaveMetadataJson;
  const description =
    typeof metadata.description === 'string'
      ? metadata.description
      : typeof metadata.shortDescription === 'string'
        ? metadata.shortDescription
        : '';
  return { title: typeof metadata.title === 'string' ? metadata.title : null, description };
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function parseFrontMatterMetadata(text: string): AaveMetadata | null {
  const match = FRONT_MATTER.exec(text);
  if (match === null) return null;
  const block = match[1];
  if (block === undefined) return null;

  const body = text.slice(match[0].length).trim();
  const title = readScalar(block, 'title');
  const shortDescription = readScalar(block, 'shortDescription');

  // Prefer the body as the description — it is the proposal text. shortDescription is the only
  // prose available when a document is front matter and nothing else.
  return {
    title: title ?? shortDescription,
    description: body.length > 0 ? body : (shortDescription ?? ''),
  };
}

/**
 * Read a top-level scalar out of a YAML front-matter block without taking a YAML dependency
 * (`libs/sources/*` stays framework- and dependency-light). Only unindented `key: value` lines are
 * considered, so nested keys under another mapping cannot be mistaken for the document's own.
 * Block scalars (`title: >`) and multi-line values are out of scope: Aave writes titles inline, and
 * a missed title degrades to the placeholder rather than a wrong one.
 */
function readScalar(block: string, key: string): string | null {
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(' ') || line.startsWith('\t') || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== key) continue;

    const value = unquote(line.slice(separator + 1).trim());
    return value.length > 0 ? value : null;
  }
  return null;
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}
