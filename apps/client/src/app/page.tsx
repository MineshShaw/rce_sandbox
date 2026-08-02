'use client';

import { useState } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';

const DEFAULT_CODE = {
  PYTHON: 'print("Hello from the Cloud Sandbox!")',
  JAVASCRIPT: 'console.log("Hello from the Cloud Sandbox!");',
  CPP: '#include <iostream>\n\nint main() {\n    std::cout << "Hello from the Cloud Sandbox!" << std::endl;\n    return 0;\n}'
};

export default function Sandbox() {
  const [language, setLanguage] = useState<'PYTHON' | 'JAVASCRIPT' | 'CPP'>('PYTHON');
  const [code, setCode] = useState(DEFAULT_CODE.PYTHON);
  const [output, setOutput] = useState('// Your output will appear here...');
  const [isRunning, setIsRunning] = useState(false);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value as 'PYTHON' | 'JAVASCRIPT' | 'CPP';
    setLanguage(newLang);
    setCode(DEFAULT_CODE[newLang]);
  };

  const runCode = async () => {
    if (!code) return;
    setIsRunning(true);
    setOutput('🚀 Submitting code...');

    try {
      // 1. Submit the code to your API Node
      const { data } = await axios.post('http://localhost:8000/api/submissions', {
        language,
        code,
      });

      const submissionId = data.submissionId;
      setOutput(`⏳ Job ${submissionId} queued.\nWaiting for execution...`);

      // 2. Poll the API until the job is complete (We will replace this with WebSockets in Phase 7!)
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`http://localhost:8000/api/submissions/${submissionId}`);
          
          if (statusRes.data.status === 'COMPLETED' || statusRes.data.status.includes('ERROR')) {
            clearInterval(pollInterval);
            setIsRunning(false);
            
            // Format the output
            const finalOutput = statusRes.data.errorMessage 
              ? `❌ ERROR:\n${statusRes.data.errorMessage}`
              : `✅ SUCCESS (Time: ${statusRes.data.executionTimeMs}ms):\n\n${statusRes.data.output || "No output returned."}`;
              
            setOutput(finalOutput);
          }
        } catch (pollErr) {
          clearInterval(pollInterval);
          setIsRunning(false);
          setOutput('❌ Error fetching submission status.');
        }
      }, 1000); // Check every 1 second

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setIsRunning(false);
      setOutput(`❌ API Error: ${err.response?.data?.error || err.message}`);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white font-sans">
      
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-gray-950 border-b border-gray-800">
        <h1 className="text-xl font-bold text-blue-400">RCE Sandbox</h1>
        
        <div className="flex items-center space-x-4">
          <select 
            value={language} 
            onChange={handleLanguageChange}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
          >
            <option value="PYTHON">Python</option>
            <option value="JAVASCRIPT">JavaScript</option>
            <option value="CPP">C++</option>
          </select>

          <button 
            onClick={runCode}
            disabled={isRunning}
            className={`px-4 py-2 font-semibold rounded-lg shadow-md focus:outline-none transition-colors ${
              isRunning 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-green-600 hover:bg-green-500 text-white'
            }`}
          >
            {isRunning ? 'Running...' : '▶ Run Code'}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Monaco Editor (Left) */}
        <div className="w-1/2 border-r border-gray-800">
          <Editor
            height="100%"
            language={language.toLowerCase()}
            theme="vs-dark"
            value={code}
            onChange={(val) => setCode(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 16,
              padding: { top: 16 },
            }}
          />
        </div>

        {/* Terminal Output (Right) */}
        <div className="w-1/2 p-4 bg-black font-mono text-sm overflow-y-auto whitespace-pre-wrap">
          <div className="text-gray-400 mb-2">Terminal Output</div>
          <div className={`${output.includes('❌') ? 'text-red-400' : 'text-green-400'}`}>
            {output}
          </div>
        </div>
        
      </div>
    </div>
  );
}