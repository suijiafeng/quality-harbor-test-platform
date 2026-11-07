import { readFile } from 'node:fs/promises';
import { validateBaseURL } from './target.mjs';

const profiles = ['auto', 'hireflow', 'generic'];
const suites = ['all', 'smoke'];
const projectIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}
function keys(value, allowed, label) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label} contains unsupported fields. Store credentials only in environment variables; writes cannot be enabled in project configuration.`);
}

export function validateProfile(value) {
  if (!profiles.includes(value)) throw new Error('Unknown profile; choose auto, hireflow or generic.');
  return value;
}

export function validateProjectConfig(value) {
  object(value, 'Project configuration');
  keys(value, ['version', 'defaultProject', 'projects'], 'Project configuration');
  if (value.version !== 1) throw new Error('Project configuration version must be 1.');
  object(value.projects, 'projects');
  const entries = Object.entries(value.projects);
  if (!entries.length) throw new Error('Configure at least one project.');
  const projects = Object.create(null);
  for (const [id, entry] of entries) {
    if (!projectIdPattern.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Project IDs must use 1–64 lowercase letters, digits, hyphens or underscores, starting with a letter or digit.');
    object(entry, `Project ${id}`);
    keys(entry, ['name', 'url', 'profile', 'suite'], `Project ${id}`);
    if (entry.name !== undefined && (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 100 || /[\x00-\x1f\x7f]/.test(entry.name))) throw new Error(`Project ${id} needs a readable name of at most 100 characters.`);
    if (typeof entry.url !== 'string') throw new Error(`Project ${id} needs a URL.`);
    const url = validateBaseURL(entry.url);
    const profile = validateProfile(entry.profile ?? 'auto');
    const suite = entry.suite ?? 'all';
    if (!suites.includes(suite)) throw new Error(`Project ${id} suite must be all or smoke.`);
    projects[id] = { id, name: entry.name?.trim() ?? id, url, profile, suite };
  }
  if (value.defaultProject !== undefined && (typeof value.defaultProject !== 'string' || !Object.hasOwn(projects, value.defaultProject))) throw new Error('defaultProject must name a configured project.');
  return { version: 1, defaultProject: value.defaultProject, projects };
}

export async function loadProjectConfig(path) {
  let content;
  try { content = await readFile(path, 'utf8'); }
  catch { throw new Error('Cannot read project configuration. Copy qualityharbor.example.json to qualityharbor.config.json or pass --config=<file>.'); }
  let value;
  // Do not echo parser snippets: a mistakenly included password must not enter logs.
  try { value = JSON.parse(content); }
  catch { throw new Error('Project configuration must be valid JSON.'); }
  return validateProjectConfig(value);
}

export function selectProject(config, requestedId) {
  const id = requestedId ?? config.defaultProject;
  if (!id) throw new Error('Select a configured project with --target=<id> or set defaultProject.');
  if (!Object.hasOwn(config.projects, id)) throw new Error('Unknown target. Use --list-targets to see configured projects.');
  return config.projects[id];
}
