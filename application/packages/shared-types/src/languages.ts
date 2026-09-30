export type SupportedLanguage = 'PYTHON' | 'JAVASCRIPT' | 'CPP';

export interface LanguageStrategy {
  image: string;
  cmd: string[];
  sourceFileName: string;
}

export const LanguageRegistry: Record<SupportedLanguage, LanguageStrategy> = {
  PYTHON: {
    image: 'rce-python-runner',
    cmd: ['sh', '-c', 'echo "$CODE_PAYLOAD" | base64 -d > /workspace/solution.py && python3 /workspace/solution.py'],
    sourceFileName: 'solution.py'
  },
  JAVASCRIPT: {
    image: 'rce-js-runner',
    cmd: ['sh', '-c', 'echo "$CODE_PAYLOAD" | base64 -d > /workspace/solution.js && node /workspace/solution.js'],
    sourceFileName: 'solution.js'
  },
  CPP: {
    image: 'rce-cpp-runner',
    cmd: [
      'sh', '-c', 
      'echo "$CODE_PAYLOAD" | base64 -d > /workspace/solution.cpp && g++ -O3 /workspace/solution.cpp -o /workspace/out && chmod +x /workspace/out && /workspace/out'
    ],
    sourceFileName: 'solution.cpp'
  }
};