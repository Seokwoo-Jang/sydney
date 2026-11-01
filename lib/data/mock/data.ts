// DEVELOPMENT-ONLY example data. Fictional year (2030–31), fictional flights
// (SB101 / SB202, "Example Air", fictional times), fictional places ("예시 …"),
// stays and amounts. Never real trip data: this file is in a public repository.
// Itinerary and Prelude text stay in Korean by the owner's decision.
import type {
  Booking,
  ChecklistItem,
  Expense,
  FileAsset,
  ItineraryCategory,
  ItineraryItem,
  ItineraryStatus,
  JournalEntry,
  Member,
  Participants,
  PreludeActivity,
  ProfileKey,
  Resource,
  ResourceLink,
  RowMeta,
  Settlement,
  TravelMode,
  Trip,
  TripDay,
  TripDocument,
} from '../../types';
import { defaultDayPhoto } from '../../url';
import type { TripSnapshot } from '../repository';

export const TRIP_ID = 'trip-example';
export const MEMBERS: Record<ProfileKey, Member> = {
  eren: { id: 'member-eren', tripId: TRIP_ID, profileKey: 'eren', displayName: 'Eren' },
  amy: { id: 'member-amy', tripId: TRIP_ID, profileKey: 'amy', displayName: 'Amy' },
};

const SYD = 'Australia/Sydney';
const SEL = 'Asia/Seoul';
const T0 = '2030-11-01T00:00:00.000Z';

const meta = (id: string, by: ProfileKey = 'eren'): RowMeta => ({
  id,
  tripId: TRIP_ID,
  createdBy: MEMBERS[by].id,
  updatedBy: MEMBERS[by].id,
  createdAt: T0,
  updatedAt: T0,
  version: 1,
  deletedAt: null,
});

// ── trip + days ──────────────────────────────────────────────────
const trip = (): Trip => ({
  id: TRIP_ID,
  title: 'Sydney, Side by Side',
  subtitle: 'A Journey, A Prelude',
  startDate: '2030-12-26',
  endDate: '2031-01-03',
  timezone: SYD,
  homeTimezone: SEL,
  displayCurrencyFirst: 'AUD',
  preludeGoal: '(예시) 도시의 공개 피아노에서 직접 연주해 보고, 다음 무대를 위한 메모를 남긴다.',
  version: 1,
});

const DAY_DEFS: Array<[date: string, title: string, highlight: string]> = [
  ['2030-12-26', 'A New Chapter', '출국 준비와 야간 항공편'],
  ['2030-12-27', 'Finding Our Rhythm', '도착 후 예시 아케이드 피아노와 여유로운 항구 산책'],
  ['2030-12-28', 'Into the Hills', '기차로 예시 산악 마을을 다녀온 뒤 예시 광장 역 피아노 방문'],
  ['2030-12-29', 'New Connections', '각자 해안 산책과 음악 탐색을 한 뒤 함께 저녁 식사'],
  ['2030-12-30', 'Notes for the Next Stage', '음악 자료 탐색·예시 동물원 방문·로드트립 준비'],
  ['2030-12-31', 'The Year’s Last Light', '예시 해안 국립공원·해안 다리·등대 마을을 거쳐 예시 만 마을로 이동'],
  ['2031-01-01', 'The First Notes of a New Year', '예시 만 마을 탐방과 선택 일정인 예시 남쪽 해변 우회'],
  ['2031-01-02', 'Moments to Keep', '예시 폭포와 예시 고원 마을을 거쳐 공항 근처로 이동'],
  ['2031-01-03', 'Until Next Time', '렌트카 반납 후 출국·인천 도착'],
];

const dayId = (n: number) => `day-${n}`;
const assetId = (n: number) => `asset-day-${n}`;

const days = (): TripDay[] =>
  DAY_DEFS.map(([date, title, highlight], i) => ({
    ...meta(dayId(i + 1)),
    date,
    dayNumber: i + 1,
    title,
    highlight,
    coverAssetId: assetId(i + 1),
    collageVariant: 0,
    defaultPhotoRemoved: false,
  }));

// ── itinerary ────────────────────────────────────────────────────
type Ev = [
  id: string,
  start: string,
  end: string,
  who: Participants,
  category: ItineraryCategory,
  title: string,
  place: string,
  notes: string,
  extra?: Partial<Pick<ItineraryItem, 'timezone' | 'endDate' | 'status' | 'bookingId' | 'travelMode'>>,
];

const T: Participants = 'together';

