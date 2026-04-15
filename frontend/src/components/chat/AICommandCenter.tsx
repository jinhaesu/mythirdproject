'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Minimize2, Maximize2 } from 'lucide-react';
import { useAppStore } from '@/store';
import api from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const META_SUGGESTIONS = [
  '이번 달 캠페인 전략 추천해줘',
  'CTR 개선 방법 알려줘',
  '인스타 릴스 광고 카피 써줘',
];

const NAVER_SUGGESTIONS = [
  '검색광고 키워드 추천해줘',
  'CPC 낮추는 방법 알려줘',
  'GFA 배너 소재 전략 추천해줘',
];

const META_GREETING = '안녕하세요! Meta-Commander AI 어시스턴트입니다.\n\n시장 분석, 소재 제작, 캠페인 기획, 광고 집행, 성과 분석 등 무엇이든 도와드리겠습니다.\n\n어떤 도움이 필요하신가요?';
const NAVER_GREETING = '안녕하세요! 네이버 커맨더 AI 어시스턴트입니다.\n\n검색광고 키워드 관리, GFA 캠페인 운영, 입찰가 최적화, 성과 분석 등 무엇이든 도와드리겠습니다.\n\n어떤 도움이 필요하신가요?';

export function AICommandCenter() {
  const { activePlatform } = useAppStore();
  const isNaver = activePlatform === 'naver';

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: META_GREETING },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(META_SUGGESTIONS);
  const [lastPlatform, setLastPlatform] = useState(activePlatform);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset chat when platform switches
  useEffect(() => {
    if (activePlatform !== lastPlatform) {
      setLastPlatform(activePlatform);
      setMessages([
        { role: 'assistant', content: activePlatform === 'naver' ? NAVER_GREETING : META_GREETING },
      ]);
      setSuggestedQuestions(activePlatform === 'naver' ? NAVER_SUGGESTIONS : META_SUGGESTIONS);
    }
  }, [activePlatform, lastPlatform]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async (text?: string) => {
    const userMessage = (text || input).trim();
    if (!userMessage || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const platformContext = isNaver
        ? '[네이버 광고 플랫폼 컨텍스트] 사용자는 현재 네이버 검색광고/GFA를 관리하고 있습니다. '
        : '';
      const { data } = await api.post('/ai/chat', {
        message: platformContext + userMessage,
        history: messages.filter((m) => m.role !== 'assistant' || messages.indexOf(m) !== 0).slice(-20),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);

      if (data.suggested_questions && data.suggested_questions.length > 0) {
        setSuggestedQuestions(data.suggested_questions);
      }
    } catch (err: any) {
      const errorMsg = err?.response?.data?.detail || 'AI 응답을 받지 못했습니다. 다시 시도해주세요.';
      setMessages((prev) => [...prev, { role: 'assistant', content: `오류: ${errorMsg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Color scheme
  const fabGradient = isNaver
    ? 'bg-gradient-to-r from-green-500 to-green-600'
    : 'bg-gradient-to-r from-primary-600 to-purple-600';
  const headerGradient = isNaver
    ? 'bg-gradient-to-r from-green-600 to-green-700'
    : 'bg-gradient-to-r from-primary-600 to-purple-600';
  const userBubble = isNaver ? 'bg-[#27A644] text-white' : 'bg-[#5E6AD2] text-white';
  const sendBtnClass = isNaver
    ? 'bg-[#27A644] hover:bg-green-700'
    : 'bg-[#5E6AD2] hover:bg-[#828FFF]';
  const focusRing = isNaver
    ? 'focus:ring-green-500 focus:border-[#27A644]'
    : 'focus:ring-[#5E6AD2] focus:border-[#5E6AD2]';
  const suggestHover = isNaver
    ? 'hover:bg-[#27A644]/10 hover:border-[#27A644]/30 hover:text-[#27A644]'
    : 'hover:bg-[#5E6AD2]/10 hover:border-[#5E6AD2]/30 hover:text-[#828FFF]';

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 w-14 h-14 ${fabGradient} text-white rounded-full shadow-[0px_7px_32px_rgba(0,0,0,0.35)] hover:shadow-[0px_7px_32px_rgba(0,0,0,0.35)] transition-all hover:scale-105 flex items-center justify-center z-50`}
        title="AI 어시스턴트"
      >
        <MessageSquare size={24} />
      </button>
    );
  }

  const chatWidth = isExpanded ? 'w-[600px]' : 'w-[380px]';
  const chatHeight = isExpanded ? 'h-[700px]' : 'h-[520px]';

  return (
    <div className={`fixed bottom-6 right-6 ${chatWidth} ${chatHeight} bg-[#0F1011] rounded-2xl shadow-2xl flex flex-col z-50 border border-[#23252A] transition-all`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 ${headerGradient} rounded-t-2xl`}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#0F1011]/20 rounded-lg flex items-center justify-center">
            <MessageSquare size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">
              {isNaver ? '네이버 AI 어시스턴트' : 'AI Command Center'}
            </h3>
            <p className="text-white/70 text-xs">
              {isNaver ? '검색광고 · GFA 마케팅 AI' : '마케팅 AI 어시스턴트'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 text-white/70 hover:text-white transition-colors">
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button onClick={() => setIsOpen(false)} className="p-1.5 text-white/70 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
              msg.role === 'user'
                ? `${userBubble} rounded-br-md`
                : 'bg-[#141516] text-[#F7F8F8] rounded-bl-md'
            }`}>
              {msg.content.split('\n').map((line, j) => (
                <span key={j}>
                  {line}
                  {j < msg.content.split('\n').length - 1 && <br />}
                </span>
              ))}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#141516] px-4 py-3 rounded-2xl rounded-bl-md">
              <div className="flex items-center gap-2 text-[#8A8F98] text-sm">
                <Loader2 size={14} className="animate-spin" />
                생각하는 중...
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested questions */}
      {!loading && suggestedQuestions.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {suggestedQuestions.map((q, i) => (
              <button key={i} onClick={() => sendMessage(q)}
                className={`px-2.5 py-1 bg-[#08090A] border border-[#23252A] rounded-full text-xs text-[#8A8F98] ${suggestHover} transition-colors`}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-[#23252A]">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요... (Shift+Enter: 줄바꿈)"
            rows={1}
            className={`flex-1 px-3 py-2 border border-[#23252A] rounded-xl text-sm resize-none ${focusRing} outline-none max-h-24`}
            style={{ minHeight: '40px' }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className={`p-2 ${sendBtnClass} text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
