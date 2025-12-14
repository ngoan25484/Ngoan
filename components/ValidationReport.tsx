import React from 'react';
import { ValidationIssue } from '../types';

interface ValidationReportProps {
  issues: ValidationIssue[];
  aiAnalysis: string | null;
  onRetry: () => void;
}

export const ValidationReport: React.FC<ValidationReportProps> = ({ issues, aiAnalysis, onRetry }) => {
  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Algorithm Issues */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <span className="text-xl">📋</span> Kết quả kiểm tra định dạng
          </h3>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${issues.length === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {issues.length} Lỗi phát hiện
          </span>
        </div>
        
        <div className="p-4">
          {issues.length === 0 ? (
            <div className="text-center py-8 text-green-600">
              <div className="text-4xl mb-2">✅</div>
              <p>File đúng định dạng mẫu. Sẵn sàng trộn đề!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-sm">
                    <th className="p-3">Câu</th>
                    <th className="p-3">Lỗi phát hiện</th>
                    <th className="p-3">Gợi ý sửa</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-3 font-medium text-slate-700 whitespace-nowrap">{issue.questionLabel}</td>
                      <td className="p-3 text-red-600">{issue.issue}</td>
                      <td className="p-3 text-slate-600">{issue.suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* AI Analysis */}
      {aiAnalysis && (
        <div className="bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden">
           <div className="p-4 border-b border-indigo-50 bg-indigo-50/50 flex items-center gap-2">
            <span className="text-xl">✨</span> 
            <h3 className="font-semibold text-indigo-900">Nhận xét từ Gemini AI</h3>
          </div>
          <div className="p-6 prose prose-indigo max-w-none text-slate-700 bg-gradient-to-br from-white to-indigo-50/20">
             <pre className="whitespace-pre-wrap font-sans">{aiAnalysis}</pre>
          </div>
        </div>
      )}

      {issues.length > 0 && (
         <div className="flex justify-center pt-4">
            <button 
              onClick={onRetry}
              className="px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition-colors"
            >
              Chọn file khác
            </button>
         </div>
      )}
    </div>
  );
};