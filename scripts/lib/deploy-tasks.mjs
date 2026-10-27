import { spawn } from 'node:child_process';

// Drain active operations after a failure; never start dependent deployments.
export async function runTasks(tasks, concurrency = 3, execute = runCommand) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Deployment concurrency must be 1 through 8');
  const ids = new Set(tasks.map(task => task.id));
  if (ids.size !== tasks.length) throw new Error('Duplicate deployment task');
  for (const task of tasks) for (const dep of task.needs ?? []) {
    if (!ids.has(dep)) throw new Error(`Unknown dependency: ${dep}`);
  }
  const pending = [...tasks], done = new Set(), active = new Map();
  let failure;
  while (pending.length || active.size) {
    for (let i = 0; !failure && i < pending.length && active.size < concurrency;) {
      const task = pending[i];
      if (!(task.needs ?? []).every(dep => done.has(dep))) { i++; continue; }
      pending.splice(i, 1);
      const started = Date.now();
      console.log(`[deploy] Starting ${task.id}`);
      active.set(task.id, Promise.resolve().then(() => execute(task)).then(
        () => ({ id: task.id, started }),
        error => ({ id: task.id, started, error }),
      ));
    }
    if (!active.size) {
      if (failure) throw failure;
      throw new Error('Cyclic deployment dependencies');
    }
    const result = await Promise.race(active.values());
    active.delete(result.id);
    console.log(`[deploy] ${result.id}: ${result.error ? 'FAILED' : 'OK'} (${Math.round((Date.now() - result.started) / 1000)}s)`);
    if (result.error) failure ??= result.error;
    else done.add(result.id);
    if (failure && !active.size) throw failure;
  }
}

export function runCommand(task) {
  return new Promise((resolve, reject) => {
    const child = spawn(task.command, task.args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${task.id} failed (${signal ?? code})`)));
  });
}
