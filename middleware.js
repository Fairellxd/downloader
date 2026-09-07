const rules = [
  { type: 'XSS', re: /<\s*script|javascript\s*:|onerror\s*=|onload\s*=|<\s*(iframe|svg|img)\b/i },
  { type: 'SQL injection', re: /(union\s+select|select\s+.+\s+from|insert\s+into|drop\s+table|or\s+['"`]?1['"`]?\s*=\s*['"`]?1|--\s)/i },
  { type: 'Path traversal', re: /(\.\.\/|\.\.\\|%2e%2e|%252e%252e)/i },
  { type: 'Command injection', re: /(^|[;&|])\s*(cmd|powershell|bash|sh)\b|\$\([^)]*\)|`[^`]+`/i },
  { type: 'Template injection', re: /\$\{[^}]+\}|\{\{[^}]+\}\}/i }
];

export default function middleware(request) {
  const url = request.nextUrl;
  const rawInput = url.pathname + url.search;

  // Malformed percent-encoding must not crash the middleware.
  let input = rawInput;
  try {
    input = decodeURIComponent(rawInput);
  } catch {
    input = rawInput;
  }

  input = input.slice(0, 8000);
  const hit = rules.find(rule => rule.re.test(input));

  if (!hit) return;

  const target = new URL('/waf.html', request.url);
  target.searchParams.set('detected', hit.type);
  return Response.redirect(target, 307);
}

export const config = {
  matcher: ['/((?!api|waf\.html|favicon\.ico|robots\.txt|sitemap\.xml).*)']
};
