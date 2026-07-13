import { spawn } from 'node:child_process';

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  isOOM: boolean;
}

export class SandboxRunner {
  private readonly image: string;
  private readonly timeoutMs: number;

  constructor(image: string = 'rce-python-runner', timeoutMs: number = 3000) {
    this.image = image;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Executes the provided source code inside the isolated Docker container.
   */
  public async execute(sourceCode: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let isOOM = false;

      // Phase 1 Security Flags: The Core of the Sandbox
      const dockerArgs = [
        'run',
        '--rm',                     // Remove container automatically after exit
        '-i',                       // Keep STDIN open even if not attached
        '--network', 'none',        // Disable all networking
        '--cap-drop', 'ALL',        // Drop all Linux capabilities (prevents privilege escalation)
        '--user', 'sandboxuser',    // Run as non-root
        '--read-only',              // Make the root filesystem read-only
        '--tmpfs', '/workspace:rw,noexec,nosuid,size=64m', // Small RAM-disk for temporary files
        '--memory', '256m',         // Strict memory limit
        '--memory-swap', '256m',    // Disable swap by setting it equal to memory limit
        '--cpus', '0.5',            // Restrict to half a CPU core
        '--pids-limit', '64',       // Crucial: Mitigates fork bombs by limiting process count
        this.image
      ];

      const child = spawn('docker', dockerArgs);

      // Timeout handler to kill infinite loops
      const timeoutTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, this.timeoutMs);

      // Capture Standard Output
      child.stdout.on('data', (data: { toString: () => string; }) => {
        stdout += data.toString();
      });

      // Capture Standard Error
      child.stderr.on('data', (data: { toString: () => string; }) => {
        const output = data.toString();
        stderr += output;
        
        // Detect Docker Out-Of-Memory kills
        if (output.includes('Killed') || output.includes('OOM')) {
          isOOM = true;
        }
      });

      // Handle Container Exit
      child.on('close', (code: number) => {
        clearTimeout(timeoutTimer);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
          isOOM
        });
      });

      // Pipe the user's source code directly into the container's Python interpreter
      child.stdin.write(sourceCode);
      child.stdin.end();
    });
  }
}