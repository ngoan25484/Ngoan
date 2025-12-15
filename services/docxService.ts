import { QuestionType, QuestionBlock, ProcessedDoc, ValidationIssue, DocSegment, ExamHeaderConfig, MixOptions } from '../types';

const JSZip = window.JSZip;
const saveAs = window.saveAs;
const XLSX = window.XLSX;

const W_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
// Namespace cho file .rels (Package Relationships)
const PACKAGE_RELS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";
// Namespace cho thuộc tính r:id trong document.xml (Office Document Relationships)
const OFFICE_RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CONTENT_TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types";

// --- REGEX CONFIGURATION ---

// 1. Nhận diện bắt đầu câu hỏi. 
// Hỗ trợ: "Câu 1", "Câu 01", "Bài 1", "Câu hỏi 1", đi kèm dấu chấm, hai chấm hoặc khoảng trắng.
const QUESTION_START_REGEX = /^(\s*(?:Câu|Bài|Câu hỏi)\s*\d+)([\s\.:]+)?/i;

// 2. Nhận diện đáp án MCQ/TF
// Capture groups: $1=PrefixSpace, $2=Letter, $3=SpaceBeforeSep, $4=Separator
const OPTION_PREFIX_REGEX = /^(\s*)([A-D]|[a-d])(\s*)([\.\)\:])/; 

// 3. Regex tìm thẻ Key (để lấy đáp án đưa vào Excel)
const KEY_REGEX_EXTRACT = /<Key\s*=\s*([^>]*)>/i;

// 4. Regex để xóa thẻ Key ra khỏi file xuất (Tìm cụm <Key=*>)
// Lưu ý: Regex này dùng để match trên text đã gộp, không dùng trực tiếp test trên node lẻ
const KEY_TAG_REMOVE_PATTERN = "\\s*<Key\\s*=[^>]*>";

// Helper to shuffle array (Fisher-Yates)
const shuffleArray = <T>(array: T[]): T[] => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

// Helper: Parse XML string safely ensuring Namespace context
const parseXmlToNodes = (xmlString: string, contextDoc: Document): Node[] => {
    const wrappedXml = `<w:body xmlns:w="${W_NAMESPACE}">${xmlString}</w:body>`;
    const parser = new DOMParser();
    const doc = parser.parseFromString(wrappedXml, "application/xml");
    const parserError = doc.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
        console.warn("XML Parse Warning:", parserError[0].textContent);
    }
    const tempBody = doc.documentElement;
    const nodes: Node[] = [];
    const children = Array.from(tempBody.childNodes);
    children.forEach(child => {
        const importedNode = contextDoc.importNode(child, true);
        nodes.push(importedNode);
    });
    return nodes;
};

/**
 * Tạo danh sách đáp án cân bằng (A, B, C, D) ~25% mỗi loại.
 */
const generateBalancedKeys = (totalQuestions: number): string[] => {
  const options = ['A', 'B', 'C', 'D'];
  const baseCount = Math.floor(totalQuestions / 4);
  const remainder = totalQuestions % 4;
  
  let keys: string[] = [];
  for (let i = 0; i < 4; i++) {
    keys = keys.concat(Array(baseCount).fill(options[i]));
  }
  
  if (remainder > 0) {
    const remainderOptions = shuffleArray(options).slice(0, remainder);
    keys = keys.concat(remainderOptions);
  }
  
  return shuffleArray(keys);
};

const isQuestionStart = (text: string): boolean => {
  return QUESTION_START_REGEX.test(text.replace(/^\s+/, '')); 
};

const isSectionHeader = (text: string): boolean => {
  const regex = /^PHẦN\s+[IVX]+\./i;
  // Bổ sung nhận diện phần Tự luận nếu tiêu đề không bắt đầu bằng "PHẦN..." nhưng chứa "TỰ LUẬN"
  return regex.test(text.trim()) || /TỰ\s+LUẬN/i.test(text.trim());
};

const isEssaySectionLabel = (text: string): boolean => {
    // Nhận diện Phần IV hoặc chữ Tự Luận
    return /PHẦN\s+(IV|4)/i.test(text) || /TỰ\s+LUẬN/i.test(text);
};

const hasUnderline = (pNode: Element): boolean => {
  const runs = pNode.getElementsByTagName("w:r");
  for (let i = 0; i < runs.length; i++) {
    const rPr = runs[i].getElementsByTagName("w:rPr")[0];
    if (rPr) {
      const u = rPr.getElementsByTagName("w:u")[0];
      if (u) {
        const val = u.getAttribute("w:val");
        if (!val || (val && val !== "none")) return true;
      }
    }
  }
  return false;
};

const detectType = (text: string): QuestionType => {
  if (KEY_REGEX_EXTRACT.test(text)) return QuestionType.SHORT_ANSWER;
  
  // Split content into lines to better detect if options are on start of lines
  const lines = text.split('\n').map(l => l.trim());
  
  let mcqCount = 0;
  let tfCount = 0;

  lines.forEach(line => {
    // Check start of line strictly
    if (/^([A-D])[\.\)\:]/.test(line)) mcqCount++;
    if (/^([a-d])[\)\.]/.test(line)) tfCount++;
  });

  // Strong signal: If we see 2 or more options of a specific type
  if (mcqCount >= 2 && mcqCount > tfCount) return QuestionType.MCQ;
  if (tfCount >= 2 && tfCount > mcqCount) return QuestionType.TRUE_FALSE;

  // Fallback: Check if ALL options are on one line? (Inline options)
  // e.g. "A. 1  B. 2  C. 3  D. 4"
  // We identify this as MCQ so we can warn the user to split lines
  if (text.match(/A[\.\)\:].*B[\.\)\:].*C[\.\)\:]/s)) {
      return QuestionType.MCQ;
  }

  return QuestionType.UNKNOWN;
};

