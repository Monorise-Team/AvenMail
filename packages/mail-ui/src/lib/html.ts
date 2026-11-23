import DOMPurify from "dompurify";

/**
 * HTML wiadomości do ramki bez skryptów: DOMPurify usuwa skrypty i obsługę zdarzeń, a polityka CSP w ramce
 * blokuje zewnętrzne zasoby. Obrazy z internetu (często piksele śledzące) ładują się dopiero po zgodzie.
 * Wiadomości HTML są projektowane na jasne tło, więc pokazujemy je zawsze na jasnej „kartce”.
 */
export function messageDocument(html: string, { remoteImages }: { remoteImages: boolean }): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "meta", "link"],
    FORBID_ATTR: ["srcset"],
  });
  const images = remoteImages ? "img-src data: https: http:;" : "img-src data:;";
  const csp = `default-src 'none'; ${images} style-src 'unsafe-inline'; font-src data:;`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
:root{color-scheme:light}
body{margin:0;padding:20px 24px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0a1c26;background:#ffffff;overflow-wrap:anywhere}
img{max-width:100%;height:auto}a{color:#0e7490}blockquote{margin:0 0 0 8px;padding-left:12px;border-left:2px solid #cbd5da}
table{max-width:100%}pre{white-space:pre-wrap}
</style></head><body>${clean}</body></html>`;
}

/** Czy HTML ma obrazy z internetu (do przycisku „Pokaż obrazy”). */
export const hasRemoteImages = (html: string): boolean => /<img[^>]+src=["']?https?:/i.test(html);