const EVENTS: Ev[][] = [
  [
    ['d1-airport', '15:30', '17:30', T, 'transport', '인천국제공항으로 이동', '인천국제공항', '예상 이동 시간이며 출발지와 교통편에 맞춰 조정합니다.', { timezone: SEL, travelMode: 'transit' }],
    ['d1-checkin', '17:30', '19:00', T, 'transport', '공항 도착·체크인·보안검색', '인천국제공항', '출발 3시간 전 도착을 기준으로 잡았습니다. 당일 체크인 카운터와 탑승 절차를 확인합니다.', { timezone: SEL, status: 'planned' }],
    ['d1-dinner', '19:00', '20:00', T, 'dining', '저녁 식사 후 탑승구로 이동', '인천국제공항', '항공사 탑승 마감 시간에 맞춰 이동합니다. 식당과 탑승구는 미정입니다.', { timezone: SEL }],
    ['d1-flight', '20:30', '06:45', T, 'transport', '예시 항공편 · SB101', '인천국제공항 → 예시 국제공항', '가상의 예시 항공편 SB101(현지 도착 08:45)입니다. 예약번호와 항공권 파일은 포함하지 않았습니다.', { timezone: SEL, endDate: '2030-12-27', status: 'confirmed', bookingId: 'bk-sb101' }],
  ],
  [
    ['d2-arrival', '08:45', '10:15', T, 'transport', '현지 도착', '예시 국제공항', '입국 심사와 도착 절차를 위한 여유 시간입니다. 종료 시각은 예상값입니다.', { status: 'planned' }],
    ['d2-transfer', '10:15', '11:30', T, 'transport', '시내로 이동해 숙소에 짐 맡기기', '예시 도심 · 숙소 미정', '숙소 위치가 정해지지 않은 예시라 이동 시간을 넉넉하게 잡았습니다.', { status: 'planned', travelMode: 'transit' }],
    ['d2-lunch', '12:30', '13:30', T, 'dining', '예시 아케이드 근처에서 점심 식사', '예시 아케이드', '도착일 오후는 여유 있게 보냅니다. 식당과 예약은 미정입니다.'],
    ['d2-rest', '13:30', '14:15', T, 'rest', '비행 후 잠시 휴식', '예시 도심', '관광을 시작하기 전 자유롭게 조정할 수 있는 휴식 시간입니다.'],
    ['d2-arcade', '14:30', '15:00', 'amy', 'business', '예시 아케이드 공개 피아노 연주', '예시 아케이드 · 중앙 홀', '운영 시간과 피아노 이용 가능 여부를 당일 확인하는 예시입니다.', { travelMode: 'walk' }],
    ['d2-eren', '14:30', '15:00', 'eren', 'rest', '예시 아케이드 근처에서 커피 한 잔', '예시 아케이드', 'Amy가 피아노를 둘러보는 동안 Eren이 잠시 따로 보내는 일정 예시입니다.'],
    ['d2-harbour-transfer', '15:00', '15:45', T, 'transport', '예시 항구로 이동', '예시 아케이드 → 예시 항구', '도보나 대중교통으로 이동합니다. 두 사람이 다시 만날 시간을 여유 있게 둡니다.', { travelMode: 'walk' }],
    ['d2-harbour', '16:00', '17:15', T, 'explore', '항구와 식물원 산책', '예시 항구 / 예시 식물원', '짧은 야외 산책 코스입니다. 피로도에 따라 조정합니다. 공연 관람이나 투어는 예약하지 않았습니다.', { travelMode: 'walk' }],
    ['d2-checkin', '17:15', '18:15', T, 'rest', '숙소 체크인 후 휴식', '각자 숙소 · 위치 미정', '예시 시각입니다. 숙소의 체크인 조건은 정해지지 않았습니다.'],
    ['d2-dinner', '18:30', '20:00', T, 'dining', '다시 만나 항구에서 저녁 식사', '예시 항구', '식당은 나중에 정하고 도착일에는 일찍 쉽니다.', { status: 'planned' }],
  ],
  [
    ['d3-station', '07:30', '08:00', T, 'transport', '중앙역에서 만나기', '예시 중앙역', '공휴일 운행 여부를 확인합니다. 표시한 시각은 계획용이며 실제 열차 시간표가 아닙니다.', { status: 'planned' }],
    ['d3-outbound', '08:00', '10:00', T, 'transport', '기차로 예시 산악 마을 이동', '예시 중앙역 → 예시 산악 마을', '이동 시간을 약 2시간으로 잡은 예시입니다. 출발 전 시간표를 확인합니다.', { status: 'planned', travelMode: 'transit' }],
    ['d3-lookout', '10:00', '11:15', T, 'explore', '산악 전망대에서 계곡 감상', '예시 산악 전망대', '역에서 전망대까지 이동하는 시간을 포함합니다. 날씨에 따라 코스를 조정합니다.', { travelMode: 'walk' }],
    ['d3-lunch', '11:30', '12:30', T, 'dining', '산악 마을에서 점심 식사', '예시 산악 마을', '식당과 예약은 미정입니다.'],
    ['d3-cableway', '12:45', '14:15', T, 'explore', '케이블카 타기', '예시 산악 케이블카', '입장이 가능하면 타는 유료 선택 일정입니다. 입장권은 예약하지 않았습니다.'],
    ['d3-buffer', '14:15', '15:15', T, 'rest', '잠시 쉬고 역으로 돌아가기', '예시 산악 마을', '하루 일정이 빡빡해지지 않도록 여유를 둡니다.'],
    ['d3-inbound', '15:30', '17:45', T, 'transport', '기차로 도심 복귀', '예시 산악 마을 → 예시 중앙역', '예상 복귀 시간입니다. 실제 열차에 맞춰 저녁 일정을 조정합니다.', { travelMode: 'transit' }],
    ['d3-city-transfer', '17:45', '18:20', T, 'transport', '예시 광장 역으로 이동', '예시 중앙역 → 예시 광장 역', '환승 시간을 여유 있게 둡니다.', { travelMode: 'transit' }],
    ['d3-plaza', '18:30', '18:50', 'amy', 'business', '예시 광장 역 공개 피아노 연주', '예시 광장 역 · 대합실', '산악 마을에서 돌아온 뒤 짧게 방문하는 예시입니다. 피곤하거나 혼잡하면 생략하거나 날짜를 옮깁니다.'],
    ['d3-eren', '18:30', '18:50', 'eren', 'rest', '예시 광장 근처에서 휴식', '예시 광장', 'Amy가 피아노를 확인하는 동안 가까운 곳에서 쉽니다.'],
    ['d3-dinner', '19:00', '20:00', T, 'dining', '시내에서 저녁 식사', '예시 광장 / 예시 도심', '당일치기 여행 후 가볍게 저녁을 먹습니다. 식당은 예약하지 않았습니다.'],
  ],
  [
    ['d4-beach-transfer', '08:30', '09:30', 'eren', 'transport', '예시 북쪽 해변으로 이동', '예시 도심 → 예시 북쪽 해변', '숙소 위치가 정해지면 이동 시간을 조정합니다.', { travelMode: 'transit' }],
    ['d4-amy-research', '09:00', '10:30', 'amy', 'business', '리사이틀 공간과 질문 정리', '예시 도심', '자료를 찾아보고 준비하는 자율 일정입니다. 미팅·공간 방문·연락 약속은 잡지 않았습니다.'],
    ['d4-coast', '09:30', '12:30', 'eren', 'explore', '해안 산책로 걷기', '예시 해안 산책로', '중간에 쉬어 가며 걷는 코스입니다. 날씨·더위·체력에 따라 짧게 줄입니다.', { travelMode: 'walk' }],
    ['d4-amy-transfer', '10:30', '11:15', 'amy', 'transport', '항구 광장까지 걸어가기', '예시 도심 → 예시 항구 광장', '길 찾기와 커피 한 잔을 위한 여유 시간을 포함합니다.', { travelMode: 'walk' }],
    ['d4-popup', '11:30', '12:00', 'amy', 'business', '항구 광장 팝업 피아노 연주', '예시 항구 광장', '피아노가 있으면 연주하고, 없으면 항구 산책으로 바꾼 뒤 피아노 활동 연결을 해제하는 예시입니다.'],
    ['d4-amy-lunch', '12:00', '13:00', 'amy', 'dining', '항구 광장 근처에서 점심 식사', '예시 항구 광장', '식당과 예약은 미정입니다.'],
    ['d4-eren-lunch', '12:30', '13:30', 'eren', 'dining', '해변 마을에서 점심 식사', '예시 해변 마을', '해안 산책 후 충분히 쉴 수 있도록 여유를 둡니다.'],
    ['d4-amy-rest', '13:00', '15:00', 'amy', 'rest', '쉬면서 연주 소감 메모', '예시 항구 광장', '피아노와 공개 공간에서 느낀 점을 연결된 Prelude 활동 메모에 적습니다.'],
    ['d4-eren-return', '13:30', '14:30', 'eren', 'transport', '시내로 돌아오기', '예시 해변 마을 → 예시 도심', '예상 이동 시간입니다.', { travelMode: 'transit' }],
    ['d4-eren-rest', '14:30', '16:00', 'eren', 'rest', '해안 산책 후 휴식', '숙소 · 위치 미정', '상황에 맞춰 자유롭게 조정할 수 있는 휴식 시간입니다.'],
    ['d4-amy-notes', '15:00', '16:00', 'amy', 'business', '다음 단계를 위한 참고 자료 정리', '예시 도심', '메모와 Library 링크를 정리하는 자율 일정입니다. 별도 약속은 잡지 않았습니다.'],
    ['d4-dinner', '18:30', '20:00', T, 'dining', '항구 광장에서 만나 저녁 식사', '예시 항구 광장', '다시 만날 지역만 정한 예시입니다. 식당은 나중에 고릅니다.'],
  ],
  [
    ['d5-ferry', '09:00', '10:00', 'eren', 'transport', '페리로 동물원 이동', '예시 항구 → 예시 동물원', '페리와 입구까지의 이동 시간을 잡은 예시입니다.', { travelMode: 'transit' }],
    ['d5-amy-venues', '10:00', '11:30', 'amy', 'business', '공연 공간 후보 지역 둘러보기', '예시 도심', '외부를 걸으며 둘러보는 자율 일정입니다. 공간 방문·미팅·대관은 예약하지 않았습니다.', { travelMode: 'walk' }],
    ['d5-zoo', '10:00', '13:00', 'eren', 'explore', '동물원 방문', '예시 동물원', '입장이 가능하면 방문하는 유료 선택 일정입니다. 입장권과 운영 시간을 확인합니다.'],
    ['d5-amy-lunch', '12:00', '13:00', 'amy', 'dining', '시내에서 점심 식사', '예시 도심', '나중에 대화나 미팅이 잡힐 수 있도록 오후 일정은 유연하게 둡니다.'],
    ['d5-eren-lunch', '13:00', '14:00', 'eren', 'dining', '동물원 근처에서 점심 식사', '예시 동물원 근처', '식당은 미정입니다.'],
    ['d5-return', '14:00', '15:00', 'eren', 'transport', '페리로 시내 복귀', '예시 동물원 → 예시 항구', '계획용 이동 시간이며 확정된 운항 시각이 아닙니다.', { travelMode: 'transit' }],
    ['d5-amy-notes', '14:00', '15:30', 'amy', 'business', '아이디어와 다음 할 일 정리', '예시 도심', 'Prelude 메모와 질문을 정리합니다. 네트워킹 약속은 아직 잡지 않았습니다.'],
    ['d5-eren-rest', '15:00', '16:00', 'eren', 'rest', '시내에서 잠시 휴식', '예시 도심', '미술관 운영 시간이 맞으면 방문 일정으로 바꿀 수 있습니다.'],
    ['d5-roadtrip', '17:00', '18:00', T, 'rest', '로드트립 동선과 예약 사항 확인', '예시 도심', '공원 공지·렌트카 픽업·숙소·다음 날 준비물을 확인합니다. 이 예시에서는 모두 미예약 상태입니다.'],
    ['d5-dinner', '18:00', '19:00', T, 'dining', '함께 저녁 식사', '예시 도심', '로드트립을 앞두고 일찍 저녁을 먹습니다.'],
    ['d5-packing', '19:30', '20:30', T, 'rest', '로드트립 짐 챙기기', '각자 숙소 · 위치 미정', '체크아웃을 준비하고 일찍 쉴 수 있도록 합니다.'],
  ],
  [
    ['d6-checkout', '07:30', '08:00', T, 'transport', '도심 숙소 체크아웃', '예시 도심', '숙소 위치에 맞춰 조정하는 예시입니다.'],
    ['d6-car', '08:00', '09:00', T, 'transport', '렌트카 픽업', '예시 도심 · 렌트카 업체 미정', '예약 전 예시입니다. 영업소 위치·운영 시간·운전자 정보·보험을 확인합니다.', { bookingId: 'bk-car' }],
    ['d6-park-drive', '09:00', '10:30', T, 'transport', '해안 국립공원으로 이동', '예시 도심 → 예시 해안 국립공원', '교통량을 고려해 여유를 둔 이동 시간입니다. 도로와 공원 공지를 확인합니다.', { travelMode: 'drive' }],
    ['d6-park', '10:30', '11:15', T, 'explore', '국립공원에서 짧게 산책', '예시 해안 국립공원', '공원 접근·주차·입장료를 확인합니다. 폐쇄되었거나 혼잡하면 다른 일정으로 바꿉니다.', { travelMode: 'walk' }],
    ['d6-bridge-drive', '11:15', '12:00', T, 'transport', '해안 다리로 이동', '예시 해안 국립공원 → 예시 해안 다리', '계획용 이동 시간이며 실제 경로를 측정한 값은 아닙니다.', { travelMode: 'drive' }],
    ['d6-bridge', '12:00', '12:30', T, 'explore', '해안 다리 둘러보기', '예시 해안 다리', '주차와 현장 여건이 괜찮으면 사진을 찍고 짧게 걷습니다.', { travelMode: 'walk' }],
    ['d6-lunch', '12:30', '13:15', T, 'dining', '해안가에서 점심 식사', '해안 · 식사 장소 미정', '식당은 미정입니다. 간단히 먹을 수 있는 대안도 준비합니다.', { travelMode: 'drive' }],
    ['d6-lighthouse-drive', '13:15', '14:30', T, 'transport', '등대 마을로 이동', '예시 해안 다리 → 예시 등대 마을', '교통량과 중간 휴식을 고려해 여유를 둡니다.', { travelMode: 'drive' }],
    ['d6-lighthouse', '14:30', '15:00', T, 'explore', '등대 둘러보기', '예시 등대 마을', '짧게 둘러보는 일정입니다.', { travelMode: 'walk' }],
    ['d6-bay-drive', '15:00', '16:30', T, 'transport', '만 마을로 이동', '예시 등대 마을 → 예시 만 마을', '숙소가 정해지면 위치에 맞춰 이동 시간을 조정합니다.', { travelMode: 'drive' }],
    ['d6-checkin', '16:30', '17:30', T, 'rest', '숙소 체크인 후 휴식', '예시 만 마을 · 숙소 미정', '이 예시의 숙소는 아직 예약하지 않았습니다.'],
    ['d6-dinner', '18:00', '19:00', T, 'dining', '한 해의 마지막 저녁 식사', '예시 만 마을', '식당이나 행사는 예약하지 않았습니다. 운영 여부를 확인합니다.'],
    ['d6-evening', '19:00', '20:00', T, 'explore', '조용히 저녁 해변 산책', '예시 만 마을', '여유롭게 한 해를 마무리합니다.', { travelMode: 'walk' }],
  ],
  [
    ['d7-beach', '07:30', '08:15', T, 'explore', '아침 해변 산책', '예시 만 마을 해변', '운전을 시작하기 전 해변을 짧게 둘러봅니다.', { travelMode: 'walk' }],
    ['d7-breakfast', '08:15', '09:00', T, 'dining', '아침 식사 후 체크아웃', '예시 만 마을', '공휴일 영업이 제한될 수 있으므로 간단한 아침도 준비합니다. 숙소는 미정입니다.'],
    ['d7-headland-drive', '09:00', '09:30', T, 'transport', '곶 산책로로 이동', '예시 만 마을 → 예시 곶 산책로', '출발 전 입장 안내와 폐쇄 공지를 확인합니다.', { travelMode: 'drive' }],
    ['d7-headland', '09:30', '10:30', T, 'explore', '곶 해안 짧게 산책', '예시 곶 산책로', '개방된 짧은 코스를 고릅니다.', { travelMode: 'walk' }],
    ['d7-south-drive', '10:30', '12:30', T, 'transport', '남쪽 해변으로 이동', '예시 곶 산책로 → 예시 남쪽 해변', '이동 거리가 긴 선택 일정입니다. 도로 상황·피로도·남은 시간에 따라 생략합니다.', { travelMode: 'drive' }],
    ['d7-lunch', '12:30', '13:15', T, 'dining', '피크닉 점심 식사', '예시 남쪽 해변', '음식과 물을 챙기고 공휴일 식당 휴무에 대비합니다.'],
    ['d7-wildlife', '13:15', '14:00', T, 'explore', '해변 근처 야생동물 관찰', '예시 남쪽 해변', '동물을 반드시 볼 수 있는 것은 아닙니다. 거리를 두고 관찰하며 먹이를 주지 않습니다.', { travelMode: 'walk' }],
    ['d7-valley-drive', '14:00', '17:00', T, 'transport', '계곡 마을로 이동', '예시 남쪽 해변 → 예시 계곡 마을', '중간에 쉬어 갑니다. 운전 시간이 가장 긴 날이며 도착 시각은 숙소 위치에 따라 달라집니다.', { travelMode: 'drive' }],
    ['d7-checkin', '17:00', '18:00', T, 'rest', '숙소 체크인 후 운전 피로 풀기', '예시 계곡 마을 · 숙소 미정', '숙소는 아직 예약하지 않았습니다.'],
    ['d7-dinner', '18:00', '19:00', T, 'dining', '여유롭게 새해 첫 저녁 식사', '예시 계곡 마을', '숙소 위치와 공휴일 영업 여부에 맞춰 식사 장소를 정합니다.'],
  ],
  [
    ['d8-breakfast', '08:00', '09:00', T, 'dining', '아침 식사 후 체크아웃', '예시 계곡 마을', '숙소 위치와 상황에 맞춰 출발 시각을 조정합니다.'],
    ['d8-falls-drive', '09:00', '10:15', T, 'transport', '폭포로 이동', '예시 계곡 마을 → 예시 폭포', '도로와 공원 상황을 확인합니다. 표시한 시각은 계획용 이동 시간입니다.', { travelMode: 'drive' }],
    ['d8-falls', '10:15', '11:30', T, 'explore', '폭포 감상', '예시 폭포 전망대', '전망대를 짧게 둘러봅니다. 출발 전 산책로 공지를 확인합니다.', { travelMode: 'walk' }],
    ['d8-highlands-drive', '11:30', '12:15', T, 'transport', '고원 마을로 이동', '예시 폭포 → 예시 고원 마을', '필요하면 이동 중 잠시 쉽니다.', { travelMode: 'drive' }],
    ['d8-lunch', '12:15', '13:15', T, 'dining', '고원 마을에서 점심 식사', '예시 고원 마을', '식당과 예약은 미정입니다.'],
    ['d8-highlands', '13:15', '14:00', T, 'explore', '고원 마을 가볍게 산책', '예시 고원 마을', '공항으로 돌아가기 전 잠깐 둘러보는 선택 일정입니다.', { travelMode: 'walk' }],
    ['d8-airport-drive', '14:00', '16:30', T, 'transport', '공항 근처로 이동', '예시 고원 마을 → 예시 국제공항 근처', '교통 상황과 중간 휴식을 고려해 이동 시간을 넉넉하게 잡았습니다.', { travelMode: 'drive' }],
    ['d8-checkin', '16:30', '18:00', T, 'rest', '숙소 체크인 후 짐 정리', '예시 국제공항 근처 · 숙소 미정', '숙소는 아직 예약하지 않았습니다. 공항 이동편과 렌트카 반납 방법을 확인합니다.'],
    ['d8-dinner', '18:00', '19:00', T, 'dining', '이른 저녁 식사', '예시 국제공항 근처', '마지막 저녁은 간단히 보내고 쉽니다.'],
    ['d8-prepare', '19:00', '20:00', T, 'rest', '귀국편 탑승 준비', '예시 국제공항 근처', '터미널·체크인·기내 수하물·다음 날 아침 렌트카 반납을 확인합니다.'],
  ],
  [
    ['d9-breakfast', '05:30', '06:00', T, 'dining', '아침 식사 후 체크아웃', '예시 국제공항 근처', '일찍 출발하는 예시입니다.'],
    ['d9-car-transfer', '06:00', '06:40', T, 'transport', '렌트카 반납 장소로 이동', '예시 국제공항 · 렌트카 업체 미정', '반납 장소와 영업시간 외 반납 절차를 확인합니다.', { travelMode: 'drive' }],
    ['d9-car-return', '06:40', '07:20', T, 'transport', '렌트카 반납', '예시 국제공항 · 렌트카 업체 미정', '예약 전 예시입니다. 차량 확인과 인계에 필요한 여유 시간을 포함합니다.', { bookingId: 'bk-car' }],
    ['d9-terminal-transfer', '07:20', '08:00', T, 'transport', '출국 터미널로 이동', '예시 국제공항', '반납 장소에서 셔틀을 타거나 걸어가는 시간을 고려합니다.', { travelMode: 'walk' }],
    ['d9-checkin', '08:00', '10:00', T, 'transport', '항공편 체크인·보안검색', '예시 국제공항 · 터미널 미정', '출발 3시간 전 공항 도착을 기준으로 잡았습니다.', { status: 'planned' }],
    ['d9-gate', '10:00', '10:45', T, 'rest', '탑승구 근처에서 대기', '출국 터미널', '항공사 탑승 마감 시간을 따릅니다. 탑승구와 탑승 시작 시각은 미정입니다.'],
    ['d9-flight', '11:00', '22:00', T, 'transport', '예시 항공편 · SB202', '예시 국제공항 → 인천국제공항', '가상의 예시 항공편 SB202(인천 도착 20:00)입니다. 예약번호와 항공권 파일은 포함하지 않았습니다.', { status: 'confirmed', bookingId: 'bk-sb202' }],
    ['d9-arrival', '20:00', '20:45', T, 'transport', '인천국제공항 도착', '인천국제공항', '도착 후 입국 절차를 진행합니다. 한국 현지 시각이며 도착 절차 시간은 예상값입니다.', { timezone: SEL }],
  ],
];