export const processDocxFile = async (file: File): Promise<ProcessedDoc> => {
  const zip = await JSZip.loadAsync(file);
  const docXmlFile = zip.file("word/document.xml");
  
  if (!docXmlFile) {
    throw new Error("Không tìm thấy word/document.xml. File docx không hợp lệ.");
  }

  const xmlString = await docXmlFile.async("string");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "application/xml");
  const body = xmlDoc.getElementsByTagName("w:body")[0];

  if (!body) {
    throw new Error("Cấu trúc file lỗi (thiếu w:body).");
  }

  // Extract <w:sectPr>
  let finalSectPr: string | undefined = undefined;
  for (let i = body.childNodes.length - 1; i >= 0; i--) {
      const node = body.childNodes[i];
      if (node.nodeType === 1 && node.nodeName === "w:sectPr") {
          finalSectPr = new XMLSerializer().serializeToString(node);
          body.removeChild(node);
          break;
      }
  }

  const segments: DocSegment[] = [];
  const questions: QuestionBlock[] = [];
  
  let currentSegment: DocSegment | null = null;
  let accumulatedNodes: Element[] = [];
  
  // Tracking current section
  let currentSectionLabel = "";

  const finishCurrentSegment = () => {
    if (currentSegment) {
      currentSegment.xmlContent = accumulatedNodes.map(n => new XMLSerializer().serializeToString(n));
      
      if (currentSegment.type === 'question') {
        const labelMatch = currentSegment.textContent.match(QUESTION_START_REGEX);
        // Normalize label to "Câu X"
        const label = labelMatch ? labelMatch[1].trim().replace(/^(Bài|Câu hỏi)\s*/i, "Câu ") : "Câu ?";
        
        let hasU = false;
        let hasKey = KEY_REGEX_EXTRACT.test(currentSegment.textContent);
        let optionNodeCount = 0;
        
        let qType = detectType(currentSegment.textContent);

        // LOGIC QUAN TRỌNG: Xử lý Tự luận (Phần IV)
        // Nếu câu hỏi nằm trong vùng "Tự Luận" hoặc "Phần IV"
        // VÀ kiểu chưa xác định (do không có A,B,C,D) HOẶC là Short Answer nhưng ko có Key (trường hợp hiếm)
        // -> Gán cứng là ESSAY và coi là hợp lệ.
        if (isEssaySectionLabel(currentSectionLabel)) {
             if (qType === QuestionType.UNKNOWN) {
                 qType = QuestionType.ESSAY;
             }
        }

        accumulatedNodes.forEach(node => {
           if (node.nodeName === 'w:p') {
             if (hasUnderline(node)) hasU = true;
             // Count nodes that look like options
             if ((qType === QuestionType.MCQ || qType === QuestionType.TRUE_FALSE) && node.textContent && OPTION_PREFIX_REGEX.test(node.textContent)) {
                optionNodeCount++;
             }
           }
        });

        const qBlock: QuestionBlock = {
          id: crypto.randomUUID(),
          originalIndex: questions.length,
          label,
          section: currentSectionLabel, // Assign current section
          type: qType,
          xmlContent: currentSegment.xmlContent,
          textContent: currentSegment.textContent,
          isValid: true,
          hasUnderline: hasU,
          hasKeyTag: hasKey,
          detectedOptionNodes: optionNodeCount
        };
        
        // Validation logic
        if (qBlock.type === QuestionType.MCQ && !qBlock.hasUnderline) qBlock.isValid = false;
        if (qBlock.type === QuestionType.TRUE_FALSE && !qBlock.hasUnderline) qBlock.isValid = false;
        if (qBlock.type === QuestionType.SHORT_ANSWER && !qBlock.hasKeyTag) qBlock.isValid = false;
        
        // ESSAY is always valid if it has content
        if (qBlock.type === QuestionType.ESSAY) {
            qBlock.isValid = true;
        }
        
        if (qBlock.type === QuestionType.UNKNOWN) qBlock.isValid = false;

        questions.push(qBlock);
        currentSegment.questionData = qBlock;
      }
      
      segments.push(currentSegment);
      accumulatedNodes = [];
      currentSegment = null;
    }
  };

  const childNodes = Array.from(body.childNodes) as Element[];

  for (const node of childNodes) {
    const nodeName = node.nodeName; 
    const textContent = node.textContent || "";
    
    if (nodeName === "w:p" && isSectionHeader(textContent)) {
      finishCurrentSegment();
      // Found a new section
      currentSectionLabel = textContent.trim();
      currentSegment = { type: 'static', xmlContent: [], textContent: textContent };
      accumulatedNodes.push(node);
    }
    else if (nodeName === "w:p" && isQuestionStart(textContent)) {
      finishCurrentSegment();
      currentSegment = { type: 'question', xmlContent: [], textContent: textContent };
      accumulatedNodes.push(node);
    }
    else {
      if (!currentSegment) {
        currentSegment = { type: 'static', xmlContent: [], textContent: "" };
      }
      accumulatedNodes.push(node);
      currentSegment.textContent += (currentSegment.textContent ? "\n" : "") + textContent;
    }
  }

  finishCurrentSegment();

  return { file, questions, segments, originalXml: xmlString, zip, finalSectPr };
};

