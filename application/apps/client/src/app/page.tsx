'use client';

import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';

const DEFAULT_CODE = {
  PYTHON: 'print("Hello from the Cloud Sandbox!")',
  JAVASCRIPT: 'console.log("Hello from the Cloud Sandbox!");',
  CPP: '#include <iostream>\n\nint main() {\n    std::cout << "Hello from the Cloud Sandbox!" << std::endl;\n    return 0;\n}'
};

let socket: Socket;

export default function Sandbox() {
  const [language, setLanguage] = useState<'PYTHON' | 'JAVASCRIPT' | 'CPP'>('PYTHON');
  const [code, setCode] = useState(DEFAULT_CODE.PYTHON);
  const [output, setOutput] = useState('// Your output will appear here...');
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    socket = io('http://localhost:8000');

    socket.on('jobComplete', (data) => {
      setIsRunning(false);
      
      const finalOutput = data.errorMessage 
        ? `❌ ERROR:\n${data.errorMessage}`
        : `✅ SUCCESS (Time: ${data.executionTimeMs}ms):\n\n${data.stdout || "No output returned."}`;
        
      setOutput(finalOutput);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value as 'PYTHON' | 'JAVASCRIPT' | 'CPP';
    setLanguage(newLang);
    setCode(DEFAULT_CODE[newLang]);
  };

  const runCode = async () => {
    if (!code) return;
    setIsRunning(true);
    setOutput('🚀 Submitting code to cloud...');

    try {
      const { data } = await axios.post('http://localhost:8000/api/submissions', {
        language,
        code,
      });

      const submissionId = data.submissionId;
      setOutput(`⏳ Job ${submissionId} queued.\nWaiting for real-time stream...`);

      socket.emit('subscribeToJob', submissionId);

    } catch (error) {
      setIsRunning(false);

      if (axios.isAxiosError(error)) {
        // TypeScript now safely knows 'error' is an AxiosError
        const apiError = error.response?.data?.error || error.message;
        setOutput(`❌ API Error: ${apiError}`);
      } else if (error instanceof Error) {
        // Handles standard non-network JavaScript errors
        setOutput(`❌ Error: ${error.message}`);
      } else {
        // Handles edge cases where something weird was thrown
        setOutput(`❌ An unexpected error occurred`);
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white font-sans">
      <header className="flex items-center justify-between p-4 bg-gray-950 border-b border-gray-800">
        <h1 className="text-xl font-bold text-blue-400">Real-Time RCE Sandbox</h1>
        
        <div className="flex items-center space-x-4">
          <select 
            value={language} 
            onChange={handleLanguageChange}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg block p-2"
          >
            <option value="PYTHON">Python</option>
            <option value="JAVASCRIPT">JavaScript</option>
            <option value="CPP">C++</option>
          </select>

          <button 
            onClick={runCode}
            disabled={isRunning}
            className={`px-4 py-2 font-semibold rounded-lg shadow-md transition-colors ${
              isRunning 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-green-600 hover:bg-green-500 text-white'
            }`}
          >
            {isRunning ? 'Running...' : '▶ Run Code'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r border-gray-800">
          <Editor
            height="100%"
            language={language.toLowerCase()}
            theme="vs-dark"
            value={code}
            onChange={(val) => setCode(val || '')}
            options={{ minimap: { enabled: false }, fontSize: 16, padding: { top: 16 } }}
          />
        </div>

        <div className="w-1/2 p-4 bg-black font-mono text-sm overflow-y-auto whitespace-pre-wrap">
          <div className="text-gray-400 mb-2">Terminal Output (WebSockets Active 🟢)</div>
          <div className={`${output.includes('❌') ? 'text-red-400' : 'text-green-400'}`}>
            {output}
          </div>
        </div>
      </div>
    </div>
  );
}