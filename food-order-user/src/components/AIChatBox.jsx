import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';

const trimHistory = (messages) =>
  messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 1200) }));

export default function AIChatBox({ apiUrl, mode = 'user', token = '', userContext = null }) {
  const isAdminMode = mode === 'admin';
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [trainingMode, setTrainingMode] = useState(false);
  const [teachTarget, setTeachTarget] = useState(null);
  const [correction, setCorrection] = useState('');
  const [showQuestionList, setShowQuestionList] = useState(false);
  const [openQuestionGroup, setOpenQuestionGroup] = useState(null);
  const [messages, setMessages] = useState(() => [
    {
      role: 'assistant',
      content: isAdminMode
        ? 'Xin chào, mình là Chatbot. Bạn có thể hỏi về order, khách hàng, món bán chạy, báo cáo, trạng thái món, ghi chú món ăn hoặc training kiến thức mới.'
        : 'Xin chào, mình là Chatbot hỗ trợ menu. Bạn có thể hỏi gợi ý món, sở thích khách, món bán chạy hoặc ghi chú món ăn.'
    }
  ]);

  const bodyRef = useRef(null);

  const headers = useMemo(() => {
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const scrollBottom = () => {
    setTimeout(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, 50);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    scrollBottom();

    try {
      if (trainingMode && isAdminMode) {
        const r = await axios.post(
          apiUrl('/api/local-ai/train'),
          { content: text, source: 'chatbox-admin' },
          { headers }
        );
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: r.data?.message || 'Đã lưu training cho Chatbot.' }
        ]);
      } else {
const r = await axios.post(
  apiUrl('/api/local-ai/chat'),
  {
    message: text,
    mode,
    history: trimHistory([...messages, userMsg]),
    context: {
  ...(userContext || {}),
  lastUserQuestion: text,
  lastChatMessages: trimHistory([...messages, userMsg]),
}
  },
  { headers }
);
const answer = r.data?.answer || 'Chatbot chưa có câu trả lời.';
setMessages((prev) => [
  ...prev,
  { role: 'assistant', content: answer, question: text }
]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Chatbot lỗi: ' +
            (e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Không gọi được Chatbot')
        }
      ]);
    } finally {
      setLoading(false);
      scrollBottom();
    }
  };
const sendCorrection = async () => {
  const text = correction.trim();
  if (!teachTarget || !text || loading) return;

  setLoading(true);
  try {
    const r = await axios.post(
      apiUrl('/api/local-ai/feedback'),
      {
        question: teachTarget.question,
        answer: teachTarget.answer,
        correction: text,
        mode,
      },
      { headers }
    );

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: `Dạy lại: ${text}` },
      { role: 'assistant', content: r.data?.message || 'Đã ghi nhận góp ý dạy lại.' }
    ]);
    setTeachTarget(null);
    setCorrection('');
  } catch (e) {
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: 'Không lưu được góp ý: ' +
          (e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Lỗi không xác định')
      }
    ]);
  } finally {
    setLoading(false);
    scrollBottom();
  }
};
const askQuick = (text) => {
  setInput(text);
  setOpen(true);
  setShowQuestionList(false);
  setOpenQuestionGroup(null);
};

  const bubbleBtnStyle = {
    position: 'fixed',
    right: 18,
    bottom: 60,
    zIndex: 20000,
    width: 58,
    height: 58,
    borderRadius: '50%',
    border: 'none',
    background: '#111827',
    color: '#fff',
    boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
    cursor: 'pointer',
    fontWeight: 800,
    fontSize: 18
  };

