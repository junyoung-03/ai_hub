const messages: Record<string, string> = {
  PDF_LAYOUT_NEEDS_REVIEW: '현재 지원하지 않는 PDF 압축·구조이거나 추출된 문자가 깨져 처리를 중단했습니다. PDF를 다시 내보낸 뒤 새 파일로 올려 주세요.',
  PDF_ENCRYPTED: '암호화된 PDF는 처리할 수 없습니다. 암호화를 해제한 파일을 새로 올려 주세요.',
  PDF_UNSAFE: 'PDF에 지원하지 않는 실행 기능·첨부파일 또는 참조 구조가 포함되어 처리를 중단했습니다. 해당 기능이 없는 PDF로 다시 내보내 주세요.',
  INVALID_FILE: '파일 구조를 읽을 수 없습니다. 원본이 정상적으로 열리는지 확인하고 다시 내보낸 파일을 올려 주세요.',
  FILE_LIMIT: '파일 크기·페이지 수 또는 처리 용량 제한을 초과했습니다. 최대 5MB·PDF 10페이지 이내로 나누고 이미지 해상도를 낮춰 주세요.',
  UNSUPPORTED_FILE: 'PDF·PNG·JPG/JPEG 파일만 지원합니다. 파일 형식과 최대 5MB 제한을 확인해 주세요.',
  EMPTY_TEXT: '파일에서 읽을 수 있는 텍스트를 찾지 못했습니다. 글자가 선명한 파일로 다시 올려 주세요.',
  TEXT_LIMIT: '추출된 텍스트가 처리 한도를 초과했습니다. 파일을 나누어 올려 주세요.',
  OCR_FAILED: '문자 인식에 실패했습니다. 재시도하거나 글자가 더 선명한 파일을 선택해 주세요.',
  OCR_UNAVAILABLE: '문자 인식을 준비하지 못했습니다. 연결 상태를 확인하고 재시도해 주세요.',
  WORKER_UNAVAILABLE: '파일 추출 서비스를 사용할 수 없습니다. 잠시 후 재시도해 주세요.',
  STORAGE_UNAVAILABLE: '파일을 저장하거나 읽지 못했습니다. 연결 상태를 확인하고 재시도해 주세요.',
  PROCESSING_TIMEOUT: '파일 처리 시간이 초과되었습니다. 재시도하거나 파일을 나누어 올려 주세요.',
  UPLOAD_EXPIRED: '업로드 세션이 만료되었습니다. 새 파일 버튼을 누르고 다시 올려 주세요.',
  UPLOAD_IN_PROGRESS: '같은 파일의 업로드가 진행 중입니다. 잠시 후 재시도해 주세요.',
  UPLOAD_CANCELLED: '업로드 처리를 취소했습니다. 재시도하거나 새 파일을 선택할 수 있습니다.',
};

export function uploadErrorMessage(code?: string): string {
  return code && Object.hasOwn(messages, code)
    ? messages[code]
    : '처리를 완료하지 못했습니다. 재시도하거나 새 파일을 선택해 주세요.';
}
