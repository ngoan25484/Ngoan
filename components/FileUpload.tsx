import React, { useRef } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, isProcessing }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndUpload(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndUpload(e.target.files[0]);
    }
  };

  const validateAndUpload = (file: File) => {
    if (file.type === 'application/pdf') {
      alert("Vui lòng sử dụng file Word (.docx) để đảm bảo không bị lỗi công thức toán học.");
      return;
    }
    if (!file.name.endsWith('.docx')) {
      alert("Chỉ hỗ trợ file định dạng .docx");
      return;
    }
    onFileSelect(file);
  };

  return (
    <div 
      className="w-full max-w-2xl mx-auto mb-8"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className={`
        border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer
        ${isProcessing ? 'bg-slate-100 border-slate-300 opacity-50 cursor-wait' : 'bg-white border-primary/40 hover:border-primary hover:bg-blue-50/50'}
      `}
      onClick={() => !isProcessing && inputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={inputRef} 
          className="hidden" 
          accept=".docx" 
          onChange={handleChange}
          disabled={isProcessing}
        />
        
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl">
            DOCX
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-800">Tải lên đề thi gốc</h3>
            <p className="text-slate-500 mt-2">Kéo thả file .docx vào đây hoặc nhấn để chọn</p>
          </div>
          <div className="text-sm text-yellow-600 bg-yellow-50 px-4 py-2 rounded-lg border border-yellow-100">
            ⚠️ Khuyến nghị dùng file Word để giữ nguyên công thức toán (MathType/Equation)
          </div>
        </div>
      </div>
    </div>
  );
};