// Fictional route-map coordinates (plan §7.2.7). Not derived from any real route:
// each day gets a made-up anchor and its stops step along a small grid. Stops
// whose place is undecided (stays, car depots, "도심") stay off the map.
const DAY_ANCHOR: Record<number, [lat: number, lng: number]> = {
  2: [12.3, 45.6],
  3: [12.42, 45.48],
  4: [12.26, 45.66],
  5: [12.33, 45.6],
  6: [12.5, 45.8],
  7: [12.7, 45.95],
  8: [12.62, 45.7],
  9: [12.36, 45.52],
};

function exampleSpot(dayNumber: number, index: number, place: string): [number, number] | null {
  const anchor = DAY_ANCHOR[dayNumber];
  if (!anchor || place.includes('미정') || place === '예시 도심' || place.includes('인천')) return null;
  return [+(anchor[0] + (index % 4) * 0.006).toFixed(4), +(anchor[1] + Math.floor(index / 4) * 0.008).toFixed(4)];
}

const itemId = (evId: string) => `it-${evId}`;

const itinerary = (): ItineraryItem[] =>
  EVENTS.flatMap((evs, d) =>
    evs.map(([id, start, end, who, category, title, place, notes, extra = {}], i) => ({
      ...meta(itemId(id), who === 'amy' ? 'amy' : 'eren'),
      dayId: dayId(d + 1),
      date: DAY_DEFS[d][0],
      timeKind: 'timed' as const,
      startTime: start,
      endTime: end,
      endDate: extra.endDate ?? null,
      timezone: extra.timezone ?? SYD,
      category,
      status: (extra.status ?? 'idea') as ItineraryStatus,
      title,
      summary: '',
      detail: notes,
      place,
      mapUrl: null,
      mapLat: exampleSpot(d + 1, i, place)?.[0] ?? null,
      mapLng: exampleSpot(d + 1, i, place)?.[1] ?? null,
      mapSource: exampleSpot(d + 1, i, place) ? ('pin' as const) : null,
      travelMode: (extra.travelMode ?? null) as TravelMode | null,
      participants: who,
      bookingId: extra.bookingId ?? null,
      continuesFromPreviousDay: false,
      sortOrder: i * 10,
      isExample: true,
    })),
  );

