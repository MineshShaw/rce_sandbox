import Docker from 'dockerode';
import { PassThrough } from 'stream';
import { SupportedLanguage, LanguageRegistry } from '../../../../packages/shared-types/src/languages';

interface SandboxConfig {
  timeoutMs: number;
  memoryLimitBytes: number;
  cpuQuota: number; 
  pidsLimit: number;
}

interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isTimeout: boolean;
  isOOM: boolean;
}

export class DockerSandbox {
  private docker: Docker;
  private config: SandboxConfig;

  constructor(customConfig?: Partial<SandboxConfig>) {
    this.docker = new Docker(); 
    this.config = {
      timeoutMs: 10000,
      memoryLimitBytes: 256 * 1024 * 1024, 
      cpuQuota: 0.5,
      pidsLimit: 64,
      ...customConfig,
    };
  }

  public async execute(language: SupportedLanguage, sourceCode: string, stdin?: string): Promise<SandboxResult> {
    let container: Docker.Container | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let isTimeout = false;
    
    const hasStdin = Boolean(stdin && stdin.length > 0);

    try {
      const strategy = LanguageRegistry[language];
      const tmpfsOptions = language === 'CPP' 
        ? 'rw,nosuid,size=64m,mode=777' 
        : 'rw,noexec,nosuid,size=64m,mode=777';
      
      // 1. Safely encode the payload to bypass string escaping issues
      const base64Code = Buffer.from(sourceCode).toString('base64');

      container = await this.docker.createContainer({
        Image: strategy.image,
        Cmd: strategy.cmd, 
        Env: [`CODE_PAYLOAD=${base64Code}`], // 2. Inject via environment variable
        AttachStdout: true,                  // 3. No Stdin required!
        AttachStderr: true,
        AttachStdin: hasStdin,   
        OpenStdin: hasStdin,     
        StdinOnce: hasStdin,     
        Tty: false,
        User: 'sandboxuser',
        NetworkDisabled: true,
        HostConfig: {
          CapDrop: ['ALL'],
          ReadonlyRootfs: true,
          Tmpfs: { '/workspace': tmpfsOptions },
          Memory: this.config.memoryLimitBytes,
          MemorySwap: this.config.memoryLimitBytes, 
          NanoCpus: this.config.cpuQuota * 1_000_000_000, 
          PidsLimit: this.config.pidsLimit,
        },
      });

      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
        stdin: hasStdin,
      });

      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      
      let stdoutData = '';
      let stderrData = '';

      stdoutStream.on('data', (chunk) => (stdoutData += chunk.toString('utf8')));
      stderrStream.on('data', (chunk) => (stderrData += chunk.toString('utf8')));

      container.modem.demuxStream(stream, stdoutStream, stderrStream);

      await container.start();

      if (hasStdin && stdin) {
        stream.write(stdin);
        stream.end();
      }

      const streamClosedPromise = new Promise<void>((resolve) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
        stream.on('error', resolve);
      });

      const executionPromise = container.wait().then(async (result) => {
        await streamClosedPromise;
        return result;
      });
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(async () => {
          isTimeout = true;
          try {
            if (container) await container.kill();
          } catch (err) {}
          reject(new Error('SIGKILL'));
        }, this.config.timeoutMs);
      });

      const waitResult = await Promise.race([executionPromise, timeoutPromise]);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      const inspectData = await container.inspect();
      const isOOM = inspectData.State.OOMKilled || false;

      return {
        stdout: stdoutData.trim(),
        stderr: stderrData.trim(),
        exitCode: waitResult.StatusCode,
        isTimeout: false,
        isOOM,
      };

    } catch (error: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);

      const isSigKill = error.message === 'SIGKILL';

      return {
        stdout: '',
        stderr: isSigKill ? 'Time Limit Exceeded (TLE)' : `System Error: ${error.message}`,
        exitCode: isSigKill ? 137 : 500, 
        isTimeout,
        isOOM: false,
      };
    } finally {
      if (container) {
        try {
          await container.remove({ force: true });
        } catch (cleanupError) {}
      }
    }
  }
}