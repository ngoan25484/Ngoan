import React from 'react';

interface InstructionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstructionModal: React.FC<InstructionModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            📖 Hướng dẫn định dạng file Word
          </h2>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-700">
          
          {/* General Rules */}
          <section>
            <h3 className="text-lg font-bold text-blue-600 mb-2">1. Quy tắc chung</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>File đầu vào phải có định dạng <strong>.docx</strong> (Word).</li>
              <li>Sử dụng <strong>MathType</strong> hoặc <strong>Equation</strong> gốc của Word cho công thức toán.</li>
              <li>Mỗi câu hỏi phải bắt đầu bằng từ khóa <strong>"Câu [số]:"</strong> (Ví dụ: <em>Câu 1:</em>, <em>Câu 2.</em>).</li>
              <li>Phần chia nhóm (nếu có) dùng: <strong>PHẦN I.</strong>, <strong>PHẦN II.</strong>...</li>
              <li>Để chèn mã đề tự động vào nội dung, hãy dùng ký hiệu: <code className="bg-gray-100 px-1 rounded text-red-500 font-mono">[MA_DE]</code>.</li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* MCQ */}
          <section>
            <h3 className="text-lg font-bold text-blue-600 mb-2">2. Dạng Trắc Nghiệm (4 lựa chọn)</h3>
            <p className="text-sm mb-2">Các đáp án phải bắt đầu bằng <strong>A.</strong>, <strong>B.</strong>, <strong>C.</strong>, <strong>D.</strong></p>
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-3">
              <p className="text-sm font-bold text-yellow-800">⚠️ Quan trọng: Gạch chân (Underline) đáp án đúng.</p>
            </div>
            <div className="bg-slate-100 p-4 rounded-lg font-mono text-sm border border-slate-200">
              <p><strong>Câu 1:</strong> Tập nghiệm của phương trình x - 2 = 0 là:</p>
              <p>A. S = &#123;1&#125;.</p>
              <p><u>B.</u> S = &#123;2&#125;.  &lt;-- (Đáp án đúng phải gạch chân chữ cái hoặc cả dòng)</p>
              <p>C. S = &#123;-2&#125;.</p>
              <p>D. S = &#123;0&#125;.</p>
            </div>
          </section>

          {/* True/False */}
          <section>
            <h3 className="text-lg font-bold text-blue-600 mb-2">3. Dạng Đúng/Sai</h3>
            <p className="text-sm mb-2">Các ý nhỏ bắt đầu bằng <strong>a)</strong>, <strong>b)</strong>, <strong>c)</strong>, <strong>d)</strong>.</p>
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-3">
              <p className="text-sm font-bold text-yellow-800">⚠️ Quan trọng: Gạch chân ý nào là ĐÚNG (True).</p>
            </div>
            <div className="bg-slate-100 p-4 rounded-lg font-mono text-sm border border-slate-200">
              <p><strong>Câu 2:</strong> Cho hàm số y = f(x)...</p>
              <p><u>a)</u> Hàm số đồng biến trên R. &lt;-- (Gạch chân nghĩa là Đúng)</p>
              <p>b) Hàm số có 2 cực trị. &lt;-- (Không gạch chân nghĩa là Sai)</p>
              <p><u>c)</u> Giá trị lớn nhất là 5.</p>
              <p>d) Đồ thị đi qua điểm O.</p>
            </div>
          </section>

          {/* Short Answer */}
          <section>
            <h3 className="text-lg font-bold text-blue-600 mb-2">4. Dạng Trả Lời Ngắn</h3>
            <p className="text-sm mb-2">Sử dụng thẻ <code className="text-red-500 font-bold">&lt;Key=...&gt;</code> ở cuối câu hỏi hoặc cuối đoạn văn bản để định nghĩa đáp án.</p>
            <div className="bg-slate-100 p-4 rounded-lg font-mono text-sm border border-slate-200">
              <p><strong>Câu 3:</strong> Có bao nhiêu số nguyên dương nhỏ hơn 5?</p>
              <p>&lt;Key=4&gt;</p>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-primary text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
};