// ── Amy's Prelude ────────────────────────────────────────────────
const prelude = (): PreludeActivity[] => [
  {
    ...meta('pa-arcade', 'amy'),
    kind: 'performance',
    title: '예시 아케이드 공개 피아노 연주',
    notes: '도착일 오후에 방문하는 예시입니다. 운영 시간과 당일 피아노 이용 가능 여부를 확인합니다.',
    peopleNote: '',
    status: 'idea',
    itineraryItemId: itemId('d2-arcade'),
    sortOrder: 10,
    isExample: true,
  },
  {
    ...meta('pa-plaza', 'amy'),
    kind: 'performance',
    title: '예시 광장 역 공개 피아노 연주',
    notes: '산악 마을에서 돌아온 뒤 짧게 방문하는 예시입니다. 피곤하거나 피아노를 이용할 수 없으면 생략하거나 날짜를 옮깁니다.',
    peopleNote: '',
    status: 'idea',
    itineraryItemId: itemId('d3-plaza'),
    sortOrder: 20,
    isExample: true,
  },
  {
    ...meta('pa-popup', 'amy'),
    kind: 'performance',
    title: '항구 광장 팝업 피아노 연주',
    notes: '피아노가 남아 있는지 확인하고, 없으면 항구 산책으로 바꾸는 예시입니다.',
    peopleNote: '',
    status: 'idea',
    itineraryItemId: itemId('d4-popup'),
    sortOrder: 30,
    isExample: true,
  },
];

