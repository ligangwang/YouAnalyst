import { spawnSync } from 'node:child_process';

const [project, region, service] = process.argv.slice(2);
if (!project || !region || !service) throw new Error('Project, region and service are required');
const result = spawnSync(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', [
  'run', 'services', 'describe', service, '--project', project, '--region', region, '--format=json',
], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 8 * 1024 * 1024 });
// Never forward raw service configuration or CLI diagnostics: either may contain secrets.
if (result.status !== 0) throw new Error('Cannot inspect runtime credential configuration');
let config;
try { config = JSON.parse(result.stdout); } catch { throw new Error('Invalid service configuration response'); }
const env = config.spec?.template?.spec?.containers?.[0]?.env ?? [];
const required = ['TWELVE_DATA_API_KEY', 'EODHD_API_TOKEN', 'INTERNAL_API_TOKEN', 'OPENAI_API_KEY'];
const missing = required.filter(name => !env.some(item => item.name === name &&
  (item.value || item.valueFrom?.secretKeyRef)));
if (missing.length) throw new Error(`Provision runtime credentials outside Cloud Build first: ${missing.join(', ')}`);
console.log('Runtime credentials configured; values omitted. Build will preserve them.');
