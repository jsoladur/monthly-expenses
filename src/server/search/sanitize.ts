export const SEARCH_TERM_MIN_LENGTH = 3;
export const SEARCH_TERM_MAX_LENGTH = 80;

export const SQL_ACCENT_FROM =
  "áàäâãåéèëêíìïîóòöôúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ";
export const SQL_ACCENT_TO =
  "aaaaaaeeeeiiiioooouuuuncaaaaaaeeeeiiiioooouuuunc";

export function foldAccents(raw: string): string {
  return raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function foldSearchText(raw: string): string {
  const sliced =
    raw.length > SEARCH_TERM_MAX_LENGTH
      ? raw.slice(0, SEARCH_TERM_MAX_LENGTH)
      : raw;
  return foldAccents(sliced).trim().replace(/\s+/g, " ");
}

export function escapeLike(term: string): string {
  return term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function sanitizeSearchTerm(raw: string): string | null {
  const folded = foldSearchText(raw);
  if (folded.length < SEARCH_TERM_MIN_LENGTH) return null;
  return escapeLike(folded);
}
