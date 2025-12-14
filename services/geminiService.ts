import { GoogleGenAI } from "@google/genai";
import { QuestionBlock } from "../types";

// Helper to sanitize text (limit length to save tokens)
const sanitizeContent = (questions: QuestionBlock[]) => {
  return questions.slice(0, 20).map(q => `
    Label: ${q.label}
    Type: ${q.type}
    Content: ${q.textContent.substring(0, 500)}...
  `).join("\n---\n");
};

export const checkContentWithGemini = async (questions: QuestionBlock[]): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "API Key chưa được cấu hình.";
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // We only check a subset or the full set depending on size. 
  // For this demo, let's pick invalid ones + random valid ones or just the text.
  const contentSnapshot = sanitizeContent(questions);

  const prompt = `
    Bạn là một trợ lý AI chuyên về Toán học THPT tại Việt Nam.
    Dưới đây là danh sách các câu hỏi được trích xuất từ một đề thi.
    Hãy kiểm tra và đưa ra nhận xét tổng quan về:
    1. Chính tả và ngữ pháp (nếu có lỗi nghiêm trọng).
    2. Logic toán học (nếu thấy lỗi hiển nhiên trong văn bản, ví dụ: 4 đáp án giống nhau, hoặc câu hỏi vô lý).
    3. Đề xuất cải thiện ngắn gọn.
    
    Lưu ý: Chỉ đưa ra nhận xét những lỗi quan trọng. Nếu đề có vẻ ổn, hãy khen ngợi.
    Không cần check định dạng gạch chân vì hệ thống đã check rồi.

    Danh sách câu hỏi:
    ${contentSnapshot}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "Không có phản hồi từ AI.";
  } catch (error: any) {
    console.error("Gemini Error:", error);

    // Robust error checking for 429/Quota limits
    // The error object structure can vary, check multiple properties
    const isQuotaError = 
      error.status === 429 || 
      error.code === 429 || 
      (error.message && error.message.includes("429")) || 
      (error.error && error.error.code === 429) ||
      (error.status === "RESOURCE_EXHAUSTED");

    if (isQuotaError) {
      return "⚠️ Tính năng kiểm tra bằng AI đang tạm dừng do vượt quá hạn mức miễn phí (Quota Exceeded). Bạn vẫn có thể thực hiện trộn đề bình thường mà không cần bước này.";
    }
    
    return "Đã xảy ra lỗi khi kết nối với Gemini API. Vui lòng thử lại sau.";
  }
};
