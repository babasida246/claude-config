#!/usr/bin/env node
/**
 * GitNexus Claude Code Hook
 *
 * PreToolUse handler — intercepts Grep/Glob/Bash searches
 * and augments with graph context from the GitNexus index.
 *
 * Session-scoped cache: the same pattern is only re-augmented once per
 * CACHE_TTL_MS within the same session — repeated Grep/Glob calls for a
 * pattern already surfaced earlier in the conversation are skipped, since
 * the context is already in the model's context window.
 *
 * NOTE: SessionStart hooks are broken on Windows (Claude Code bug).
 * Session context is injected via CLAUDE.md / skills instead.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const CACHE_MAX_ENTRIES = 500;

function cacheFilePath(sessionKey) {
  const hash = crypto.createHash('md5').update(String(sessionKey)).digest('hex');
  return path.join(os.tmpdir(), 'gitnexus-hook-cache', `${hash}.json`);
}

function readCache(sessionKey) {
  try {
    return JSON.parse(fs.readFileSync(cacheFilePath(sessionKey), 'utf-8'));
  } catch {
    return {};
  }
}

function isCached(sessionKey, pattern) {
  const seenAt = readCache(sessionKey)[pattern];
  return typeof seenAt === 'number' && (Date.now() - seenAt) < CACHE_TTL_MS;
}

function recordCache(sessionKey, pattern) {
  try {
    const file = cacheFilePath(sessionKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const cache = readCache(sessionKey);
    cache[pattern] = Date.now();

    let entries = Object.entries(cache);
    if (entries.length > CACHE_MAX_ENTRIES) {
      entries.sort((a, b) => a[1] - b[1]);
      entries = entries.slice(entries.length - CACHE_MAX_ENTRIES);
    }
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* caching is best-effort */ }
}

/**
 * Read JSON input from stdin synchronously.
 */
function readInput() {
  try {
    const data = fs.readFileSync(0, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Check if a directory (or ancestor) has a .gitnexus index.
 */
function findGitNexusIndex(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.gitnexus'))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Extract search pattern from tool input.
 */
function extractPattern(toolName, toolInput) {
  if (toolName === 'Grep') {
    return toolInput.pattern || null;
  }

  if (toolName === 'Glob') {
    const raw = toolInput.pattern || '';
    const match = raw.match(/[*\/]([a-zA-Z][a-zA-Z0-9_-]{2,})/);
    return match ? match[1] : null;
  }

  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    if (!/\brg\b|\bgrep\b/.test(cmd)) return null;

    const tokens = cmd.split(/\s+/);
    let foundCmd = false;
    let skipNext = false;
    const flagsWithValues = new Set(['-e', '-f', '-m', '-A', '-B', '-C', '-g', '--glob', '-t', '--type', '--include', '--exclude']);

    for (const token of tokens) {
      if (skipNext) { skipNext = false; continue; }
      if (!foundCmd) {
        if (/\brg$|\bgrep$/.test(token)) foundCmd = true;
        continue;
      }
      if (token.startsWith('-')) {
        if (flagsWithValues.has(token)) skipNext = true;
        continue;
      }
      const cleaned = token.replace(/['"]/g, '');
      return cleaned.length >= 3 ? cleaned : null;
    }
    return null;
  }

  return null;
}

function main() {
  try {
    const input = readInput();
    const hookEvent = input.hook_event_name || '';

    if (hookEvent !== 'PreToolUse') return;

    const cwd = input.cwd || process.cwd();
    if (!findGitNexusIndex(cwd)) return;

    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};

    if (toolName !== 'Grep' && toolName !== 'Glob' && toolName !== 'Bash') return;

    const pattern = extractPattern(toolName, toolInput);
    if (!pattern || pattern.length < 3) return;

    const sessionKey = input.session_id || input.transcript_path || cwd;
    if (isCached(sessionKey, pattern)) return;

    // Resolve CLI path — try multiple strategies:
    // 1. Relative path (works when script is inside npm package)
    // 2. require.resolve (works when gitnexus is globally installed)
    // 3. Fall back to npx (works when neither is available)
    let cliPath = 'C:/Users/huyit/AppData/Roaming/npm/node_modules/gitnexus/dist/cli/index.js';
    if (!fs.existsSync(cliPath)) {
      try {
        cliPath = require.resolve('gitnexus/dist/cli/index.js');
      } catch {
        cliPath = ''; // will use npx fallback
      }
    }

    // augment CLI writes result to stderr (KuzuDB's native module captures
    // stdout fd at OS level, making it unusable in subprocess contexts).
    const { spawnSync } = require('child_process');
    let result = '';
    try {
      let child;
      if (cliPath) {
        child = spawnSync(
          process.execPath,
          [cliPath, 'augment', pattern],
          { encoding: 'utf-8', timeout: 8000, cwd, stdio: ['pipe', 'pipe', 'pipe'] }
        );
      } else {
        // npx fallback
        const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        child = spawnSync(
          cmd,
          ['-y', 'gitnexus', 'augment', pattern],
          { encoding: 'utf-8', timeout: 15000, cwd, stdio: ['pipe', 'pipe', 'pipe'] }
        );
      }
      result = child.stderr || '';
    } catch { /* graceful failure */ }

    recordCache(sessionKey, pattern);

    if (result && result.trim()) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: result.trim()
        }
      }));
    }
  } catch (err) {
    // Graceful failure — log to stderr for debugging
    console.error('GitNexus hook error:', err.message);
  }
}

main();
