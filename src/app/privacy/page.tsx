import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "개인정보처리방침 | etc.",
  description: "etc. 개인정보처리방침",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="개인정보처리방침" subtitle="etc. 개인정보처리방침">
      <section>
        <h2>1. 서비스 개요</h2>
        <p>etc.는 사용자가 연결한 Google 서비스와 직접 입력하거나 업로드한 자료를 수집·분석하여 통합 검색, 분류, 일정·마감·할 일 관리를 지원합니다. 이 방침은 서비스가 처리하는 정보와 이용 목적, 보호 방법 및 이용자의 권리를 안내합니다.</p>
      </section>
      <section>
        <h2>2. 수집하는 정보</h2>
        <h3>Google 로그인 정보</h3>
        <ul>
          <li>Google 계정 식별자, 이메일 주소 및 이름·프로필 이미지 등 기본 프로필 정보</li>
          <li>로그인 세션과 사용자가 동의한 Google 연결을 유지하는 데 필요한 인증 정보</li>
        </ul>
        <h3>사용자가 명시적으로 연결한 Google 데이터</h3>
        <ul>
          <li>Gmail: 최근 메일의 제목, 본문, 발신자·수신자, 수신일 및 첨부파일 정보 등 메타데이터를 읽기 전용으로 수집합니다. 첨부파일 원본은 다운로드하지 않습니다.</li>
          <li>Google Drive: 사용자가 지정한 폴더·파일의 메타데이터와 수집 대상 Google Docs 본문을 읽기 전용으로 수집합니다.</li>
          <li>Google Calendar: 사용자가 소유한 기본 캘린더 일정의 제목, 설명, 일시 등 일정 정보를 읽기 전용으로 수집합니다.</li>
        </ul>
        <p>Google 로그인과 Google 데이터 연결은 별개의 동의 절차입니다. 데이터 수집은 사용자가 허용한 권한과 현재 지원하는 수집 범위 안에서 이루어집니다.</p>
        <h3>사용자가 직접 제공하는 정보</h3>
        <ul>
          <li>PDF, PNG·JPEG 이미지 및 직접 입력한 텍스트</li>
          <li>파일명 등 파일 정보와 파일·텍스트에서 추출한 내용</li>
          <li>자료의 분류·분석 결과, 검색에 필요한 색인 및 서비스 이용 중 입력한 검색어</li>
        </ul>
      </section>
      <section>
        <h2>3. 정보 이용 목적</h2>
        <p>수집한 정보는 자료 통합, AI 자동 분류, 검색, 할 일(Action) 생성, 마감일(Deadline) 추출, 행사·일정 관찰 정보(EventObservation) 추출, 원문 근거(Evidence) 제공 및 사용자가 요청한 서비스 기능 제공을 위해 사용됩니다.</p>
      </section>
      <section>
        <h2>4. AI 분석 및 외부 처리</h2>
        <p>AI 분석을 실행하면 Google에서 수집한 자료 또는 직접 입력·업로드한 자료의 추출 본문과 기존 분류 주제가 Google Gemini API로 전송될 수 있습니다. 이는 서비스 기능 제공을 위한 분석 처리에 사용됩니다.</p>
        <p>의미 기반 검색이 활성화된 경우, 허용된 자료의 제목·본문과 해당 검색의 검색어도 Gemini API에서 검색용 벡터로 처리될 수 있습니다. 현재 의미 기반 검색은 제한된 자료에 적용되며 전체 개인 자료에 일괄 적용되지 않습니다.</p>
        <p>Google의 입력·출력 데이터 처리에는 <a href="https://ai.google.dev/gemini-api/terms">Gemini API 이용약관</a>이 적용됩니다. 무료 서비스 조건에서는 제품·머신러닝 개선 및 사람에 의한 검토에 사용될 수 있고, 유료 서비스에는 별도의 데이터 처리 조건이 적용됩니다. 본 서비스는 모든 경우에 모델 학습에 사용되지 않는다고 보장하지 않습니다. 민감하거나 기밀인 정보는 AI 분석에 제공하지 마세요.</p>
      </section>
      <section>
        <h2>5. 저장 및 보호</h2>
        <p>Google 원본은 Google에 유지하며 서비스에는 수집한 본문, 메타데이터, 분석 결과 및 검색에 필요한 정보를 저장합니다. 직접 업로드한 원본은 비공개 저장소에 보관하고 추출 내용·분석 결과·검색 색인은 별도로 관리합니다.</p>
        <ul>
          <li>사용자별 접근 제어와 Supabase 행 수준 보안(RLS)을 통해 다른 사용자의 데이터 접근을 제한합니다.</li>
          <li>Google 데이터 연결을 위한 OAuth 토큰은 암호화하여 저장합니다.</li>
          <li>업로드 원본은 소유자 확인 후 발급하는 유효기간이 짧은 서명 URL(signed URL)로 접근합니다.</li>
        </ul>
      </section>
      <section>
        <h2>6. Google 데이터 보호 및 연결 해제</h2>
        <p>서비스는 Gmail 원본 메일, Drive 원본 파일 및 Calendar 원본 일정을 수정하거나 삭제하지 않습니다. Google 연동은 읽기 전용입니다.</p>
        <p>사용자는 설정에서 Google 연결을 해제할 수 있습니다. 연결 해제 후 신규 수집·동기화는 중단되고 서비스가 보관하는 해당 연결의 인증 토큰은 제거됩니다. 이미 수집한 자료와 분석 결과, 검색 정보, Action 및 D-Day는 유지되며 연결 해제만으로 삭제되지 않습니다. 재연결하면 지원 범위 안에서 동기화를 재개할 수 있습니다.</p>
        <p>Google API를 통한 정보 사용 및 다른 앱으로의 전송에는 <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>의 Limited Use 요구사항이 적용됩니다. 서비스는 사용자가 요청한 기능 제공에 필요한 범위에서 Google 데이터를 처리합니다.</p>
      </section>
      <section>
        <h2>7. 외부 서비스의 기술적 처리 흐름</h2>
        <ul>
          <li>Google: 계정 인증과 사용자가 동의한 Gmail·Drive·Calendar 데이터 조회</li>
          <li>Supabase: 서비스 인증, 데이터베이스 및 업로드 파일 저장</li>
          <li>Vercel: 웹 서비스와 서버 기능 실행</li>
          <li>Google Gemini API: 자료의 AI 분석 및 활성화된 의미 기반 검색 처리</li>
        </ul>
        <p>각 서비스에는 해당 기능을 수행하는 데 필요한 정보가 전달될 수 있습니다. 이 설명은 현재의 기술적 처리 흐름을 안내하며, 모든 처리를 법률상 동일한 제3자 제공 또는 처리위탁 유형으로 단정하는 것은 아닙니다.</p>
      </section>
      <section>
        <h2>8. 보관 및 삭제</h2>
        <p>서비스에 저장된 자료와 분석 결과는 기능 제공을 위해 보관됩니다. 현재 서비스 화면에서 사용자가 저장 데이터 전체를 직접 삭제하는 기능은 제공하지 않습니다. Google 연결 해제는 기존 서비스 데이터 삭제와 구분됩니다.</p>
        <p>저장된 서비스 데이터 삭제를 원하면 아래 문의 이메일로 요청해 주세요. 이용 계정 이메일과 삭제를 원하는 자료 또는 범위를 알려주시면 본인 확인 및 처리 가능 범위를 확인한 후 안내합니다. 비밀번호나 인증 토큰을 보내지 마세요. 서비스 데이터 삭제 요청은 Google 원본 삭제 요청이 아닙니다.</p>
      </section>
      <section>
        <h2>9. 이용자의 권리</h2>
        <p>이용자는 Google 연결을 해제하고, 개인정보 처리에 관해 문의하거나 서비스에 저장된 자신의 데이터 삭제를 요청할 수 있습니다. 요청 과정에서 본인 확인에 필요한 최소한의 정보를 확인할 수 있습니다.</p>
      </section>
      <section>
        <h2>10. 문의처</h2>
        <p>개인정보 관련 문의 및 서비스 저장 데이터 삭제 요청: <a href="mailto:an5194jung@gmail.com">an5194jung@gmail.com</a></p>
      </section>
      <section>
        <h2>11. 시행일 및 변경 안내</h2>
        <p>이 개인정보처리방침은 2026년 10월 8일부터 시행합니다. 정보 처리 방식이 변경되면 이 페이지와 서비스 내 안내 등을 통해 알리며, 추가 동의가 필요한 경우 별도로 안내합니다.</p>
      </section>
    </LegalDocument>
  );
}
