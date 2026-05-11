const MAX_PREFIX_LENGTH = 32;
const NAME_PREFIX_MIN_LENGTH = 1;
const NAME_STOP_WORDS = new Set(["a", "an", "and", "co", "company", "corp", "corporation", "inc", "incorporated", "llc", "lp", "ltd", "the"]);

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ");
}

function prefixesFor(value: string, minLength: number): string[] {
  const normalized = normalizeSearchText(value);
  const maxLength = Math.min(normalized.length, MAX_PREFIX_LENGTH);
  const prefixes: string[] = [];

  for (let index = minLength; index <= maxLength; index += 1) {
    prefixes.push(normalized.slice(0, index));
  }

  return prefixes;
}

function tokenizeInstitutionName(name: string): string[] {
  return Array.from(
    new Set(
      normalizeSearchText(name)
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= NAME_PREFIX_MIN_LENGTH && !NAME_STOP_WORDS.has(token)),
    ),
  );
}

export function institutionNameSearchText(name: string): string {
  return normalizeSearchText(name);
}

export function buildInstitutionSearchPrefixes(input: { cik: string; name: string }): string[] {
  const prefixes = new Set<string>();
  const cik = input.cik.trim();
  const unpaddedCik = cik.replace(/^0+/, "") || cik;

  for (const prefix of prefixesFor(unpaddedCik, 1)) {
    prefixes.add(prefix);
  }

  for (const prefix of prefixesFor(cik, 1)) {
    prefixes.add(prefix);
  }

  for (const prefix of prefixesFor(input.name, NAME_PREFIX_MIN_LENGTH)) {
    prefixes.add(prefix);
  }

  for (const token of tokenizeInstitutionName(input.name)) {
    for (const prefix of prefixesFor(token, NAME_PREFIX_MIN_LENGTH)) {
      prefixes.add(prefix);
    }
  }

  return Array.from(prefixes).sort();
}