export const getValidationIssues = (questions: QuestionBlock[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  questions.forEach((q, index) => {
    // Check specific logic issues first
    if (q.type === QuestionType.MCQ) {
       // Check if options are split into nodes
       if (q.detectedOptionNodes !== undefined && q.detectedOptionNodes < 2) {
         issues.push({
            questionId: q.id,
            questionIndex: index,
            questionLabel: q.label,
            questionType: q.type,
            issue: "Các đáp án không nằm trên dòng riêng biệt.",
            suggestion: "Vui lòng ngắt dòng (Enter) giữa các đáp án A, B, C, D để phần mềm có thể trộn.",
            severity: 'error'
         });
       }

       if (!q.hasUnderline) {
          issues.push({
            questionId: q.id,
            questionIndex: index,
            questionLabel: q.label,
            questionType: q.type,
            issue: "Chưa gạch chân đáp án đúng.",
            suggestion: "Vui lòng gạch chân (Underline) vào đáp án đúng (A, B, C hoặc D).",
            severity: 'error'
          });
       }
    } else if (q.type === QuestionType.TRUE_FALSE) {
        if (!q.hasUnderline) {
           issues.push({
            questionId: q.id,
            questionIndex: index,
            questionLabel: q.label,
            questionType: q.type,
            issue: "Chưa có ý nào được gạch chân (Đúng).",
            suggestion: "Gạch chân vào các ý Đúng (a, b, c, d). Nếu tất cả đều Sai, hãy kiểm tra lại xem đã định dạng đúng chưa.",
            severity: 'warning'
          });
        }
    } else if (q.type === QuestionType.SHORT_ANSWER) {
        if (!q.hasKeyTag) {
           issues.push({
            questionId: q.id,
            questionIndex: index,
            questionLabel: q.label,
            questionType: q.type,
            issue: "Thiếu thẻ đáp án <Key=...>.",
            suggestion: "Thêm thẻ <Key=Giá trị> vào cuối câu hỏi.",
            severity: 'error'
          });
        }
    } else if (q.type === QuestionType.ESSAY) {
        // Essay questions generally don't need validation like keys or underlines
        // unless they are empty
        if (!q.textContent || q.textContent.trim().length < 5) {
             issues.push({
                questionId: q.id,
                questionIndex: index,
                questionLabel: q.label,
                questionType: q.type,
                issue: "Nội dung câu tự luận quá ngắn hoặc trống.",
                suggestion: "Kiểm tra lại nội dung câu hỏi.",
                severity: 'warning'
              });
        }
    } else if (q.type === QuestionType.UNKNOWN) {
         issues.push({
            questionId: q.id,
            questionIndex: index,
            questionLabel: q.label,
            questionType: q.type,
            issue: "Không nhận diện được dạng câu hỏi.",
            suggestion: "Kiểm tra lại định dạng. Nếu là tự luận, hãy đảm bảo nó nằm trong phần có tiêu đề 'PHẦN IV' hoặc 'TỰ LUẬN'.",
            severity: 'error'
          });
    }
  });

  return issues;
};

export const applyFixToQuestion = (question: QuestionBlock, fixValue: string): boolean => {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  
  const nodes = question.xmlContent.map(xml => {
      const wrapped = `<w:body xmlns:w="${W_NAMESPACE}">${xml}</w:body>`;
      const doc = parser.parseFromString(wrapped, "application/xml");
      return doc.documentElement.firstChild as Element;
  }).filter(n => n !== null);

  let isModified = false;

  if (question.type === QuestionType.MCQ || question.type === QuestionType.TRUE_FALSE) {
    for (const node of nodes) {
      if (node.textContent && OPTION_PREFIX_REGEX.test(node.textContent)) {
        const match = node.textContent.match(OPTION_PREFIX_REGEX);
        // Note: Match indices shifted due to extra groups. Letter is $2.
        if (match && match[2].toLowerCase() === fixValue.toLowerCase()) {
           const runs = Array.from(node.getElementsByTagName("w:r"));
           runs.forEach(r => {
             let rPr = r.getElementsByTagName("w:rPr")[0];
             if (!rPr) {
               rPr = parser.parseFromString(`<w:rPr xmlns:w="${W_NAMESPACE}"></w:rPr>`, "application/xml").documentElement;
               r.insertBefore(rPr, r.firstChild);
             }
             const oldU = rPr.getElementsByTagName("w:u")[0];
             if (oldU) rPr.removeChild(oldU);
             
             const newU = parser.parseFromString(`<w:u w:val="single" xmlns:w="${W_NAMESPACE}"/>`, "application/xml").documentElement;
             rPr.appendChild(newU);
           });
           isModified = true;
           question.hasUnderline = true;
        }
      }
    }
  } else if (question.type === QuestionType.SHORT_ANSWER) {
    const lastNode = nodes[nodes.length - 1];
    if (lastNode) {
       const newRunXml = `<w:r xmlns:w="${W_NAMESPACE}"><w:t xml:space="preserve"> &lt;Key=${fixValue}&gt;</w:t></w:r>`;
       const newRun = parser.parseFromString(newRunXml, "application/xml").documentElement;
       lastNode.appendChild(newRun);
       
       question.textContent += ` <Key=${fixValue}>`;
       isModified = true;
       question.hasKeyTag = true;
    }
  }

  if (isModified) {
    question.xmlContent = nodes.map(n => serializer.serializeToString(n));
    question.isValid = true;
    return true;
  }
  return false;
};

// --- STYLING HELPERS ---

const applyRunStyle = (runNode: Element, options: { bold?: boolean, color?: string }) => {
    let rPr = runNode.getElementsByTagName("w:rPr")[0];
    if (!rPr) {
        rPr = runNode.ownerDocument.createElementNS(W_NAMESPACE, "w:rPr");
        runNode.insertBefore(rPr, runNode.firstChild);
    }
    
    if (options.bold) {
        if (!rPr.getElementsByTagName("w:b")[0]) {
             const b = runNode.ownerDocument.createElementNS(W_NAMESPACE, "w:b");
             rPr.appendChild(b);
        }
    }
    
    if (options.color) {
        const existingColor = rPr.getElementsByTagName("w:color")[0];
        if (existingColor) rPr.removeChild(existingColor);
        
        const color = runNode.ownerDocument.createElementNS(W_NAMESPACE, "w:color");
        color.setAttribute("w:val", options.color);
        rPr.appendChild(color);
    }
}

// Hàm thay đổi nhãn (A, B, C, D)
// Hỗ trợ cả trường hợp "A." và "A" (do split run), hỗ trợ khoảng trắng "A ."
const replaceOptionLabel = (node: Node, newLabel: string, separator: string = ".") => {
  if (node.nodeName === "w:t" && node.textContent) {
    const text = node.textContent;

    // Pattern 1: Chuẩn "A.", "A)", "A :" có thể có khoảng trắng "A ."
    // Note: Use simple regex that expects letter and separator
    const standardRegex = /^(\s*)([A-D]|[a-d])(\s*)([\.\)\:])/; 
    if (standardRegex.test(text)) {
       // $1: Leading space
       // $2: Letter (replaced by newLabel)
       // $3: Space between letter and separator (removed to enforce format)
       // $4: Separator (replaced by separator arg)
       node.textContent = text.replace(standardRegex, `$1${newLabel}${separator}`);
       
       // APPLY STYLE: Blue Bold
       if (node.parentNode && node.parentNode.nodeName === "w:r") {
          applyRunStyle(node.parentNode as Element, { bold: true, color: "0000FF" });
       }
       return true;
    }

    // Pattern 2: Chỉ có chữ "A" (split run)
    const looseRegex = /^(\s*)([A-D]|[a-d])(\s*)$/;
    if (looseRegex.test(text)) {
        // Chỉ thay chữ cái, giữ nguyên khoảng trắng
        node.textContent = text.replace(looseRegex, `$1${newLabel}$3`);
        
        // APPLY STYLE: Blue Bold
        if (node.parentNode && node.parentNode.nodeName === "w:r") {
          applyRunStyle(node.parentNode as Element, { bold: true, color: "0000FF" });
        }
        return true;
    }
  }
  for (let i = 0; i < node.childNodes.length; i++) {
    if (replaceOptionLabel(node.childNodes[i], newLabel, separator)) return true;
  }
  return false;
};