// ── checklist ────────────────────────────────────────────────────
type Ck = [
  id: string,
  category: string,
  title: string,
  assignee: ChecklistItem['assignee'],
  checked: boolean,
  extra?: Partial<Pick<ChecklistItem, 'quantity' | 'dueDate' | 'priority' | 'notes' | 'bookingId' | 'documentId' | 'resourceIds'>>,
];

const PACKING: Ck[] = [
  ['pk-passport-eren', 'travel_essentials', 'Passport', 'eren', true],
  ['pk-passport-amy', 'travel_essentials', 'Passport', 'amy', false],
  ['pk-cards', 'travel_essentials', 'Travel card and a backup card', 'both', true],
  ['pk-phone', 'travel_essentials', 'Phone and charger', 'both', false],
  ['pk-toothbrush', 'toiletries', 'Toothbrush and toothpaste', 'both', false, { notes: 'Liquids under 100 mL each.' }],
  ['pk-sunscreen', 'toiletries', 'Sunscreen (travel size)', 'both', true, { quantity: 1 }],
  ['pk-jacket', 'everyday_items', 'Light jacket', 'eren', false],
  ['pk-powerbank', 'everyday_items', 'Power bank', 'eren', true, { quantity: 1 }],
  ['pk-adapter', 'everyday_items', 'Type I plug adapter', 'both', false, { quantity: 2 }],
  ['pk-umbrella', 'everyday_items', 'Compact umbrella', 'amy', false],
  ['pk-scores', 'music_essentials', 'Sheet music for short pieces', 'amy', false],
  ['pk-tablet', 'music_essentials', 'Tablet with scores', 'amy', true],
  ['pk-cards-amy', 'music_essentials', 'Introduction cards', 'amy', false, { quantity: 20 }],
];

