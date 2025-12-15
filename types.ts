// Global library definitions for CDN scripts
declare global {
  interface Window {
    JSZip: any;
    saveAs: any;
    XLSX: any;
  }
}

export enum QuestionType {
  MCQ = 'MCQ',         // A. B. C. D.
  TRUE_FALSE = 'TF',   // a) b) c) d)
  SHORT_ANSWER = 'SA', // <Key=...>
  ESSAY = 'ESSAY',     // Tự luận (Phần IV)
  UNKNOWN = 'UNKNOWN'
}

export interface MixOptions {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
}

export interface ValidationIssue {
  questionIndex: number; // 0-based
  questionLabel: string; // "Câu 1"
  issue: string;
  suggestion: string;
  severity: 'error' | 'warning';
  questionId?: string;
  questionType?: QuestionType;
}

export interface QuestionBlock {
  id: string;
  originalIndex: number;
  label: string; // e.g., "Câu 1"
  type: QuestionType;
  xmlContent: string[]; // Array of XML strings (outerHTML of w:p)
  textContent: string; // Plain text for analysis
  isValid: boolean;
  hasUnderline: boolean; // For MCQ/TF
  hasKeyTag: boolean; // For Short Answer
  section: string;
  detectedOptionNodes?: number; // Count of paragraphs identified as options
}

export interface DocSegment {
  type: 'static' | 'question';
  xmlContent: string[];
  textContent: string;
  questionData?: QuestionBlock; // Only if type is 'question'
}

export interface ProcessedDoc {
  file: File;
  questions: QuestionBlock[];
  segments: DocSegment[]; // Ordered list of all document parts
  originalXml: string; // Full document.xml content to use as template
  zip: any; // JSZip instance
  finalSectPr?: string;
}

export interface ExamHeaderConfig {
  enabled: boolean;
  schoolName: string;      // e.g. TRƯỜNG THPT NGUYỄN DU
  subName: string;         // e.g. TỔ TOÁN - TIN
  examTitle: string;       // e.g. KIỂM TRA GIỮA KỲ 1
  subject: string;         // e.g. MÔN: TOÁN 12
  time: string;            // e.g. Thời gian: 90 phút
  year: string;            // e.g. Năm học 2024 - 2025
  footerText?: string;     // e.g. Giáo viên: Nguyễn Văn A
}