import { next, ipAddress } from '@vercel/functions';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 90;
const BLOCK_MS = 60_000;
const buckets = new Map();

// Fixed risk per detection. The highest matching rule becomes the request risk.
const RULES = [
  { name: 'XSS', score: 90, severity: 'CRITICAL', re: /<\s*script|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|on(?:error|load|click|mouseover)\s*=|<\s*(iframe|svg|img|object|embed)\b/i },
  { name: 'SQL Injection', score: 100, severity: 'CRITICAL', re: /(?:union\s+(?:all\s+)?select|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|drop\s+(?:table|database)|(?:or|and)\s+['"`]?\d+['"`]?\s*=\s*['"`]?\d+['"`]?|--\s|\/\*)/i },
  { name: 'Path Traversal', score: 85, severity: 'HIGH', re: /(?:\.\.\/|\.\.\\|%2e%2e|%252e%252e|%2f%2e%2e|%5c%2e%2e)/i },
  { name: 'Command Injection', score: 100, severity: 'CRITICAL', re: /(?:^|[;&|])\s*(?:cmd(?:\.exe)?|powershell|pwsh|bash|sh|zsh)\b|\$\([^)]{1,200}\)|`[^`\n]{1,200}`/i },
  { name: 'Template Injection', score: 90, severity: 'CRITICAL', re: /(?:\$\{[^}]{1,200}\}|\{\{[^}]{1,200}\}\}|<%[\s\S]{0,200}%>)/i },
  { name: 'SSRF Pattern', score: 90, severity: 'CRITICAL', re: /(?:https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|169\.254\.169\.254)|https?:\/\/\[::1\])/i },
  { name: 'XXE Pattern', score: 90, severity: 'CRITICAL', re: /<!DOCTYPE[\s\S]{0,500}(?:ENTITY|SYSTEM)\b/i },
  { name: 'Suspicious File Path', score: 75, severity: 'HIGH', re: /(?:\/etc\/(?:passwd|shadow)|(?:boot|windows)\.ini|web\.config|\.env(?:\b|\/)|id_rsa(?:\.pub)?)/i },
  { name: 'Encoded Payload', score: 65, severity: 'MEDIUM', re: /(?:%3c|%3e|%22|%27|%24%7b|%7b%7b|%2e%2e|%252e)/i }
];

function inspect(request) {
  const url = new URL(request.url);
  const headerSample = [
    request.headers.get('user-agent') || '',
    request.headers.get('referer') || '',
    request.headers.get('content-type') || ''
  ].join(' ');
  const sample = `${url.pathname}?${url.searchParams.toString()} ${headerSample}`.slice(0, 12000);

  let score = 0;
  let severity = 'LOW';
  const hits = [];
  for (const rule of RULES) {
    if (rule.re.test(sample)) {
      score = Math.max(score, rule.score);
      hits.push(rule.name);
      if (rule.score >= 90) severity = 'CRITICAL';
      else if (rule.score >= 70 && severity !== 'CRITICAL') severity = 'HIGH';
      else if (rule.score >= 40 && severity === 'LOW') severity = 'MEDIUM';
    }
  }

  const method = request.method.toUpperCase();
  if (method === 'TRACE' || method === 'CONNECT') {
    score = Math.max(score, 80);
    severity = score >= 90 ? severity : 'HIGH';
    hits.push('Suspicious HTTP Method');
  }
  if (url.pathname.length > 1800) score = Math.max(score, 50);
  if (url.search.length > 5000) score = Math.max(score, 50);

  return { score: Math.min(score, 100), severity, hits, method, pathname: url.pathname };
}

function rateLimit(key) {
  const now = Date.now();
  const old = buckets.get(key);
  if (!old || now - old.started > WINDOW_MS) {
    buckets.set(key, { started: now, count: 1, blockedUntil: 0 });
    return { blocked: false, remaining: MAX_REQUESTS - 1 };
  }
  old.count += 1;
  if (old.blockedUntil > now) return { blocked: true, remaining: 0 };
  if (old.count > MAX_REQUESTS) {
    old.blockedUntil = now + BLOCK_MS;
    return { blocked: true, remaining: 0 };
  }
  return { blocked: false, remaining: MAX_REQUESTS - old.count };
}

export default function middleware(request, context) {
  try {
    const ip = ipAddress(request) || 'unknown';
    const result = inspect(request);
    const limit = rateLimit(ip);
    const suspicious = result.score >= 35 || result.hits.length > 0;
    const shouldBlock = suspicious || limit.blocked;
    const finalScore = limit.blocked ? 100 : result.score;
    const finalSeverity = limit.blocked ? 'CRITICAL' : result.severity;

    console.log(JSON.stringify({
      waf: 'Rellify',
      action: shouldBlock ? 'BLOCK' : 'ALLOW',
      ip: ip === 'unknown' ? 'unknown' : '[redacted]',
      method: result.method,
      path: result.pathname,
      score: finalScore,
      severity: finalSeverity,
      detections: result.hits,
      rateLimited: limit.blocked
    }));

    if (shouldBlock && !result.pathname.startsWith('/waf.html')) {
      const target = new URL('/waf.html', request.url);
      target.searchParams.set('detected', limit.blocked ? 'Rate Limit' : (result.hits[0] || 'Suspicious Request'));
      target.searchParams.set('score', String(finalScore));
      target.searchParams.set('severity', finalSeverity);
      target.searchParams.set('count', String(result.hits.length));
      return Response.redirect(target, 307);
    }

    const response = next({
      headers: {
        'X-Rellify-WAF': 'active',
        'X-Rellify-Risk': String(finalScore),
        'X-Rellify-Severity': finalSeverity,
        'X-Rellify-Rate-Remaining': String(limit.remaining)
      }
    });

    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return response;
  } catch (error) {
    console.error('[Rellify WAF]', error);
    return next();
  }
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|robots.txt|sitemap.xml).*)']
};