const TASKS: Ck[] = [
  ['td-pax-eren', 'bookings_documents', 'Add passenger details for SB101', 'eren', false, { dueDate: '2030-12-25', priority: 'high', bookingId: 'bk-sb101' }],
  ['td-pax-amy', 'bookings_documents', 'Add passenger details for SB101', 'amy', false, { dueDate: '2030-12-25', priority: 'high', bookingId: 'bk-sb101' }],
  ['td-checkin-eren', 'bookings_documents', 'Check in for SB202', 'eren', false, { dueDate: '2031-01-02', bookingId: 'bk-sb202' }],
  ['td-checkin-amy', 'bookings_documents', 'Check in for SB202', 'amy', false, { dueDate: '2031-01-02', bookingId: 'bk-sb202' }],
  ['td-terminals', 'bookings_documents', 'Confirm terminals for SB101 and SB202', 'both', false, { dueDate: '2030-12-19' }],
  ['td-baggage', 'bookings_documents', 'Decide on checked baggage', 'both', false, { dueDate: '2030-12-14' }],
  ['td-amy-ticket', 'bookings_documents', 'Add Amy’s e-ticket and booking numbers', 'amy', false],
  ['td-eta-eren', 'bookings_documents', 'Apply for an Australian ETA', 'eren', true, { dueDate: '2030-12-12', priority: 'high', resourceIds: ['res-eta'] }],
  ['td-eta-amy', 'bookings_documents', 'Apply for an Australian ETA', 'amy', false, { dueDate: '2030-12-12', priority: 'high', resourceIds: ['res-eta'] }],
  ['td-card', 'payments_connectivity', 'Turn on overseas card payments', 'both', true],
  ['td-data', 'payments_connectivity', 'Choose a mobile data plan', 'both', false, { dueDate: '2030-12-20' }],
  ['td-home', 'before_leaving', 'Lock windows and check the gas', 'both', false, { dueDate: '2030-12-26' }],
  ['td-bio', 'music_connections', 'Polish a short English bio', 'amy', false, { dueDate: '2030-12-15' }],
  ['td-video', 'music_connections', 'Choose a performance video', 'amy', false],
  ['td-pianos', 'music_connections', 'Check the public pianos are still available', 'amy', false, { dueDate: '2030-12-19', resourceIds: ['res-popup-pianos'] }],
];

const checklist = (): ChecklistItem[] =>
  [
    ...PACKING.map((c) => ['packing', c] as const),
    ...TASKS.map((c) => ['task', c] as const),
  ].map(([kind, [id, category, title, assignee, checked, extra = {}]], i) => ({
    ...meta(id, assignee === 'amy' ? 'amy' : 'eren'),
    kind,
    category,
    title,
    assignee,
    quantity: extra.quantity ?? null,
    dueDate: extra.dueDate ?? null,
    priority: extra.priority ?? 'normal',
    checked,
    isApplicable: true,
    notes: extra.notes ?? '',
    bookingId: extra.bookingId ?? null,
    documentId: extra.documentId ?? null,
    resourceIds: extra.resourceIds ?? [],
    sortOrder: i * 10,
  }));

