import { createPrivateKey, sign } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';
import type { GitHubIssueEvent, GitHubTrust } from '../../ports/github.js';
import type { GitHubOwnerFeedback } from '../../core/github-mvp.js';
import type { GitHubCursorStore, GitHubIssueReader, GitHubIssueWriter } from '../../ports/github-api.js';

const apiHost = 'api.github.com';
const maxResponseBytes = 1_000_000;
const maxAttempts = 3;
const responseSchema = z.object({ status: z.number().int(), headers: z.record(z.string(), z.string()), body: z.string() });
export interface GitHubHttpTransport { request(method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: string, signal?: AbortSignal): Promise<z.infer<typeof responseSchema>>; }

/** Native TLS transport with a fixed GitHub API origin and bounded responses. */
export class NodeGitHubHttpsTransport implements GitHubHttpTransport {
  async request(method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: string, signal?: AbortSignal): Promise<z.infer<typeof responseSchema>> {
    if (!/^\/[A-Za-z0-9_./?=&-]+$/.test(path) || path.includes('..')) throw new Error('GitHub API path is not allowed.');
    return new Promise((resolve, reject) => {
      const req = httpsRequest({ hostname: apiHost, port: 443, method, path, headers: { ...headers, host: apiHost, 'user-agent': 'agentic-factory-mvp01', accept: 'application/vnd.github+json', ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}) }, signal, timeout: 10_000 }, (res) => {
        const chunks: Buffer[] = []; let bytes = 0;
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes <= maxResponseBytes) chunks.push(chunk); else req.destroy(new Error('GitHub response exceeds the allowed bound.')); });
        res.on('end', () => resolve(responseSchema.parse({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] ?? '' : String(v ?? '')])), body: Buffer.concat(chunks).toString('utf8') })));
      });
      req.on('error', reject); if (body) req.write(body); req.end();
    });
  }
}

const repoSchema = z.object({ id: z.number().int().positive(), full_name: z.string().min(1) }).passthrough();
const issueSchema = z.object({ id: z.number().int().positive(), number: z.number().int().positive(), title: z.string().min(1).max(4000), body: z.string().nullable(), repository_url: z.string().url(), updated_at: z.string().datetime({ offset: true }), user: z.object({ id: z.number().int().positive(), login: z.string().min(1).max(128) }).passthrough(), repository: z.object({ id: z.number().int().positive(), full_name: z.string().min(1) }).passthrough().optional(), pull_request: z.unknown().optional() }).passthrough();
const commentSchema = z.object({ id: z.number().int().positive(), body: z.string().max(6000), user: z.object({ id: z.number().int().positive() }).passthrough() }).passthrough();

export interface GitHubAppConfig { appId: number; installationId: number; repositoryId: number; repositoryFullName: string; privateKeyPem: string; }
export type GitHubReadTokenPermissions = { issues: 'read'; metadata: 'read' };
const readTokenPermissions: GitHubReadTokenPermissions = { issues: 'read', metadata: 'read' };
export interface GitHubCommentReceiptStore { has(key: string): Promise<boolean>; record(key: string): Promise<void>; }

type JsonRecord = Record<string, unknown>;
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function tokenDiagnostic(code: string, detail?: string): Error { return new Error(detail ? `${code}:${detail}` : code); }
function fieldType(value: unknown): string { return value === undefined ? 'missing' : Array.isArray(value) ? 'array' : typeof value; }
function permissionSummary(value: unknown): string { return isRecord(value) ? Object.entries(value).map(([name, level]) => `${name}=${typeof level === 'string' ? level : typeof level}`).sort().join(',') || 'empty' : fieldType(value); }
function schemaFailure(prefix: string, issues: readonly { path: PropertyKey[]; code: string }[]): Error {
  const paths = issues.slice(0, 8).map((issue) => `${issue.path.map(String).join('.') || '<root>'}=${issue.code}`).join(',');
  return new Error(`${prefix}:${paths || 'schema'}`);
}

