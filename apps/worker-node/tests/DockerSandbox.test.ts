import { describe, it, expect } from 'vitest';
import { DockerSandbox } from '../src/sandbox/DockerSandbox';

describe('Phase 1: DockerSandbox Execution Engine', () => {
  const sandbox = new DockerSandbox();

  it('should successfully execute safe python code', async () => {
    const code = `print("Hello from the isolated sandbox!")`;
    const result = await sandbox.execute('python', code);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Hello from the isolated sandbox!');
    expect(result.stderr).toBe('');
    expect(result.isOOM).toBe(false);
  });

  it('should neutralize a fork bomb without crashing the host', async () => {
    const forkBombCode = `
import os
import sys
while True:
    try:
        os.fork()
    except BlockingIOError:
        print("Fork bomb neutralized", flush=True)
        os._exit(0) # Force immediate exit of this specific process
    `;
    const result = await sandbox.execute('python', forkBombCode);
    
    // The sandbox should either catch it instantly, or our Watchdog will TLE it. Both are safe!
    expect(result.stdout).toContain('Fork bomb neutralized');
  });

  it('should enforce strict file system and non-root privileges', async () => {
    const hackCode = `
try:
    with open('/etc/passwd', 'a') as f:
        f.write('hacked::0:0::/root:/bin/bash')
except OSError as e:
    print(f"Blocked: {e}", flush=True)
    `;
    const result = await sandbox.execute('python', hackCode);
    
    expect(result.exitCode).toBe(0);
    // Linux throws 'Permission denied' because sandboxuser is strictly non-root!
    expect(result.stdout).toContain('Permission denied'); 
  });
  
  it('should enforce strict execution timeouts (TLE)', async () => {
    const infiniteLoop = `while True: pass`;
    const result = await sandbox.execute('python', infiniteLoop);
    
    expect(result.exitCode).toBe(137); // SIGKILL
    expect(result.isTimeout).toBe(true);
    expect(result.stderr).toBe('Time Limit Exceeded (TLE)');
  }, 5000); 
});