const questionGroups = [
  {
    title: 'Khách hàng',
    items: [
      'Khách hàng - 1 hay ăn gì?',
      'Khách hàng - 1 hay uống gì?',
      'Khách hàng - 1 thích ăn gì?',
      'Khách hàng - 1 thường order món gì?',
      'Khách hàng - 1 đã order bao nhiêu lần trong 30 ngày qua?',
      'Khách hàng - 1 lần gần nhất order khi nào?',
      'Khách hàng - 1 đã order những gì hôm nay?',
      'Khách hàng - 1 trong 30 ngày qua đã order những gì?',
      'Khách hàng - 1 từng ăn cơm chiên chưa?',
      'Khách hàng - 1 có uống avocado smoothie chưa?',
      'Khách hàng - 1 hay order lúc mấy giờ?',
      'Khách hàng - 1 hay ghi chú gì?',
      'Khách hàng - 1 không thích gì?',
      'Gợi ý món cho khách hàng - 1',
      'Gợi ý món theo ghi chú khách hàng - 1',
    ],
  },
  {
    title: 'Order theo ngày/giờ',
    items: [
      'Order ngày/giờ - khách hàng - 1 khoảng 12h ngày 12/05/2026 đã order gì?',
      'Order ngày/giờ - khách hàng - 1 khoảng 3h ngày 13/05/2026 đã order gì?',
      'Order ngày/giờ - khách hàng - 1 khoảng 12h hôm nay đã order gì?',
      'Order ngày/giờ - 03/05/2026 15:32 khách hàng - 1 đã order gì?',
      'Order ngày/giờ - ngày 12/05/2026 khách hàng - 1 đã order gì?',
      'Order ngày/giờ - khách hàng - 1 hôm nay có order không?',
      'Order ngày/giờ - khách hàng - 1 hôm qua có order không?',
      'Order ngày/giờ - khách hàng - 1 trong 7 ngày qua đã order những gì?',
      'Order ngày/giờ - khách hàng - 1 trong 1 năm qua đã order những gì?',
    ],
  },
  {
    title: 'Bàn / khu vực',
    items: [
      'Bàn/khu vực - bàn 1001 hôm nay có order chưa?',
      'Bàn/khu vực - bàn 1001 hôm nay gọi món gì?',
      'Bàn/khu vực - bàn 104 hôm nay có ai order chưa?',
      'Bàn/khu vực - hôm nay bàn nào chưa order?',
      'Bàn/khu vực - hôm nay có bao nhiêu bàn đã order?',
      'Bàn/khu vực - danh sách bàn đã order hôm nay',
      'Bàn/khu vực - danh sách bàn chưa order hôm nay',
    ],
  },
  {
    title: 'Món ăn / menu',
    items: [
      'Món ăn/menu - Top món hôm nay',
      'Món ăn/menu - Món nào đang được order nhiều hôm nay?',
      'Món ăn/menu - Gợi ý món bán chạy hôm nay',
      'Món ăn/menu - Món nào đang Sold Out?',
      'Món ăn/menu - Ghi chú hay gặp hôm nay',
      'Món ăn/menu - Món nào hot trong 7 ngày qua?',
      'Món ăn/menu - Khách nào order món KIMBAP nhiều nhất?',
    ],
  },
  {
    title: 'Thông tin app',
    items: [
      'Chatbot làm được gì?',
      'Có thể hỏi gì?',
      'Cách sử dụng app như nào?',
      'App này là gì?',
    ],
  },
];

const adminQuestionGroups = [
  ...questionGroups,
  {
    title: 'Admin / báo cáo',
    items: [
      'Admin/báo cáo - Top khách order nhiều nhất 7 ngày qua',
      'Admin/báo cáo - Top khách order nhiều trong 30 ngày qua',
      'Admin/báo cáo - Danh sách khách đã order hôm nay',
      'Admin/báo cáo - Tổng số khách đã order hôm nay',
      'Admin/báo cáo - Tóm tắt doanh thu hôm nay',
      'Admin/báo cáo - Tóm tắt doanh thu 30 ngày qua',
    ],
  },
];

const visibleQuestionGroups = isAdminMode ? adminQuestionGroups : questionGroups;

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} style={bubbleBtnStyle} title="Food Assistant">
          J
        </button>
      )}

      {open && (
        <div
          style={{
            position: 'fixed',
            right: 18,
            bottom: 60,
            zIndex: 20000,
            width: 380,
            maxWidth: 'calc(100vw - 36px)',
            height: 560,
            maxHeight: 'calc(100vh - 36px)',
            background: '#fff',
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 18px 60px rgba(0,0,0,0.35)',
            border: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div
            style={{
              padding: '12px 14px',
              background: '#111827',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div>
              <div style={{ fontWeight: 800 }}>{isAdminMode ? 'Food Assistant Admin' : 'Food Assistant'}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>
                {isAdminMode ? 'JACK' : 'JACK'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ background: 'transparent', color: '#fff', border: 'none', fontSize: 22, cursor: 'pointer' }}
            >
              ×
            </button>
          </div>

          {isAdminMode && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151' }}>
                <input
                  type="checkbox"
                  checked={trainingMode}
                  onChange={(e) => setTrainingMode(e.target.checked)}
                />
                Training mode: nội dung gửi sẽ được lưu vào data/ai-training.json
              </label>
            </div>
          )}

          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#f3f4f6' }}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 8
                }}
              >
                <div
                  style={{
                    maxWidth: '86%',
                    whiteSpace: 'pre-wrap',
                    fontSize: 13,
                    lineHeight: 1.45,
                    background: m.role === 'user' ? '#2563eb' : '#fff',
                    color: m.role === 'user' ? '#fff' : '#111827',
                    padding: '9px 11px',
                    borderRadius: 14,
                    border: m.role === 'user' ? 'none' : '1px solid #e5e7eb'
                  }}
                >
                  {m.content}
{m.role === 'assistant' && m.question && (
  <div style={{ marginTop: 8 }}>
    <button
      type="button"
      onClick={() => {
        setTeachTarget({ question: m.question, answer: m.content });
        setCorrection('');
      }}
      style={{
        border: '1px solid #d1d5db',
        background: '#f9fafb',
        borderRadius: 999,
        padding: '4px 8px',
        fontSize: 11,
        cursor: 'pointer'
      }}
    >
      Dạy lại
    </button>
  </div>
)}
                </div>
              </div>
            ))}
            {loading && <div style={{ fontSize: 12, color: '#6b7280' }}>Trợ lý đang trả lời…</div>}
          </div>

          <div style={{ padding: '8px 10px', borderTop: '1px solid #e5e7eb', background: '#fff' }}>