// Robust function to clean Key tags even if they are split across multiple w:t nodes
const cleanKeyTagFromParagraph = (pNode: Node) => {
    // 1. Map nodes
    const textNodes: { node: Node, text: string, start: number, end: number }[] = [];
    let currentPos = 0;
    
    const collect = (n: Node) => {
        if (n.nodeName === "w:t" && n.textContent) {
            const len = n.textContent.length;
            textNodes.push({ node: n, text: n.textContent, start: currentPos, end: currentPos + len });
            currentPos += len;
        } else {
            n.childNodes.forEach(c => collect(c));
        }
    }
    collect(pNode);
    if (textNodes.length === 0) return;

    const fullText = textNodes.map(t => t.text).join("");
    
    // 2. Find removal ranges
    const regex = new RegExp(KEY_TAG_REMOVE_PATTERN, "gi");
    let match;
    const rangesToRemove: {start: number, end: number}[] = [];
    while ((match = regex.exec(fullText)) !== null) {
        rangesToRemove.push({ start: match.index, end: match.index + match[0].length });
    }
    
    if (rangesToRemove.length === 0) return;

    // 3. Update nodes
    textNodes.forEach(tNode => {
        // Find ranges that overlap with this node
        const nodeRanges = rangesToRemove.filter(r => r.start < tNode.end && r.end > tNode.start);
        
        if (nodeRanges.length === 0) return; // No changes for this node

        // We reconstruct the node text
        // The parts of the node TO KEEP are those NOT in nodeRanges
        
        const nodeText = tNode.text;
        let builtText = "";
        let lastKeptIndex = 0; // relative to node text

        nodeRanges.forEach(r => {
            // Intersect range r with node range [start, end]
            // Convert intersection to local coords [0, length]
            const rStartLocal = Math.max(0, r.start - tNode.start);
            const rEndLocal = Math.min(nodeText.length, r.end - tNode.start);
            
            if (rStartLocal > lastKeptIndex) {
                builtText += nodeText.substring(lastKeptIndex, rStartLocal);
            }
            lastKeptIndex = Math.max(lastKeptIndex, rEndLocal);
        });
        
        if (lastKeptIndex < nodeText.length) {
            builtText += nodeText.substring(lastKeptIndex);
        }
        
        tNode.node.textContent = builtText;
    });
};

// Cập nhật mã đề và định dạng canh phải (Right Align)
const updateExamCode = (node: Node, code: string): boolean => {
  let modified = false;
  if (node.nodeName === "w:t" && node.textContent) {
    const originalText = node.textContent;
    let newText = originalText;
    
    // Replace placeholders [MA_DE]
    if (newText.includes("[MA_DE]")) {
        newText = newText.split("[MA_DE]").join(code);
    }
    
    // Replace pattern "Mã đề: ..."
    const regex = /(Mã\s*đề(?:\s*thi)?\s*[:]\s*)(\d+|[.]{2,}|_{2,}|\[.*?\]|\s*)/gi;
    if (regex.test(newText)) {
       newText = newText.replace(regex, `$1${code}`);
    }

    if (newText !== originalText) {
        node.textContent = newText;
        modified = true;
    }
  }

  node.childNodes.forEach(child => {
     if (updateExamCode(child, code)) modified = true;
  });

  // Nếu node text này bị thay đổi (tức là chứa mã đề), hãy tìm thẻ P cha và set canh phải
  if (modified && node.nodeName === "w:t") {
      let p = node.parentNode;
      // Leo lên cây DOM để tìm thẻ w:p
      while (p && p.nodeName !== "w:p" && p.nodeName !== "w:body") {
          p = p.parentNode;
      }
      if (p && p.nodeName === "w:p") {
          const pEl = p as Element;
          let pPr = pEl.getElementsByTagName("w:pPr")[0];
          
          // Nếu chưa có pPr, tạo mới
          if (!pPr) {
             if (pEl.ownerDocument) {
                 pPr = pEl.ownerDocument.createElementNS(W_NAMESPACE, "w:pPr");
                 pEl.insertBefore(pPr, pEl.firstChild);
             }
          }

          if (pPr && pEl.ownerDocument) {
              // Xóa canh lề cũ nếu có
              const oldJc = pPr.getElementsByTagName("w:jc")[0];
              if (oldJc) pPr.removeChild(oldJc);
              
              // Thêm canh lề phải
              const newJc = pEl.ownerDocument.createElementNS(W_NAMESPACE, "w:jc");
              newJc.setAttribute("w:val", "right");
              pPr.appendChild(newJc);
          }
      }
  }
  
  return modified;
};

const createHeaderXml = (config: ExamHeaderConfig, examCode: string): string => {
  const schoolUpper = config.schoolName.toUpperCase();
  const titleUpper = config.examTitle.toUpperCase();
  // Bảng 2 cột: Cột trái (Trường, Tổ), Cột phải (Tiêu đề, Mã đề)
  return `
    <w:tbl xmlns:w="${W_NAMESPACE}">
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="5000"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${schoolUpper}</w:t></w:r></w:p>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${config.subName}</w:t></w:r></w:p>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>------------------</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${titleUpper}</w:t></w:r></w:p>
           <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${config.year}</w:t></w:r></w:p>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${config.subject}</w:t></w:r></w:p>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>(${config.time})</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
         <w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>
         <w:tc>
            <w:p>
               <w:pPr><w:jc w:val="right"/></w:pPr>
               <w:r><w:rPr><w:b/></w:rPr><w:t>Mã đề thi: ${examCode}</w:t></w:r>
            </w:p>
         </w:tc>
      </w:tr>
    </w:tbl>
    <w:p xmlns:w="${W_NAMESPACE}"/>
  `;
};