// ── bookings + documents ─────────────────────────────────────────
const bookings = (): Booking[] => [
  {
    ...meta('bk-sb101'),
    kind: 'flight',
    title: 'Example Air · SB101',
    status: 'booked',
    paymentStatus: 'paid',
    reference: null,
    notes: '(예시) 위탁 수하물 없음.',
    detail: {
      kind: 'flight',
      carrier: 'Example Air',
      flightNumber: 'SB101',
      from: 'ICN',
      to: 'SYD',
      departDate: '2030-12-26',
      departTime: '20:30',
      departTimezone: SEL,
      arriveDate: '2030-12-27',
      arriveTime: '08:45',
      arriveTimezone: SYD,
      departTerminal: 'T1',
      checkInBy: { date: '2030-12-26', time: '17:30', timezone: SEL },
      passengers: [{ memberId: MEMBERS.eren.id }, { memberId: MEMBERS.amy.id }],
    },
  },
  {
    ...meta('bk-sb202'),
    kind: 'flight',
    title: 'Example Air · SB202',
    status: 'booked',
    paymentStatus: 'paid',
    reference: null,
    notes: '',
    detail: {
      kind: 'flight',
      carrier: 'Example Air',
      flightNumber: 'SB202',
      from: 'SYD',
      to: 'ICN',
      departDate: '2031-01-03',
      departTime: '11:00',
      departTimezone: SYD,
      arriveDate: '2031-01-03',
      arriveTime: '20:00',
      arriveTimezone: SEL,
      arriveTerminal: 'T1',
      checkInBy: { date: '2031-01-03', time: '08:00', timezone: SYD },
      passengers: [{ memberId: MEMBERS.eren.id }, { memberId: MEMBERS.amy.id }],
    },
  },
  {
    ...meta('bk-stay-a'),
    kind: 'stay',
    title: '예시 숙소 A',
    status: 'considering',
    paymentStatus: 'unpaid',
    reference: null,
    notes: '(예시) 도심 후보.',
    detail: { kind: 'stay', name: '예시 숙소 A', checkInDate: '2030-12-27', checkOutDate: '2030-12-31', guests: 'eren' },
  },
  {
    ...meta('bk-stay-b', 'amy'),
    kind: 'stay',
    title: '예시 숙소 B',
    status: 'considering',
    paymentStatus: 'unpaid',
    reference: null,
    notes: '(예시) 아케이드 근처 후보.',
    detail: { kind: 'stay', name: '예시 숙소 B', checkInDate: '2030-12-27', checkOutDate: '2030-12-31', guests: 'amy' },
  },
  {
    ...meta('bk-car'),
    kind: 'car',
    title: '예시 렌터카',
    status: 'considering',
    paymentStatus: 'unpaid',
    reference: null,
    notes: '(예시) 운전자 정보와 보험을 확인합니다.',
    detail: {
      kind: 'car',
      company: '예시 렌터카',
      pickUp: { date: '2030-12-31', time: '08:00', place: '예시 도심 · 영업소 미정' },
      dropOff: { date: '2031-01-03', time: '06:40', place: '예시 국제공항' },
    },
  },
];

const documents = (): TripDocument[] => [
  {
    ...meta('doc-eticket'),
    title: 'Flight e-ticket · Example Air',
    subjectMemberId: MEMBERS.eren.id,
    status: 'ready',
    expiryOrDueDate: null,
    assetId: null,
    referenceUrl: null,
  },
  {
    ...meta('doc-eta-amy', 'amy'),
    title: 'Australian ETA approval',
    subjectMemberId: MEMBERS.amy.id,
    status: 'in_progress',
    expiryOrDueDate: '2030-12-12',
    assetId: null,
    referenceUrl: null,
  },
];

// ── budget ───────────────────────────────────────────────────────
type Ex = Omit<Expense, keyof RowMeta>;
const expense = (id: string, by: ProfileKey, e: Partial<Ex> & Pick<Ex, 'date' | 'status' | 'title' | 'amountMinor' | 'currency' | 'category'>): Expense => ({
  ...meta(id, by),
  kind: 'expense',
  payerId: MEMBERS[by].id,
  splitMode: 'equal',
  splitEren: Math.ceil(e.amountMinor / 2),
  splitAmy: Math.floor(e.amountMinor / 2),
  budgetScope: 'shared',
  fxRate: null,
  fxRateDate: null,
  fxLocked: false,
  fxManual: false,
  krwChargedMinor: null,
  bookingIds: [],
  itineraryItemIds: [],
  refundOfId: null,
  ...e,
});

const expenses = (): Expense[] => [
  expense('ex-flights', 'eren', {
    date: '2030-10-31',
    status: 'paid',
    title: 'Flights · Example Air',
    amountMinor: 111111,
    currency: 'AUD',
    category: 'flights',
    fxRate: 905.1,
    fxRateDate: '2030-10-31',
    fxLocked: true,
    bookingIds: ['bk-sb101', 'bk-sb202'],
  }),
  expense('ex-stay-a', 'eren', {
    date: '2030-12-27',
    status: 'planned',
    title: 'Stay · 예시 숙소 A',
    amountMinor: 88888,
    currency: 'AUD',
    category: 'stays',
    splitMode: 'eren',
    splitEren: 88888,
    splitAmy: 0,
    budgetScope: 'eren',
    bookingIds: ['bk-stay-a'],
  }),
  expense('ex-stay-b', 'amy', {
    date: '2030-12-27',
    status: 'planned',
    title: 'Stay · 예시 숙소 B',
    amountMinor: 88888,
    currency: 'AUD',
    category: 'stays',
    splitMode: 'amy',
    splitEren: 0,
    splitAmy: 88888,
    budgetScope: 'amy',
    bookingIds: ['bk-stay-b'],
  }),
  expense('ex-car', 'eren', {
    date: '2030-12-31',
    status: 'planned',
    title: 'Car hire · 예시 렌터카',
    amountMinor: 33333,
    currency: 'AUD',
    category: 'transport',
    bookingIds: ['bk-car'],
    itineraryItemIds: [itemId('d6-car'), itemId('d9-car-return')],
  }),
  expense('ex-nye', 'amy', {
    date: '2030-12-31',
    status: 'planned',
    title: 'New Year’s Eve dinner',
    amountMinor: 22222,
    currency: 'AUD',
    category: 'food',
    itineraryItemIds: [itemId('d6-dinner')],
  }),
  expense('ex-esim', 'amy', {
    date: '2030-11-20',
    status: 'paid',
    title: 'eSIM data plan',
    amountMinor: 33333,
    currency: 'KRW',
    category: 'other',
    splitMode: 'amy',
    splitEren: 0,
    splitAmy: 33333,
    budgetScope: 'amy',
    fxRate: 910,
    fxRateDate: '2030-11-20',
    fxLocked: true,
  }),
];

const settlements = (): Settlement[] => [
  {
    ...meta('st-1', 'amy'),
    fromMember: MEMBERS.amy.id,
    toMember: MEMBERS.eren.id,
    amountMinor: 11111,
    currency: 'AUD',
    date: '2030-11-21',
    fxRate: 910,
    note: '(예시) 항공권 일부 정산',
  },
];

