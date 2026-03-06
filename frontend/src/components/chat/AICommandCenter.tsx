'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Minimize2, Maximize2 } from 'lucide-react';
import api from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AICommandCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '안녕하세요! Meta-Commander AI 어시스턴트입니다.\n\n시장 분석, 소재 제작, 캠페인 기획, 광고 집행, 성과 분석 등 무엇이든 도와드리겠습니다.\n\n어떤 도움이 필요하신가요?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const { data } = await api.post('/ai/chat', {
        message: userMessage,
        history: messages.filter((m) => m.role !== 'assistant' || messages.indexOf(m) !== 0).slice(-20),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center z-50"
        title="AI 어시스턴트"
      >
        <MessageSquare size={24} />
      </button>
    );
  }

  const chatWidth = isExpanded ? 'w-[600px]' : 'w-[380px]';
  const chatHeight = isExpanded ? 'h-[700px]' : 'h-[520px]';

  return (
    <div className={`fixed bottom-6 right-6 ${chatWidth} ${chatHeight} bg-white rounded-2xl shadow-2xl flex flex-col z-50 border border-gray-200 transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary-600 to-purple-600 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <MessageSquare size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">AI Command Center</h3>
            <p className="text-white/70 text-xs">마케팅 AI 어시스턴트</p>
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
                ? 'bg-primary-600 text-white rounded-br-md'
                : 'bg-gray-100 text-gray-800 rounded-bl-md'
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
            <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-md">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Loader2 size={14} className="animate-spin" />
                생각하는 중...
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {[
              '이번 달 캠페인 전략 추천해줘',
              'CTR 개선 방법 알려줘',
              '인스타 릴스 광고 카피 써줘',
              '예산 100만원 배분 전략',
            ].map((q, i) => (
              <button key={i} onClick={() => { setInput(q); }}
                className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700 transition-colors">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요... (Shift+Enter: 줄바꿈)"
            rows={1}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none max-h-24"
            style={{ minHeight: '40px' }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="p-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