<div style={{ paddingBottom: 8 }}>
<button
  type="button"
  onClick={() => {
    setShowQuestionList((v) => !v);
    setOpenQuestionGroup(null);
  }}
    style={{
      width: '100%',
      border: '1px solid #d1d5db',
      background: showQuestionList ? '#eef2ff' : '#fff',
      color: '#111827',
      borderRadius: 10,
      padding: '8px 10px',
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}
  >
    <span>📋 Xem các câu hỏi Chatbot có thể trả lời</span>
    <span>{showQuestionList ? '▲' : '▼'}</span>
  </button>

  {showQuestionList && (
    <div
      style={{
        marginTop: 8,
        maxHeight: 230,
        overflowY: 'auto',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        background: '#f9fafb',
        padding: 8
      }}
    >
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, lineHeight: 1.35 }}>
        Bấm câu mẫu để đưa vào ô nhập, sau đó chỉ cần đổi số <b>1</b> thành mã khách hoặc đổi số bàn/ngày/giờ rồi bấm Gửi.
      </div>
{visibleQuestionGroups.map((group) => {
  const isGroupOpen = openQuestionGroup === group.title;

  return (
    <div key={group.title} style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() =>
          setOpenQuestionGroup((cur) =>
            cur === group.title ? null : group.title
          )
        }
        style={{
          width: '100%',
          border: '1px solid #e5e7eb',
          background: isGroupOpen ? '#eef2ff' : '#fff',
          borderRadius: 10,
          padding: '8px 10px',
          fontSize: 12,
          fontWeight: 800,
          color: '#374151',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left'
        }}
      >
        <span>{group.title}</span>
        <span>{isGroupOpen ? '▲' : '▼'}</span>
      </button>

      {isGroupOpen && (
        <div
          style={{
            display: 'grid',
            gap: 6,
            marginTop: 6,
            paddingLeft: 6,
            paddingRight: 2
          }}
        >
          {group.items.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => askQuick(q)}
              style={{
                width: '100%',
                textAlign: 'left',
                border: '1px solid #e5e7eb',
                background: '#fff',
                borderRadius: 9,
                padding: '7px 8px',
                fontSize: 12,
                color: '#111827',
                cursor: 'pointer',
                lineHeight: 1.35
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
})}
    </div>
  )}
</div>
{teachTarget && (
  <div style={{ marginBottom: 8, padding: 8, border: '1px solid #f59e0b', borderRadius: 10, background: '#fffbeb' }}>
    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
      Dạy lại câu này
    </div>
    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
      Câu hỏi: {teachTarget.question}
    </div>
    <textarea
      value={correction}
      onChange={(e) => setCorrection(e.target.value)}
      placeholder={'Ví dụ: Câu "có gọi gì không" nghĩa là kiểm tra khách có order gì không.'}
      style={{
        width: '100%',
        minHeight: 55,
        resize: 'vertical',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        padding: 7,
        fontSize: 12,
        outline: 'none'
      }}
    />
    <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
      <button type="button" onClick={() => setTeachTarget(null)} style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, padding: '5px 8px', cursor: 'pointer' }}>
        Hủy
      </button>
      <button type="button" onClick={sendCorrection} disabled={!correction.trim() || loading} style={{ border: 'none', background: '#f59e0b', color: '#fff', borderRadius: 8, padding: '5px 10px', fontWeight: 700, cursor: 'pointer' }}>
        Lưu góp ý
      </button>
    </div>
  </div>
)}
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={trainingMode ? 'Nhập kiến thức muốn training cho Chatbot...' : 'Nhập câu hỏi cho Chatbot...'}
                style={{
                  flex: 1,
                  minHeight: 42,
                  maxHeight: 90,
                  resize: 'vertical',
                  border: '1px solid #d1d5db',
                  borderRadius: 10,
                  padding: 8,
                  fontSize: 13,
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                style={{
                  width: 66,
                  border: 'none',
                  borderRadius: 10,
                  background: loading || !input.trim() ? '#9ca3af' : '#10b981',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: loading || !input.trim() ? 'not-allowed' : 'pointer'
                }}
              >
                Gửi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