// ── library ──────────────────────────────────────────────────────
type Rs = [id: string, title: string, url: string, category: Resource['category'], note: string, pinned: number | null];
const RESOURCES: Rs[] = [
  ['res-trip-planner', 'Transport for NSW trip planner', 'https://transportnsw.info/trip', 'maps_transport', '기차·페리 시간표 확인용.', 1],
  ['res-plaza-piano', 'Example Plaza station piano', 'https://example.com/plaza-piano', 'music_connections', '(예시) 광장 역 공개 피아노 안내.', 2],
  ['res-eta', 'Australian ETA (subclass 601)', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601', 'booking_guides', '공식 안내. 각자 앱으로 신청.', 3],
  ['res-weather', 'Sydney forecast · Bureau of Meteorology', 'https://www.bom.gov.au/nsw/forecasts/sydney.shtml', 'other', '출발 전날 확인.', 4],
  ['res-arcade', 'Example Arcade map and hours', 'https://example.com/arcade', 'places_dining', '(예시) 피아노 위치와 운영 시간.', null],
  ['res-popup-pianos', 'Example pop-up piano list', 'https://example.com/popup-pianos', 'music_connections', '(예시) 항구 광장 팝업 피아노 여부 재확인.', null],
];

const resources = (): Resource[] =>
  RESOURCES.map(([id, title, url, category, note, pinned]) => ({
    ...meta(id),
    title,
    url,
    category,
    note,
    pinnedOrder: pinned,
  }));

const resourceLinks = (): ResourceLink[] => [
  { id: 'rl-arcade', tripId: TRIP_ID, resourceId: 'res-arcade', itineraryItemId: null, preludeActivityId: 'pa-arcade', documentId: null },
  { id: 'rl-plaza', tripId: TRIP_ID, resourceId: 'res-plaza-piano', itineraryItemId: null, preludeActivityId: 'pa-plaza', documentId: null },
  { id: 'rl-popup', tripId: TRIP_ID, resourceId: 'res-popup-pianos', itineraryItemId: null, preludeActivityId: 'pa-popup', documentId: null },
  { id: 'rl-d3-train', tripId: TRIP_ID, resourceId: 'res-trip-planner', itineraryItemId: itemId('d3-outbound'), preludeActivityId: null, documentId: null },
];

// ── journal + photos ─────────────────────────────────────────────
// Each day's own photo carries the filer's "No photos yet." (as the server writes it);
// Day 1 and Day 2 show a comment each from both of us instead.
const journal = (): JournalEntry[] => [
  { ...meta('jn-d1-eren'), dayId: dayId(1), authorId: MEMBERS.eren.id, assetId: assetId(1), body: '(예시) 공항 가는 길. 짐은 가볍게, 마음은 설레게.' },
  { ...meta('jn-d1-amy', 'amy'), dayId: dayId(1), authorId: MEMBERS.amy.id, assetId: assetId(1), body: '(예시) 출발 전에 같이 마신 커피가 제일 기억에 남는다.' },
  { ...meta('jn-d2-amy', 'amy'), dayId: dayId(2), authorId: MEMBERS.amy.id, assetId: assetId(2), body: '(예시) 아케이드 피아노 소리가 생각보다 따뜻했다. 다음에는 조금 더 긴 곡을 준비하고 싶다.' },
  ...DAY_DEFS.slice(2).map((_, i) => ({
    ...meta(`jn-d${i + 3}-default`),
    dayId: dayId(i + 3),
    authorId: MEMBERS.eren.id,
    assetId: assetId(i + 3),
    body: 'No photos yet.',
  })),
];

const assets = (): FileAsset[] =>
  DAY_DEFS.map((_, i) => {
    const n = i + 1;
    const photo = defaultDayPhoto(n);
    return {
      ...meta(assetId(n)),
      storagePath: `example/nine-notes/day-${n}.webp`,
      displayPath: null,
      thumbPath: null,
      width: photo.width,
      height: photo.height,
      focalX: 0.5,
      focalY: 0.4,
      zoom: 1,
      mime: 'image/webp',
      bytes: 0,
      kind: 'photo' as const,
      isDefault: true,
      dayId: dayId(n),
      bookingId: null,
      documentId: null,
      caption: '',
      sortOrder: 0,
      url: photo.src,
      thumbUrl: photo.thumb,
    };
  });

// ── snapshots ────────────────────────────────────────────────────
export function createSeed(): TripSnapshot {
  return {
    trip: trip(),
    members: [MEMBERS.eren, MEMBERS.amy],
    budgets: [
      { tripId: TRIP_ID, scope: 'shared', amountMinor: 555500, currency: 'AUD' },
      { tripId: TRIP_ID, scope: 'eren', amountMinor: 1111000, currency: 'KRW' },
      { tripId: TRIP_ID, scope: 'amy', amountMinor: 1111000, currency: 'KRW' },
    ],
    fxRates: [
      { rateDate: '2030-12-20', base: 'AUD', quote: 'KRW', rate: 912.4, source: 'ECB' },
      { rateDate: '2030-11-20', base: 'AUD', quote: 'KRW', rate: 910, source: 'ECB' },
      { rateDate: '2030-10-31', base: 'AUD', quote: 'KRW', rate: 905.1, source: 'ECB' },
    ],
    resourceLinks: resourceLinks(),
    days: days(),
    itinerary: itinerary(),
    prelude: prelude(),
    checklist: checklist(),
    bookings: bookings(),
    documents: documents(),
    expenses: expenses(),
    settlements: settlements(),
    journal: journal(),
    resources: resources(),
    assets: assets(),
  };
}

/** `?mockState=empty`: the trip and its nine days exist, nothing else does. */
export function createEmptySeed(): TripSnapshot {
  const seed = createSeed();
  return {
    ...seed,
    trip: { ...seed.trip, preludeGoal: '' },
    budgets: [],
    resourceLinks: [],
    days: seed.days.map((d) => ({ ...d, coverAssetId: null })),
    itinerary: [],
    prelude: [],
    checklist: [],
    bookings: [],
    documents: [],
    expenses: [],
    settlements: [],
    journal: [],
    resources: [],
    assets: [],
  };
}
