import React, { useState, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { ValidationReport } from './components/ValidationReport';
import { processDocxFile, getValidationIssues, generateVariants } from './services/docxService';
import { checkContentWithGemini } from './services/geminiService';
import { ProcessedDoc, ValidationIssue, ExamHeaderConfig } from './types';

const App: React.FC = () => {
  // State
  const [isProcessing, setIsProcessing] = useState(false);
  const [docData, setDocData] = useState<ProcessedDoc | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [variantCount, setVariantCount] = useState<number>(4);
  const [step, setStep] = useState<'upload' | 'validate' | 'success'>('upload');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New State: Start Code (initialized from local storage if available)
  const [startCode, setStartCode] = useState<number>(() => {
    const saved = localStorage.getItem('mathmixer_next_code');
    return saved ? parseInt(saved, 10) : 101;
  });

  // Header Config State - Initialize from LocalStorage if available
  const [headerConfig, setHeaderConfig] = useState<ExamHeaderConfig>(() => {
    const savedConfig = localStorage.getItem('mathmixer_header_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        return { ...parsed, enabled: false }; 
      } catch (e) {
        console.error("Error parsing saved config", e);
      }
    }
    return {
      enabled: false,
      schoolName: "TRƯỜNG THPT .........",
      subName: "TỔ TOÁN - TIN",
      examTitle: "ĐỀ KIỂM TRA .........",
      subject: "MÔN: TOÁN 12",
      time: "Thời gian: 90 phút",
      year: "Năm học 2024 - 2025",
      footerText: "Giáo viên: ........."
    };
  });

  const handleSaveHeaderConfig = () => {
    localStorage.setItem('mathmixer_header_config', JSON.stringify(headerConfig));
    alert("Đã lưu thông tin tiêu đề thành công! Lần sau truy cập thông tin này sẽ được tự động điền.");
  };

  const handleLoadSavedHeader = () => {
    const savedConfig = localStorage.getItem('mathmixer_header_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        // Giữ nguyên trạng thái enabled hiện tại, chỉ cập nhật nội dung
        setHeaderConfig(prev => ({ ...parsed, enabled: prev.enabled }));
      } catch (e) {
        console.error("Error parsing saved config", e);
      }
    } else {
      alert("Chưa có dữ liệu tiêu đề nào được lưu trước đó.");
    }
  };

  const handleResetHeader = () => {
    if (window.confirm("Bạn có chắc muốn xóa trắng các trường nhập liệu để nhập mới không?")) {
        setHeaderConfig({
            ...headerConfig,
            schoolName: "",
            subName: "",
            examTitle: "",
            subject: "",
            time: "",
            year: "",
            footerText: ""
        });
    }
  };

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    setErrorMsg(null);
    setAiAnalysis(null);
    
    try {
      // 1. Parse Docx
      const processed = await processDocxFile(file);
      setDocData(processed);

      // 2. Validate Algorithmic
      const detectedIssues = getValidationIssues(processed.questions);
      setIssues(detectedIssues);
      
      setStep('validate');

      // 3. Trigger AI Check (Async, don't block UI)
      // Only trigger if API key exists to avoid errors in demo env
      if (process.env.API_KEY) {
        checkContentWithGemini(processed.questions)
          .then(analysis => setAiAnalysis(analysis))
          .catch(err => console.error(err));
      } else {
        setAiAnalysis("Chưa cấu hình API_KEY. Bỏ qua bước kiểm tra nội dung bằng AI.");
      }

    } catch (err: any) {
      setErrorMsg(err.message || "Đã xảy ra lỗi khi đọc file.");
      setStep('upload');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShuffle = async () => {
    if (!docData) return;
    if (issues.length > 0) {
      const confirm = window.confirm("File vẫn còn lỗi định dạng. Bạn có chắc chắn muốn trộn đề không?");
      if (!confirm) return;
    }

    setIsProcessing(true);
    try {
      // Pass startCode directly to generate sequential codes
      await generateVariants(docData, variantCount, startCode, headerConfig);
      
      // Update persistent next code
      const nextCode = startCode + variantCount;
      setStartCode(nextCode);
      localStorage.setItem('mathmixer_next_code', nextCode.toString());
      
      setStep('success');
    } catch (err: any) {
      setErrorMsg("Lỗi khi trộn đề: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setDocData(null);
    setIssues([]);
    setAiAnalysis(null);
    setStep('upload');
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <span className="text-2xl">⚡</span>
            </div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">MathMixer <span className="text-primary">Pro</span></h1>
              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">v1.0</span>
            </div>
          </div>
          <div className="text-sm text-slate-500 font-medium">Hỗ trợ bởi Google Gemini</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full p-6">
        
        {/* Error Notification */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
            <span>⛔ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="font-bold hover:underline">Đóng</button>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="mt-10 animate-fade-in-up">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-slate-900 mb-3">Tải lên đề thi Toán của bạn</h2>
              <p className="text-slate-600 max-w-2xl mx-auto">
                Hệ thống sẽ tự động nhận diện câu hỏi, kiểm tra lỗi và trộn thành nhiều mã đề khác nhau. 
                Hỗ trợ công thức MathType và hình ảnh.
              </p>
            </div>
            <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />
          </div>
        )}

        {/* Step 2: Validation & Config */}
        {step === 'validate' && docData && (
          <div className="space-y-8 animate-fade-in">
            {/* Toolbar */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col lg:flex-row items-center justify-between gap-6">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Cấu hình trộn đề</h3>
                <p className="text-slate-500 text-sm">File gốc: {docData.file.name} ({docData.questions.length} câu)</p>
              </div>
              
              <div className="flex flex-wrap items-center gap-6 justify-center lg:justify-end">
                {/* Start Code Input */}
                <div className="flex flex-col">
                   <label className="text-xs font-semibold text-slate-500 mb-1">Mã đề bắt đầu</label>
                   <input 
                    type="number" 
                    min="0"
                    value={startCode}
                    onChange={(e) => setStartCode(Number(e.target.value))}
                    className="border border-slate-300 bg-white text-black rounded-lg px-4 py-2 w-32 text-center font-semibold focus:ring-2 focus:ring-primary focus:outline-none shadow-sm"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 text-center">Tự động tăng sau khi trộn</span>
                </div>

                {/* Variant Count Input */}
                <div className="flex flex-col">
                   <label className="text-xs font-semibold text-slate-500 mb-1">Số lượng đề</label>
                   <input 
                    type="number" 
                    min="1" 
                    max="20" 
                    value={variantCount}
                    onChange={(e) => setVariantCount(Number(e.target.value))}
                    className="border border-slate-300 bg-white text-black rounded-lg px-4 py-2 w-24 text-center font-semibold focus:ring-2 focus:ring-primary focus:outline-none shadow-sm"
                  />
                </div>
                
                <button 
                  onClick={handleShuffle}
                  disabled={isProcessing}
                  className="bg-primary hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 h-[46px] mt-auto"
                >
                  {isProcessing ? 'Đang xử lý...' : '🔀 Trộn Đề Ngay'}
                </button>
              </div>
            </div>

             {/* Header Info Input */}
             <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
               <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-black flex items-center gap-2">
                     <span className="text-2xl">📝</span> Thông tin tiêu đề & Footer
                  </h3>
                  <div className="flex items-center">
                    <input 
                      type="checkbox" 
                      id="enableHeader"
                      checked={headerConfig.enabled}
                      onChange={(e) => setHeaderConfig({...headerConfig, enabled: e.target.checked})}
                      className="w-5 h-5 text-primary border-gray-300 rounded focus:ring-primary cursor-pointer"
                    />
                    <label htmlFor="enableHeader" className="ml-2 text-black font-bold cursor-pointer select-none">
                       Tạo tiêu đề/Footer mới
                    </label>
                  </div>
               </div>

               {headerConfig.enabled && (
                 <div className="animate-fade-in">
                    <div className="flex items-center gap-3 mb-6 bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <button 
                            onClick={handleLoadSavedHeader}
                            className="text-sm px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-semibold rounded hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-2"
                        >
                            <span>🔄</span> Dùng cấu hình cũ
                        </button>
                         <button 
                            onClick={handleResetHeader}
                            className="text-sm px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-semibold rounded hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-2"
                        >
                            <span>✨</span> Nhập mới
                        </button>
                        <span className="text-xs text-slate-400 ml-auto italic">
                             Mặc định sử dụng dữ liệu cũ nếu không nhập mới
                        </span>
                    </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Existing Fields */}
                      <div>
                         <label className="block text-sm font-bold text-black mb-1">Tên Trường / Sở</label>
                         <input 
                            type="text" 
                            value={headerConfig.schoolName}
                            onChange={(e) => setHeaderConfig({...headerConfig, schoolName: e.target.value})}
                            placeholder="TRƯỜNG THPT NGUYỄN DU"
                            className="w-full border border-slate-300 bg-white text-black font-medium rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none placeholder-slate-400"
                         />
                      </div>
                      <div>
                         <label className="block text-sm font-bold text-black mb-1">Tên Kỳ Thi</label>
                         <input 
                            type="text" 
                            value={headerConfig.examTitle}
                            onChange={(e) => setHeaderConfig({...headerConfig, examTitle: e.target.value})}
                            placeholder="KIỂM TRA GIỮA KỲ 1"
                            className="w-full border border-slate-300 bg-white text-black font-medium rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none placeholder-slate-400"
                         />
                      </div>
                      <div>
                         <label className="block text-sm font-bold text-black mb-1">Đơn vị / Tổ (Dòng 2 trái)</label>
                         <input 
                            type="text" 
                            value={headerConfig.subName}
                            onChange={(e) => setHeaderConfig({...headerConfig, subName: e.target.value})}
                            placeholder="TỔ TOÁN - TIN"
                            className="w-full border border-slate-300 bg-white text-black font-medium rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none placeholder-slate-400"
                         />
                      </div>
                      <div>
                         <label className="block text-sm font-bold text-black mb-1">Năm học</label>
                         <input 
                            type="text" 
                            value={headerConfig.year}
                            onChange={(e) => setHeaderConfig({...headerConfig, year: e.target.value})}
                            placeholder="Năm học 2024 - 2025"
                            className="w-full border border-slate-300 bg-white text-black font-medium rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none placeholder-slate-400"
                         />
                      </div>
                      <div>
                         <label className="block text-sm font-bold text-black mb-1">Môn Thi</label>
                         <input 
                            type="text" 
                            value={headerConfig.subject}
                            onChange={(e) => setHeaderConfig({...headerConfig, subject: e.target.value})}
                            placeholder="MÔN: TOÁN 12"
                            className="w-full border border-slate-300 bg-white text-black font-medium rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none placeholder-slate-400"
                         />
                      </div>
                      <div>
                         <label className="block text-sm font-bold text-black mb-1">Thời gian làm bài</label>
                         <input 
                            type="text" 
                            value={headerConfig.time}
                            onChange={(e) => setHeaderConfig({...headerConfig, time: e.target.value})}
                            placeholder="Thời gian: 90 phút"
                            className="w-full border border-slate-300 bg-white text-black font-medium rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none placeholder-slate-400"
                         />
                      </div>
                      
                      {/* New Footer Field */}
                      <div className="md:col-span-2 mt-2 pt-4 border-t border-slate-100">
                         <label className="block text-sm font-bold text-black mb-1 flex items-center gap-1">
                            <span>🔻</span> Nội dung Footer / Chân trang
                         </label>
                         <input 
                            type="text" 
                            value={headerConfig.footerText || ""}
                            onChange={(e) => setHeaderConfig({...headerConfig, footerText: e.target.value})}
                            placeholder="Ví dụ: Giáo viên Nguyễn Văn A - Trường THPT XYZ"
                            className="w-full border border-slate-300 bg-white text-black font-medium rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none placeholder-slate-400"
                         />
                         <p className="text-xs text-slate-400 mt-1">
                            * Mã đề và số trang sẽ được tự động thêm vào góc phải footer.
                         </p>
                      </div>
                   </div>
                   <div className="mt-4 flex justify-end">
                      <button 
                        onClick={handleSaveHeaderConfig}
                        className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-700 transition-all shadow-sm active:scale-95"
                      >
                        <span>💾</span> Lưu cấu hình
                      </button>
                   </div>
                 </div>
               )}
             </div>

            {/* Validation Report */}
            <ValidationReport 
              issues={issues} 
              aiAnalysis={aiAnalysis} 
              onRetry={reset}
            />
          </div>
        )}

        {/* Step 3: Success */}
        {step === 'success' && (
          <div className="mt-10 text-center animate-fade-in">
            <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 text-5xl shadow-sm">
              🎉
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Trộn đề thành công!</h2>
            <p className="text-slate-600 mb-8">
              Các file đề thi mới đã được tải xuống máy của bạn.<br/>
              Kiểm tra thư mục Downloads.
            </p>
            <button 
              onClick={reset}
              className="px-8 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg transition-colors"
            >
              Làm tiếp đề khác
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;