/** Parse the bounded, opaque token response without assuming a legacy token shape. */
export function parseInstallationTokenResponse(body: string, requested?: GitHubReadTokenPermissions, now = Date.now()): { token: string; expiresAt: number } {
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { throw tokenDiagnostic('TOKEN_RESPONSE_SCHEMA_INVALID', 'json=invalid'); }
  if (!isRecord(value)) throw tokenDiagnostic('TOKEN_RESPONSE_SCHEMA_INVALID', 'root=nonobject');
  const token = value.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096 || /[\u0000-\u0020\u007f]/u.test(token)) throw tokenDiagnostic('TOKEN_MISSING_OR_INVALID_TYPE', `token=${fieldType(token)},expires_at=${fieldType(value.expires_at)}`);
  const expiresAtValue = value.expires_at;
  if (typeof expiresAtValue !== 'string') throw tokenDiagnostic('TOKEN_MISSING_OR_INVALID_TYPE', `token=string,expires_at=${fieldType(expiresAtValue)}`);
  const expiresAt = Date.parse(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw tokenDiagnostic('TOKEN_EXPIRATION_INVALID', `expires_at=${Number.isFinite(expiresAt) ? 'expired' : 'invalid'}`);
  if (value.permissions !== undefined && !isRecord(value.permissions)) throw tokenDiagnostic('TOKEN_RESPONSE_SCHEMA_INVALID', `permissions=${fieldType(value.permissions)}`);
  if (requested) {
    if (!isRecord(value.permissions) || value.permissions.issues !== 'read' || value.permissions.metadata !== 'read') throw tokenDiagnostic('TOKEN_PERMISSIONS_MISMATCH', `permissions=${permissionSummary(value.permissions)}`);
    for (const [name, level] of Object.entries(value.permissions)) {
      if ((name !== 'issues' && name !== 'metadata') || level !== 'read') throw tokenDiagnostic('TOKEN_PERMISSIONS_MISMATCH', `permissions=${permissionSummary(value.permissions)}`);
    }
  }
  return { token, expiresAt };
}

export interface InstallationRepositoryDiagnostics {
  INSTALLATION_REPOSITORY_COUNT: number | 'invalid';
  CONFIGURED_REPOSITORY_ID_MATCH: boolean;
  CONFIGURED_REPOSITORY_NAME_MATCH: boolean;
  REPOSITORY_IDENTITY_CONSISTENCY: boolean;
  ENUMERATION_COMPLETE: boolean;
}

export function parseInstallationRepositoryPage(body: string, config: Pick<GitHubAppConfig, 'repositoryId' | 'repositoryFullName'>, pageSize = 100): { repositories: readonly { id: number; full_name: string }[]; diagnostics: InstallationRepositoryDiagnostics } {
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { throw new Error('INSTALLATION_REPOSITORY_RESPONSE_SCHEMA_INVALID'); }
  const parsed = z.object({ repositories: z.array(repoSchema).max(pageSize) }).passthrough().safeParse(value);
  if (!parsed.success) throw new Error('INSTALLATION_REPOSITORY_RESPONSE_SCHEMA_INVALID');
  const repositories = parsed.data.repositories;
  const idMatch = repositories.some((repo) => repo.id === config.repositoryId);
  const nameMatch = repositories.some((repo) => repo.full_name === config.repositoryFullName);
  const identityMatch = repositories.some((repo) => repo.id === config.repositoryId && repo.full_name === config.repositoryFullName);
  return { repositories, diagnostics: { INSTALLATION_REPOSITORY_COUNT: repositories.length, CONFIGURED_REPOSITORY_ID_MATCH: idMatch, CONFIGURED_REPOSITORY_NAME_MATCH: nameMatch, REPOSITORY_IDENTITY_CONSISTENCY: identityMatch, ENUMERATION_COMPLETE: repositories.length < pageSize } };
}

export function parseIssueListResponse(body: string): readonly z.infer<typeof issueSchema>[] {
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { throw new Error('GITHUB_ISSUE_RESPONSE_SCHEMA_INVALID:json=invalid'); }
  const parsed = z.array(issueSchema).max(50).safeParse(value);
  if (!parsed.success) throw schemaFailure('GITHUB_ISSUE_RESPONSE_SCHEMA_INVALID', parsed.error.issues);
  return parsed.data;
}

function base64url(value: string | Buffer): string { return Buffer.from(value).toString('base64url'); }
function appJwt(config: GitHubAppConfig, now = Date.now()): string {
  if (!Number.isSafeInteger(config.appId) || config.appId <= 0 || !Number.isSafeInteger(config.installationId) || config.installationId <= 0) throw new Error('GitHub App identity is invalid.');
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: Math.floor(now / 1000) - 30, exp: Math.floor(now / 1000) + 480, iss: config.appId }));
  const key = createPrivateKey(config.privateKeyPem);
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url')}`;
}