// Footer Creation
const createFooterXml = (footerText: string, examCode: string): string => {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:ftr xmlns:w="${W_NAMESPACE}">
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Footer"/>
          <w:tabs>
            <w:tab w:val="right" w:pos="9000"/>
          </w:tabs>
          <w:pBdr>
             <w:top w:val="single" w:sz="6" w:space="1" w:color="auto"/>
          </w:pBdr>
        </w:pPr>
        <w:r>
          <w:t>${footerText || ""}</w:t>
        </w:r>
        <w:r><w:tab/></w:r>
        <w:r>
          <w:t xml:space="preserve">Mã đề: ${examCode}   Trang </w:t>
        </w:r>
        <w:fldSimple w:instr="PAGE"/>
        <w:r>
          <w:t xml:space="preserve"> / </w:t>
        </w:r>
        <w:fldSimple w:instr="NUMPAGES"/>
      </w:p>
    </w:ftr>`;
};

// Function to ensure footer relationship and content type exists in the zip
const setupFooterFiles = async (zip: any): Promise<string> => {
    // 1. Check/Add Content Type for Footer
    const contentTypesFile = zip.file("[Content_Types].xml");
    if (contentTypesFile) {
        let contentTypesXml = await contentTypesFile.async("string");
        // Check for specific footer PartName to avoid duplicate overrides for the same file
        if (!contentTypesXml.includes('PartName="/word/footer1.xml"')) {
             const overrideStr = `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`;
             if (contentTypesXml.includes("</Types>")) {
                contentTypesXml = contentTypesXml.replace("</Types>", overrideStr + "</Types>");
                zip.file("[Content_Types].xml", contentTypesXml);
             }
        }
    }

    // 2. Check/Add Relationship in word/_rels/document.xml.rels
    const relsFile = zip.file("word/_rels/document.xml.rels");
    let footerRid = "rIdFooter1";

    if (relsFile) {
        let relsXml = await relsFile.async("string");
        const footerType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
        
        // Check if a footer already exists?
        const parser = new DOMParser();
        const relsDoc = parser.parseFromString(relsXml, "application/xml");
        const relationships = relsDoc.getElementsByTagName("Relationship");
        
        let found = false;
        for (let i = 0; i < relationships.length; i++) {
            const target = relationships[i].getAttribute("Target");
            if (target === "footer1.xml" || target === "/word/footer1.xml") {
                footerRid = relationships[i].getAttribute("Id") || footerRid;
                found = true;
                break;
            }
        }

        if (!found) {
             footerRid = "rIdFooterGen1"; 
             const newRel = `<Relationship Id="${footerRid}" Type="${footerType}" Target="footer1.xml"/>`;
             if (relsXml.includes("</Relationships>")) {
                 relsXml = relsXml.replace("</Relationships>", newRel + "</Relationships>");
                 zip.file("word/_rels/document.xml.rels", relsXml);
             }
        }
    }
    return footerRid;
};


const getAnswerFromNodes = (nodes: Element[], type: QuestionType, originalText: string): string => {
  if (type === QuestionType.SHORT_ANSWER) {
    const match = originalText.match(KEY_REGEX_EXTRACT);
    return match ? match[1].trim() : "";
  }
  
  // ESSAY has no specific answer key for automated grading
  if (type === QuestionType.ESSAY) {
    return ""; // Or return "TL" if desired
  }
  
  const labelsMCQ = ['A', 'B', 'C', 'D'];
  
  if (type === QuestionType.MCQ) {
    let answerByPosition = "";
    let currentOptionLabelIndex = 0;
    
    for (const node of nodes) {
      const text = node.textContent || "";
      if (OPTION_PREFIX_REGEX.test(text)) {
        if (hasUnderline(node)) {
           const match = text.match(OPTION_PREFIX_REGEX);
           if (match) {
               return match[2].toUpperCase(); 
           }
           if (currentOptionLabelIndex < labelsMCQ.length) {
             answerByPosition = labelsMCQ[currentOptionLabelIndex];
           }
        }
        currentOptionLabelIndex++;
      }
    }
    return answerByPosition;
  }
  
  if (type === QuestionType.TRUE_FALSE) {
    let answerSeq = "";
    nodes.forEach(node => {
      const text = node.textContent || "";
      if (OPTION_PREFIX_REGEX.test(text)) {
        if (hasUnderline(node)) {
          answerSeq += "Đ";
        } else {
          answerSeq += "S";
        }
      }
    });
    return answerSeq;
  }

  return "";
};

const shuffleQuestionOptions = (nodes: Element[], type: QuestionType, targetLabel?: string): Element[] => {
  // Essay questions do not have options to shuffle
  if (type === QuestionType.ESSAY) return nodes;

  const optionIndices: number[] = [];
  let correctOptionIndexOriginal = -1;
  let detectedSeparator = "."; // Default separator

  nodes.forEach((node, idx) => {
    const text = node.textContent || "";
    // Check strict pattern to identify option and separator
    const match = text.match(OPTION_PREFIX_REGEX);
    if (match) {
      optionIndices.push(idx);
      // Capture the separator used in the document (., ), or :). Group 4.
      detectedSeparator = match[4]; 

      if (type === QuestionType.MCQ && hasUnderline(node)) {
        correctOptionIndexOriginal = idx;
      }
    } else {
       // Support loose matching for split runs if needed
       const looseRegex = /^(\s*)([A-D]|[a-d])(\s*)$/;
       if (looseRegex.test(text)) {
          optionIndices.push(idx);
          if (type === QuestionType.MCQ && hasUnderline(node)) {
            correctOptionIndexOriginal = idx;
          }
       }
    }
  });

  if (optionIndices.length < 2) return nodes;

  const optionNodes = optionIndices.map(i => nodes[i]);
  let shuffledNodes: Element[];

  if (type === QuestionType.MCQ && targetLabel && correctOptionIndexOriginal !== -1) {
    const correctNode = nodes[correctOptionIndexOriginal];
    const distractors = optionNodes.filter(n => n !== correctNode);
    const shuffledDistractors = shuffleArray(distractors);
    const targetMap: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    let targetIndex = targetMap[targetLabel] ?? 0;
    if (targetIndex >= optionNodes.length) targetIndex = targetIndex % optionNodes.length;

    shuffledNodes = new Array(optionNodes.length);
    let distractorIdx = 0;
    for (let i = 0; i < optionNodes.length; i++) {
      if (i === targetIndex) {
        shuffledNodes[i] = correctNode;
      } else {
        shuffledNodes[i] = shuffledDistractors[distractorIdx++] || correctNode;
      }
    }
  } else {
    shuffledNodes = shuffleArray(optionNodes);
  }
  
  const labelsMCQ = ['A', 'B', 'C', 'D', 'E', 'F'];
  const labelsTF = ['a', 'b', 'c', 'd', 'e', 'f'];
  
  shuffledNodes.forEach((node, idx) => {
    // Determine new label based on NEW Position (Index)
    const label = type === QuestionType.MCQ ? labelsMCQ[idx] : labelsTF[idx];
    
    // Explicitly update the text content to match the new position
    // FORCE DOT SEPARATOR FOR MCQ to satisfy requirement "A. B. C. D."
    const separatorToUse = type === QuestionType.MCQ ? "." : detectedSeparator;

    replaceOptionLabel(node, label, separatorToUse);
  });

  const newNodes = [...nodes];
  optionIndices.forEach((originalIndex, i) => {
    newNodes[originalIndex] = shuffledNodes[i];
  });

  return newNodes;
};

// --- LOGIC DÀN TRANG (LAYOUT OPTIMIZATION) ---

const setupParagraphTab = (pNode: Element, doc: Document, tabPositions: number[]) => {
    let pPr = pNode.getElementsByTagName("w:pPr")[0];
    if (!pPr) {
        pPr = doc.createElementNS(W_NAMESPACE, "w:pPr");
        pNode.insertBefore(pPr, pNode.firstChild);
    }
    
    // Remove existing tabs to avoid conflict
    const oldTabs = pPr.getElementsByTagName("w:tabs")[0];
    if (oldTabs) pPr.removeChild(oldTabs);

    const tabs = doc.createElementNS(W_NAMESPACE, "w:tabs");
    
    tabPositions.forEach(pos => {
        const tab = doc.createElementNS(W_NAMESPACE, "w:tab");
        tab.setAttribute("w:val", "left");
        tab.setAttribute("w:pos", Math.round(pos).toString());
        tabs.appendChild(tab);
    });
    
    pPr.appendChild(tabs);
};

const reformatMCQLayout = (nodes: Element[], doc: Document): Element[] => {
  // Chỉ áp dụng nếu có đúng 4 nodes (A, B, C, D)
  if (nodes.length !== 4) return nodes;

  // 1. Calculate MAX Length of option texts
  const lengths = nodes.map(n => {
     let textLen = (n.textContent || "").replace(/\s+/g, ' ').trim().length;
     // Check for Math formulas (m:oMath) or Images (w:drawing)
     // If present, add virtual weight to avoid squeezing complex items
     if (n.getElementsByTagName("m:oMath").length > 0 || n.getElementsByTagName("w:drawing").length > 0) {
        textLen += 20; 
     }
     return textLen;
  });
  
  const maxLength = Math.max(...lengths);

  /**
   * Helper: Merge content from pSource into pDest and add a TAB separator
   */
  const mergeParagraphsWithTab = (pDest: Element, pSource: Element) => {
      // 1. Create Run containing Tab
      const rTab = doc.createElementNS(W_NAMESPACE, "w:r");
      const tab = doc.createElementNS(W_NAMESPACE, "w:tab");
      rTab.appendChild(tab);
      pDest.appendChild(rTab);

      // 2. Move ALL content nodes (w:r, w:hyperlink, w:oMath...) from Source to Dest
      // IMPORTANT: Do NOT move w:pPr (properties)
      const childrenToMove: Node[] = [];
      pSource.childNodes.forEach(child => {
         if (child.nodeName !== 'w:pPr') {
             childrenToMove.push(child);
         }
      });

      childrenToMove.forEach(child => {
          pDest.appendChild(child);
      });
  };

  // --- CASE 1: 4 Cột (1 Dòng) ---
  // Điều kiện: Max Length <= 10
  if (maxLength <= 10) {
      const base = nodes[0];
      mergeParagraphsWithTab(base, nodes[1]);
      mergeParagraphsWithTab(base, nodes[2]);
      mergeParagraphsWithTab(base, nodes[3]);
      
      // Setup distributed tabs: 2250 (1/4), 4500 (1/2), 6750 (3/4)
      setupParagraphTab(base, doc, [2250, 4500, 6750]);
      
      return [base];
  }

  // --- CASE 2: 2 Cột (2 Dòng) ---
  // Điều kiện: Max Length <= 30
  if (maxLength <= 30) {
      // Row 1: A + Tab + B
      const row1 = nodes[0];
      mergeParagraphsWithTab(row1, nodes[1]);
      
      // Row 2: C + Tab + D
      const row2 = nodes[2];
      mergeParagraphsWithTab(row2, nodes[3]);
      
      // Tab stop at Center (4500)
      setupParagraphTab(row1, doc, [4500]);
      setupParagraphTab(row2, doc, [4500]);
      
      return [row1, row2];
  }

  // --- CASE 3: 1 Cột (4 Dòng) ---
  // Fallback: Giữ nguyên
  return nodes;
};


const replaceQuestionLabel = (node: Node, newNum: number) => {
  if (node.nodeName === "w:t") {
    if (node.textContent && QUESTION_START_REGEX.test(node.textContent)) {
      // Reconstruct label: "Câu " + number + original separator
      node.textContent = node.textContent.replace(QUESTION_START_REGEX, `Câu ${newNum}$2`);

      // APPLY STYLE: Blue Bold
       if (node.parentNode && node.parentNode.nodeName === "w:r") {
          applyRunStyle(node.parentNode as Element, { bold: true, color: "0000FF" });
       }
    }
  }
  node.childNodes.forEach(child => replaceQuestionLabel(child, newNum));
};

export const generateVariants = async (
  docData: ProcessedDoc, 
  count: number,
  startCode: number = 101,
  headerConfig?: ExamHeaderConfig,
  mixOptions: MixOptions = { shuffleQuestions: true, shuffleOptions: true }
): Promise<Blob> => {
  const { questions, segments, originalXml, zip } = docData;

  // Separate questions by Section
  const p1Questions = questions.filter(q => /PHẦN\s+I\./i.test(q.section));
  const p2Questions = questions.filter(q => /PHẦN\s+II\./i.test(q.section));
  const p3Questions = questions.filter(q => /PHẦN\s+III\./i.test(q.section));
  
  // Logic bổ sung cho PHẦN IV (Tự luận)
  const p4Questions = questions.filter(q => /PHẦN\s+(IV|4)\./i.test(q.section) || /TỰ\s+LUẬN/i.test(q.section));
  
  // Remaining questions (e.g. if no sections or unmatched)
  const otherQuestions = questions.filter(q => 
    !/PHẦN\s+I\./i.test(q.section) && 
    !/PHẦN\s+II\./i.test(q.section) && 
    !/PHẦN\s+III\./i.test(q.section) &&
    !/PHẦN\s+(IV|4)\./i.test(q.section) && 
    !/TỰ\s+LUẬN/i.test(q.section)
  );
  
  const header1Segment = segments.find(s => s.type === 'static' && s.textContent.match(/PHẦN\s+I\./i));
  const header2Segment = segments.find(s => s.type === 'static' && s.textContent.match(/PHẦN\s+II\./i));
  const header3Segment = segments.find(s => s.type === 'static' && s.textContent.match(/PHẦN\s+III\./i));
  // Tìm header cho Phần 4
  const header4Segment = segments.find(s => s.type === 'static' && (s.textContent.match(/PHẦN\s+(IV|4)\./i) || s.textContent.match(/TỰ\s+LUẬN/i)));
  
  let preambleSegments: DocSegment[] = [];
  if (!headerConfig?.enabled) {
    for (const s of segments) {
      if (s.type === 'question') break;
      if (s === header1Segment || s === header2Segment || s === header3Segment || s === header4Segment) break;
      if (s.type === 'static') preambleSegments.push(s);
    }
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(originalXml, "application/xml");
  const masterZip = new JSZip();

  // Setup Footer Files in the base Zip structure
  let footerRid = "";
  if (headerConfig?.enabled) {
      footerRid = await setupFooterFiles(zip);
  }

  const allVariantAnswers: { code: string; answers: Record<number, string> }[] = [];
  
  for (let i = 1; i <= count; i++) {
    const variantCode = (startCode + i - 1).toString();
    const variantAnswers: Record<number, string> = {};
    
    // Global counter for Excel rows (keeps absolute index 1..N)
    let globalExcelStt = 1;

    const variantDoc = xmlDoc.cloneNode(true) as Document;
    const variantBody = variantDoc.getElementsByTagName("w:body")[0];
    
    while (variantBody.firstChild) {
      variantBody.removeChild(variantBody.firstChild);
    }

    const appendXmlContent = (xmlStrings: string[], styleHeader?: boolean) => {
      xmlStrings.forEach(str => {
        const nodes = parseXmlToNodes(str, variantDoc);
        nodes.forEach(node => {
             // APPLY STYLE for Section Headers "PHẦN ..."
             if (styleHeader) {
                 const traverse = (n: Node) => {
                     if (n.nodeName === "w:t" && n.textContent && (n.textContent.match(/^PHẦN\s+[IVX]+\./i) || n.textContent.match(/TỰ\s+LUẬN/i))) {
                         if (n.parentNode && n.parentNode.nodeName === "w:r") {
                            applyRunStyle(n.parentNode as Element, { bold: true, color: "0000FF" });
                         }
                     }
                     n.childNodes.forEach(child => traverse(child));
                 }
                 traverse(node);
             }
             variantBody.appendChild(node);
        });
      });
    };
    
    if (headerConfig?.enabled) {
        // Truyền variantCode trực tiếp vào header để hiển thị chính xác
        appendXmlContent([createHeaderXml(headerConfig, variantCode)]);
        
        // Generate Footer for this specific variant (contains the specific Exam Code)
        const footerXml = createFooterXml(headerConfig.footerText || "", variantCode);
        // Important: We are writing to the shared 'zip' object for the file 'footer1.xml'
        // This works because we generate the blob at the end of this loop iteration.
        // Each iteration overwrites footer1.xml with the correct code for that variant.
        zip.file("word/footer1.xml", footerXml);
    } else {
        preambleSegments.forEach(s => appendXmlContent(s.xmlContent));
    }

    const appendQuestions = (qs: QuestionBlock[], balancedMCQKeys: string[], getNextLabel: () => number) => {
       qs.forEach((q, idx) => {
        let qNodes: Element[] = [];
        q.xmlContent.forEach(str => {
            const nodes = parseXmlToNodes(str, variantDoc);
            nodes.forEach(n => {
                if (n.nodeType === 1) qNodes.push(n as Element);
            });
        });

        if (qNodes.length > 0) {
            // Get the SECTION-relative number for display in DOCX
            const displayLabel = getNextLabel();
            replaceQuestionLabel(qNodes[0], displayLabel);
        }
        
        if (mixOptions.shuffleOptions) {
            if (q.type === QuestionType.MCQ) {
               // Use balanced key corresponding to this question's index in this section
               // We need to count indices relative to MCQ type in this block
               const targetKey = balancedMCQKeys.length > 0 ? balancedMCQKeys.shift() : 'A';
               qNodes = shuffleQuestionOptions(qNodes, q.type, targetKey);
               
               // === APPY MCQ LAYOUT FORMATTING ===
               qNodes = reformatMCQLayout(qNodes, variantDoc);

            } else if (q.type === QuestionType.TRUE_FALSE) {
               qNodes = shuffleQuestionOptions(qNodes, q.type);
            }
            // ESSAY questions don't have options to shuffle, they are just rendered
        }

        // Get Answer Key
        const ans = getAnswerFromNodes(qNodes, q.type, q.textContent);
        
        // Store answer using GLOBAL STT for Excel continuity
        variantAnswers[globalExcelStt] = ans;
        globalExcelStt++;

        qNodes.forEach(node => {
            const removeTags = (tagName: string) => {
                 const tags = Array.from(node.getElementsByTagName(tagName));
                 tags.forEach(t => t.parentNode?.removeChild(t));
            };
            removeTags("w:u");
            removeTags("w:color");
            removeTags("w:highlight");
            removeTags("w:shd");
            
            // Clean Key tags robustly
            cleanKeyTagFromParagraph(node);
        });

        qNodes.forEach(node => variantBody.appendChild(node));
       });
    };

    // Helper to shuffle questions WITHIN a section BY TYPE
    const processSectionGroup = (groupQuestions: QuestionBlock[], keepOrder: boolean = false) => {
       // RESET STT COUNTER FOR EACH SECTION
       let sectionLabelCounter = 1;
       const getNextLabel = () => sectionLabelCounter++;

       const mcqs = groupQuestions.filter(q => q.type === QuestionType.MCQ);
       const tfs = groupQuestions.filter(q => q.type === QuestionType.TRUE_FALSE);
       const sas = groupQuestions.filter(q => q.type === QuestionType.SHORT_ANSWER);
       const essays = groupQuestions.filter(q => q.type === QuestionType.ESSAY);
       const unknowns = groupQuestions.filter(q => q.type === QuestionType.UNKNOWN);

       // Shuffle logic based on mixOptions AND keepOrder override
       const doShuffle = mixOptions.shuffleQuestions && !keepOrder;

       const finalMCQs = doShuffle ? shuffleArray([...mcqs]) : [...mcqs];
       const finalTFs = doShuffle ? shuffleArray([...tfs]) : [...tfs];
       const finalSAs = doShuffle ? shuffleArray([...sas]) : [...sas];
       const finalEssays = doShuffle ? shuffleArray([...essays]) : [...essays];
       
       // Generate keys ONLY for the MCQs in this section
       const balancedKeys = mixOptions.shuffleOptions ? generateBalancedKeys(finalMCQs.length) : [];

       // Append in specific order: MCQ -> TF -> SA -> Essay -> Unknown
       appendQuestions(finalMCQs, balancedKeys, getNextLabel);
       appendQuestions(finalTFs, [], getNextLabel);
       appendQuestions(finalSAs, [], getNextLabel);
       appendQuestions(finalEssays, [], getNextLabel);
       appendQuestions(unknowns, [], getNextLabel);
    };

    // Render Part I
    if (header1Segment) appendXmlContent(header1Segment.xmlContent, true);
    processSectionGroup(p1Questions);

    // Render Part II
    if (header2Segment) appendXmlContent(header2Segment.xmlContent, true);
    processSectionGroup(p2Questions);

    // Render Part III
    if (header3Segment) appendXmlContent(header3Segment.xmlContent, true);
    processSectionGroup(p3Questions);

    // Render Part IV (Tự luận) -> FORCE NO SHUFFLE (keepOrder = true)
    if (header4Segment) appendXmlContent(header4Segment.xmlContent, true);
    processSectionGroup(p4Questions, true);

    // Render Remaining/Other
    if (otherQuestions.length > 0) {
        // If no headers existed at all, these are effectively the main body
        processSectionGroup(otherQuestions);
    }

    // === ADD "--- HẾT ---" MARKER (Centered) ===
    const endOfExamXml = `
        <w:p xmlns:w="${W_NAMESPACE}">
             <w:pPr>
                 <w:jc w:val="center"/>
                 <w:spacing w:before="240" w:after="240"/>
             </w:pPr>
             <w:r>
                 <w:rPr><w:b/></w:rPr>
                 <w:t>--- HẾT ---</w:t>
             </w:r>
        </w:p>
    `;
    appendXmlContent([endOfExamXml]);

    // Handle SectPr to include Footer Reference
    let sectPrXml = docData.finalSectPr;
    if (headerConfig?.enabled && footerRid) {
        // Construct the footerReference XML string manually to ensure correct namespaces.
        // Specifically, use OFFICE_RELATIONSHIP_NS (http://schemas.openxmlformats.org/officeDocument/2006/relationships) for r:id.
        // We define the xmlns:r locally to ensure it is valid even if the parent fragment lacks the declaration.
        const footerRefString = `<w:footerReference w:type="default" r:id="${footerRid}" xmlns:w="${W_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NS}"/>`;

        if (sectPrXml) {
            // Remove existing footer references using regex to avoid DOM parser namespace issues on fragments
            sectPrXml = sectPrXml.replace(/<w:footerReference[^>]*\/>/g, "");
            sectPrXml = sectPrXml.replace(/<w:footerReference[^>]*>.*?<\/w:footerReference>/g, "");

            // Insert new footer reference at the beginning of sectPr content
            // Handle self-closing tags: <w:sectPr ... /> -> <w:sectPr ...>content</w:sectPr>
            if (sectPrXml.includes("/>") && !sectPrXml.includes("</w:sectPr>")) {
                 sectPrXml = sectPrXml.replace("/>", `>${footerRefString}</w:sectPr>`);
            } else {
                 // Match opening tag including attributes
                 const openTagMatch = sectPrXml.match(/<w:sectPr[^>]*>/);
                 if (openTagMatch) {
                     const openTag = openTagMatch[0];
                     sectPrXml = sectPrXml.replace(openTag, `${openTag}${footerRefString}`);
                 } else {
                     // Fallback if regex fails (unlikely for valid xml)
                     sectPrXml = `<w:sectPr xmlns:w="${W_NAMESPACE}">${footerRefString}</w:sectPr>`;
                 }
            }
        } else {
            // If no sectPr exists, create one
            sectPrXml = `<w:sectPr xmlns:w="${W_NAMESPACE}">${footerRefString}</w:sectPr>`;
        }
    }

    if (sectPrXml) {
        appendXmlContent([sectPrXml]);
    }

    // Update code inside content if placeholder exists (Right Aligned enforced)
    updateExamCode(variantBody, variantCode);

    const serializer = new XMLSerializer();
    const newXmlString = serializer.serializeToString(variantDoc);
    
    zip.file("word/document.xml", newXmlString);
    const variantBlob = await zip.generateAsync({ type: "blob" });
    
    masterZip.file(`De_Tron_Ma_${variantCode}.docx`, variantBlob);
    allVariantAnswers.push({ code: variantCode, answers: variantAnswers });
  }

  const totalQuestions = questions.length;
  const excelRows = [];
  const variantCodes = allVariantAnswers.map(v => v.code).sort((a, b) => Number(a) - Number(b));

  for (let qIdx = 1; qIdx <= totalQuestions; qIdx++) {
    const row: Record<string, string | number> = { "STT": qIdx };
    variantCodes.forEach(code => {
      const variant = allVariantAnswers.find(v => v.code === code);
      if (variant) {
        row[code] = variant.answers[qIdx] || "";
      }
    });
    excelRows.push(row);
  }

  const header = ["STT", ...variantCodes];
  const ws = XLSX.utils.json_to_sheet(excelRows, { header });
  const wscols = [{wch: 5}]; 
  variantCodes.forEach(() => wscols.push({wch: 10}));
  ws['!cols'] = wscols;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "DapAn");
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  masterZip.file("Bang_Dap_An.xlsx", excelBuffer);

  const masterContent = await masterZip.generateAsync({ type: "blob" });
  saveAs(masterContent, "Ket_Qua_Tron_De.zip");

  return new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};