// Правила задач про Docker ({docker: …}) — по итоговому состоянию учебного Docker.
//   {docker: container, name: web | image: nginx:1.27, status: running|exited|created|exists|absent}
//   {docker: port, container: web, host: 8080, port: 80}
//   {docker: volume, name: pgdata, exists: true, mounted_in: db}
//   {docker: image, ref: shop:1.0, exists: true, max_size_mb: 200, user_not_root: true}
//   {docker: network, name: shop, containers: [web, db]}
//   {docker: compose, service: web, project: shop, status: running}  (project — по умолчанию любой)

import { normalizeRef } from './catalog.js';
import { dockerState, findContainer, findImage } from './state.js';

function container(state, rule) {
  if (rule.name) return findContainer(state, rule.name);
  if (rule.image) {
    const matching = state.containers.filter((c) => normalizeRef(c.image) === normalizeRef(rule.image));
    return matching.find((c) => c.status === 'running') ?? matching[0] ?? null;
  }
  return null;
}

/** true — правило не пройдено; null — правило не про Docker. */
export function failedDockerRule(rule, shell) {
  if (!('docker' in rule)) return null;
  const state = dockerState(shell.fs);
  switch (rule.docker) {
    case 'container': {
      const found = container(state, rule);
      const status = rule.status ?? 'running';
      if (status === 'absent') return Boolean(found);
      if (status === 'exists') return !found;
      return found?.status !== status;
    }
    case 'port': {
      const found = findContainer(state, String(rule.container));
      return !found || found.status !== 'running' || !found.ports.some((port) => String(port.hostPort) === String(rule.host)
        && (rule.port === undefined || String(port.port) === String(rule.port)));
    }
    case 'volume': {
      const exists = Boolean(state.volumes[rule.name]);
      if ('exists' in rule && !rule.exists) return exists;
      if (!exists) return true;
      if (rule.mounted_in) {
        const found = findContainer(state, String(rule.mounted_in));
        return !found?.mounts.some((mount) => mount.name === rule.name && (!rule.path || mount.destination === rule.path));
      }
      return false;
    }
    case 'image': {
      const image = findImage(state, rule.ref);
      if ('exists' in rule && !rule.exists) return Boolean(image);
      if (!image) return true;
      if (rule.max_size_mb !== undefined && image.disk > rule.max_size_mb * 1000 * 1000) return true;
      if (rule.user_not_root && ['', 'root', '0'].includes(image.config.User ?? '')) return true;
      return false;
    }
    case 'compose': {
      const found = state.containers.find((c) => c.labels?.['com.docker.compose.service'] === rule.service
        && !c.labels['com.docker.compose.oneoff'] && (!rule.project || c.labels['com.docker.compose.project'] === rule.project));
      const status = rule.status ?? 'running';
      if (status === 'absent') return Boolean(found);
      if (status === 'exists') return !found;
      return found?.status !== status;
    }
    case 'network': {
      const network = state.networks[rule.name];
      if ('exists' in rule && !rule.exists) return Boolean(network);
      if (!network) return true;
      return (rule.containers ?? []).some((name) => {
        const found = findContainer(state, String(name));
        return !found || !(rule.name in found.networks);
      });
    }
    default:
      return true;
  }
}