export class GitHubAppInstallation {
  private readonly tokens = new Map<string, { value: string; expiresAt: number }>();
  private verified = false;
  constructor(private readonly config: GitHubAppConfig, private readonly http: GitHubHttpTransport) {}
  private async call(method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: string, signal?: AbortSignal, retry = true): Promise<z.infer<typeof responseSchema>> {
    for (let attempt = 1; ; attempt++) {
      const response = await this.http.request(method, path, headers, body, signal);
      if ((response.status === 429 || response.status >= 500) && retry && attempt < maxAttempts) {
        const retryAfter = Math.min(Number.parseInt(response.headers['retry-after'] ?? '1', 10) || 1, 10);
        await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, retryAfter * 1000); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`GitHub API request failed with status ${response.status}.`);
      return response;
    }
  }
  async accessToken(signal?: AbortSignal, permissions?: GitHubReadTokenPermissions): Promise<string> {
    const cacheKey = permissions ? 'read' : 'full';
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    const body = permissions ? JSON.stringify({ permissions }) : '{}';
    const response = await this.call('POST', `/app/installations/${this.config.installationId}/access_tokens`, { authorization: `Bearer ${appJwt(this.config)}` }, body, signal);
    if (response.status !== 201) throw tokenDiagnostic(`HTTP_NON_201:${response.status}`);
    const parsed = parseInstallationTokenResponse(response.body, permissions);
    this.tokens.set(cacheKey, { value: parsed.token, expiresAt: parsed.expiresAt }); return parsed.token;
  }
  async verifyRepository(signal?: AbortSignal): Promise<void> {
    const token = await this.accessToken(signal, readTokenPermissions);
    const repositories: { id: number; full_name: string }[] = [];
    let enumerationComplete = false;
    for (let page = 1; page <= 10; page++) {
      const response = await this.call('GET', `/installation/repositories?per_page=100&page=${page}`, { authorization: `Bearer ${token}` }, undefined, signal);
      let parsed: ReturnType<typeof parseInstallationRepositoryPage>;
      try { parsed = parseInstallationRepositoryPage(response.body, this.config); } catch { throw new Error('INSTALLATION_REPOSITORY_RESPONSE_SCHEMA_INVALID'); }
      repositories.push(...parsed.repositories);
      if (parsed.diagnostics.ENUMERATION_COMPLETE) { enumerationComplete = true; break; }
      if (page === 10) throw new Error(`INSTALLATION_REPOSITORY_COUNT=${repositories.length};CONFIGURED_REPOSITORY_ID_MATCH=${repositories.some((repo) => repo.id === this.config.repositoryId)};CONFIGURED_REPOSITORY_NAME_MATCH=${repositories.some((repo) => repo.full_name === this.config.repositoryFullName)};REPOSITORY_IDENTITY_CONSISTENCY=${repositories.some((repo) => repo.id === this.config.repositoryId && repo.full_name === this.config.repositoryFullName)};ENUMERATION_COMPLETE=false`);
    }
    const idMatch = repositories.some((repo) => repo.id === this.config.repositoryId);
    const nameMatch = repositories.some((repo) => repo.full_name === this.config.repositoryFullName);
    const identityMatch = repositories.some((repo) => repo.id === this.config.repositoryId && repo.full_name === this.config.repositoryFullName);
    if (!identityMatch || !enumerationComplete) throw new Error(`INSTALLATION_REPOSITORY_COUNT=${repositories.length};CONFIGURED_REPOSITORY_ID_MATCH=${idMatch};CONFIGURED_REPOSITORY_NAME_MATCH=${nameMatch};REPOSITORY_IDENTITY_CONSISTENCY=${identityMatch};ENUMERATION_COMPLETE=${enumerationComplete}`);
    this.verified = true;
  }
  async request(method: 'GET' | 'POST', path: string, body: unknown | undefined, signal?: AbortSignal, retry = true): Promise<z.infer<typeof responseSchema>> {
    if (!this.verified) await this.verifyRepository(signal);
    const token = await this.accessToken(signal, method === 'GET' ? readTokenPermissions : undefined);
    return this.call(method, path, { authorization: `Bearer ${token}` }, body === undefined ? undefined : JSON.stringify(body), signal, retry);
  }
}

export class GitHubAppIssueReader implements GitHubIssueReader {
  private pendingCursor: string | null = null;
  constructor(private readonly installation: GitHubAppInstallation, private readonly trust: GitHubTrust, private readonly cursor: GitHubCursorStore) {}
  async listIssues(signal: AbortSignal): Promise<readonly GitHubIssueEvent[]> {
    const since = await this.cursor.load(); const events: GitHubIssueEvent[] = []; let newest = since ?? '';
    let complete = false;
    for (let page = 1; page <= 10; page++) {
      const query = since ? `&since=${encodeURIComponent(since)}` : '';
      const response = await this.installation.request('GET', `/repos/${this.trust.repositoryFullName}/issues?state=open&per_page=50&page=${page}${query}`, undefined, signal);
      const parsed = parseIssueListResponse(response.body);
      for (const issue of parsed) {
        if (issue.pull_request !== undefined) continue;
        const expectedRepositoryUrl = `https://api.github.com/repos/${this.trust.repositoryFullName}`;
        if (issue.repository_url !== expectedRepositoryUrl) throw new Error('GitHub issue repository identity mismatch.');
        if (issue.repository && (issue.repository.id !== this.trust.repositoryId || issue.repository.full_name !== this.trust.repositoryFullName)) throw new Error('GitHub issue repository identity mismatch.');
        const action = since ? 'edited' : 'opened';
        events.push({ installationId: this.trust.installationId, repositoryId: this.trust.repositoryId, repositoryFullName: this.trust.repositoryFullName, issueId: issue.id, issueNumber: issue.number, senderId: issue.user.id, senderLogin: issue.user.login, title: issue.title, body: issue.body ?? '', action, updatedAt: issue.updated_at });
        if (issue.updated_at > newest) newest = issue.updated_at;
      }
      if (parsed.length < 50) { complete = true; break; }
    }
    if (!complete) throw new Error('GITHUB_ISSUE_PAGINATION_EXCEEDED');
    this.pendingCursor = newest || since; return events;
  }
  async commitCursor(): Promise<void> { if (this.pendingCursor) await this.cursor.save(this.pendingCursor); this.pendingCursor = null; }
}

export class GitHubAppCommentWriter implements GitHubIssueWriter {
  constructor(private readonly installation: GitHubAppInstallation, private readonly trust: GitHubTrust, private readonly receipts: GitHubCommentReceiptStore) {}
  async createComment(input: { repositoryFullName: string; issueNumber: number; body: string; idempotencyKey: string }, signal: AbortSignal): Promise<void> {
    if (input.repositoryFullName !== this.trust.repositoryFullName || !Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0 || input.body.length === 0 || input.body.length > 6000) throw new Error('GitHub comment target is not authorized.');
    if (await this.receipts.has(input.idempotencyKey)) return;
    // POST is deliberately not retried: an uncertain response must be reconciled by an operator.
    await this.installation.request('POST', `/repos/${this.trust.repositoryFullName}/issues/${input.issueNumber}/comments`, { body: input.body }, signal, false);
    await this.receipts.record(input.idempotencyKey);
  }
}

export class GitHubAppCommentReader {
  constructor(private readonly installation: GitHubAppInstallation, private readonly trust: GitHubTrust) {}
  async listFeedback(issueNumber: number, signal: AbortSignal): Promise<readonly (GitHubOwnerFeedback & { commentId: number })[]> {
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) throw new Error('GitHub issue number is invalid.');
    const response = await this.installation.request('GET', `/repos/${this.trust.repositoryFullName}/issues/${issueNumber}/comments?per_page=50`, undefined, signal);
    const parsed = z.array(commentSchema).max(50).safeParse(JSON.parse(response.body) as unknown); if (!parsed.success) throw new Error('GitHub comment response is invalid.');
    const results: (GitHubOwnerFeedback & { commentId: number })[] = [];
    for (const comment of parsed.data) {
      if (comment.user.id !== this.trust.authorizedSenderId) continue;
      const match = /^\/factory\s+(approve|reject|revise)\s+revision=([A-Za-z0-9._:-]{1,128})\s+policy=([A-Za-z0-9._:-]{1,128})$/.exec(comment.body.trim());
      if (!match) continue;
      results.push({ commentId: comment.id, installationId: this.trust.installationId, repositoryId: this.trust.repositoryId, repositoryFullName: this.trust.repositoryFullName, issueNumber, senderId: comment.user.id, action: match[1] as 'approve' | 'reject' | 'revise', planRevision: match[2]!, policyRevision: match[3]! });
    }
    return results;
  }
}
