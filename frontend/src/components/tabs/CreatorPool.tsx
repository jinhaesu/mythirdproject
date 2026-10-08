'use client';

/**
 * 크리에이터 풀 — 인스타 크리에이터 잠재풀·유상구좌 집행풀 관리.
 *
 * @유저명만 등록하면 business_discovery로 팔로워·평균 좋아요/댓글·참여율을
 * 자동 스냅샷. 상태(후보→컨택→협업중→완료/제외)·유상 여부·단가·메모 관리.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2, Pencil, X, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { creatorsApi, type CreatorRow } from '@/lib/api';
import { fmtNum, fmtWon } from '@/components/tabs/kpi/format';

const STATUS_LABELS: Record<string, string> = {
  candidate: '후보', contacted: '컨택중', working: '협업중', done: '완료', excluded: '제외',
};
const STATUS_COLORS: Record<string, string> = {
  candidate: 'text-text-tertiary', contacted: 'text-yellow', working: 'text-brand',
  done: 'text-green', excluded: 'text-text-quaternary',
};

export function CreatorPool() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [paidF, setPaidF] = useState(''); // '' | 'paid' | 'organic'
  const [editing, setEditing] = useState<CreatorRow | 'new' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['creators'],
    queryFn: () => creatorsApi.list(),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['creators'] });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => creatorsApi.update(id, { status }),
    onSuccess: invalidate,
    onError: () => toast.error('상태 변경 실패'),
  });
  const refreshMut = useMutation({
    mutationFn: (id: number) => creatorsApi.refresh(id),
    onSuccess: () => { toast.success('지표를 갱신했습니다'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '갱신 실패 (인스타 연결 필요)'),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => creatorsApi.remove(id),
    onSuccess: invalidate,
    onError: () => toast.error('삭제 실패'),
  });

  const rows = useMemo(() => {
    let list = data?.creators || [];
    if (statusF) list = list.filter((c) => c.status === statusF);
    if (paidF) list = list.filter((c) => (paidF === 'paid' ? c.is_paid : !c.is_paid));
    if (q.trim()) {
      const n = q.trim().toLowerCase().replace('@', '');
      list = list.filter((c) =>
        c.username.includes(n) || (c.name || '').toLowerCase().includes(n)
        || (c.category || '').toLowerCase().includes(n) || (c.memo || '').toLowerCase().includes(n));
    }
    return list;
  }, [data, statusF, paidF, q]);

  const totals = useMemo(() => ({
    all: rows.length,
    paid: rows.filter((c) => c.is_paid).length,
    working: rows.filter((c) => c.status === 'working').length,
    fee: rows.filter((c) => c.is_paid).reduce((s, c) => s + (c.fee || 0), 0),
  }), [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">크리에이터 풀</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            @유저명만 등록하면 팔로워·평균 반응·참여율을 인스타 API로 자동 수집합니다 — 잠재풀과 유상구좌를 한 곳에서
          </p>
        </div>
        <div className="flex-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="유저명·분류·메모 검색"
          className="px-2.5 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary w-44" />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
          <option value="">상태 전체</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={paidF} onChange={(e) => setPaidF(e.target.value)}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
          <option value="">유상/오가닉 전체</option>
          <option value="paid">유상구좌</option>
          <option value="organic">오가닉</option>
        </select>
        <button onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}>
          <Plus size={13} /> 크리에이터 추가
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          { label: '전체(필터 반영)', value: `${fmtNum(totals.all)}명` },
          { label: '유상구좌', value: `${fmtNum(totals.paid)}명` },
          { label: '협업중', value: `${fmtNum(totals.working)}명` },
          { label: '유상 단가 합계', value: fmtWon(totals.fee) },
        ].map((c) => (
          <div key={c.label} className="rounded-xl px-4 py-2.5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
            <p className="text-[10px] text-text-quaternary">{c.label}</p>
            <p className="text-base font-bold tabular-nums text-text-primary">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {['크리에이터', '팔로워', '평균 ❤', '평균 💬', '참여율', '분류', '상태', '유상/단가', '메모', '지표 기준', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-text-tertiary">불러오는 중...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-text-tertiary">
                  등록된 크리에이터가 없습니다 — &quot;크리에이터 추가&quot;에 @유저명을 넣으면 지표가 자동 수집됩니다
                </td></tr>
              ) : rows.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {c.picture_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.picture_url} alt="" className="w-6 h-6 rounded-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      <div>
                        <a href={c.profile_url} target="_blank" rel="noreferrer"
                          className="font-medium text-text-primary hover:text-brand hover:underline flex items-center gap-0.5">
                          @{c.username} <ExternalLink size={10} className="text-text-quaternary" />
                        </a>
                        {c.name && <p className="text-[10px] text-text-quaternary">{c.name}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-right text-text-primary">{c.followers != null ? fmtNum(c.followers) : '-'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-text-secondary">{c.avg_likes != null ? fmtNum(c.avg_likes) : '-'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-text-secondary">{c.avg_comments != null ? fmtNum(c.avg_comments) : '-'}</td>
                  <td className={`px-3 py-2 tabular-nums text-right font-medium ${
                    c.engagement_rate == null ? 'text-text-quaternary' : c.engagement_rate >= 3 ? 'text-green' : c.engagement_rate >= 1 ? 'text-text-primary' : 'text-yellow'
                  }`}>{c.engagement_rate != null ? `${c.engagement_rate}%` : '-'}</td>
                  <td className="px-3 py-2 text-text-tertiary whitespace-nowrap">{c.category || '-'}</td>
                  <td className="px-3 py-2">
                    <select value={c.status} onChange={(e) => statusMut.mutate({ id: c.id, status: e.target.value })}
                      className={`px-1.5 py-1 rounded-lg text-[11px] bg-bg-2 border border-border-primary ${STATUS_COLORS[c.status] || ''}`}>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.is_paid ? (
                      <span className="text-text-primary tabular-nums">
                        <span className="px-1 rounded text-[9px] font-bold bg-yellow/15 text-yellow mr-1">유상</span>
                        {c.fee != null ? fmtWon(c.fee) : '단가 미입력'}
                      </span>
                    ) : <span className="text-text-quaternary text-[11px]">오가닉</span>}
                  </td>
                  <td className="px-3 py-2 text-text-tertiary max-w-[180px] truncate" title={c.memo || ''}>{c.memo || ''}</td>
                  <td className="px-3 py-2 text-[10px] text-text-quaternary whitespace-nowrap">{c.last_checked_at?.slice(0, 10) || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button onClick={() => refreshMut.mutate(c.id)} disabled={refreshMut.isPending}
                      className="p-1 text-text-quaternary hover:text-text-primary" title="지표 갱신">
                      <RefreshCw size={12} className={refreshMut.isPending && refreshMut.variables === c.id ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={() => setEditing(c)} className="p-1 text-text-quaternary hover:text-text-primary" title="수정"><Pencil size={12} /></button>
                    <button onClick={() => { if (confirm(`@${c.username}을 풀에서 삭제할까요?`)) delMut.mutate(c.id); }}
                      className="p-1 text-text-quaternary hover:text-red" title="삭제"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10px] text-text-quaternary text-right">
        지표 = business_discovery 공개 데이터(최근 12개 게시물 평균) · 참여율 = (평균 좋아요+댓글) ÷ 팔로워 · 비즈니스/크리에이터 계정만 조회 가능
      </p>

      {editing && (
        <CreatorModal
          creator={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function CreatorModal({ creator, onClose, onSaved }: {
  creator: CreatorRow | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    username: creator?.username || '',
    category: creator?.category || '',
    status: creator?.status || 'candidate',
    is_paid: creator?.is_paid || false,
    fee: creator?.fee != null ? String(creator.fee) : '',
    source: creator?.source || '',
    memo: creator?.memo || '',
  });
  const mut = useMutation({
    mutationFn: () => {
      const payload: any = {
        username: form.username.trim().replace('@', ''),
        category: form.category.trim() || null,
        status: form.status,
        is_paid: form.is_paid,
        fee: form.fee.trim() ? Number(form.fee.replace(/,/g, '')) : null,
        source: form.source.trim() || null,
        memo: form.memo.trim() || null,
      };
      return creator ? creatorsApi.update(creator.id, payload) : creatorsApi.add(payload);
    },
    onSuccess: (r: any) => {
      if (r?.snapshot_error) toast(`등록됨 — 지표 수집은 실패: ${String(r.snapshot_error).slice(0, 60)}`, { icon: '⚠️', duration: 6000 });
      else toast.success(creator ? '수정했습니다' : `@${r.username} 등록 완료${r.followers ? ` (팔로워 ${fmtNum(r.followers)})` : ''}`);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '저장 실패'),
  });
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl p-5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">{creator ? `@${creator.username} 수정` : '크리에이터 추가'}</h3>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="space-y-3 text-xs">
          {!creator && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">인스타 유저명 * (@ 없이)</span>
              <input value={form.username} onChange={(e) => setForm((v) => ({ ...v, username: e.target.value }))}
                placeholder="예: nuldam_official" className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">분류</span>
              <input value={form.category} onChange={(e) => setForm((v) => ({ ...v, category: e.target.value }))}
                placeholder="푸드, 운동, 육아…" className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">상태</span>
              <select value={form.status} onChange={(e) => setForm((v) => ({ ...v, status: e.target.value }))}
                className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary">
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 mt-4">
              <input type="checkbox" checked={form.is_paid} onChange={(e) => setForm((v) => ({ ...v, is_paid: e.target.checked }))} />
              <span className="text-text-secondary">유상구좌</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">단가(원)</span>
              <input value={form.fee} onChange={(e) => setForm((v) => ({ ...v, fee: e.target.value }))}
                placeholder="예: 300000" className="px-2 py-1.5 rounded-lg text-right tabular-nums bg-bg-2 border border-border-primary text-text-primary" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">발굴 경로</span>
            <input value={form.source} onChange={(e) => setForm((v) => ({ ...v, source: e.target.value }))}
              placeholder="해시태그, 태그됨, 추천, DM 인바운드…" className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">메모</span>
            <input value={form.memo} onChange={(e) => setForm((v) => ({ ...v, memo: e.target.value }))}
              className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary">취소</button>
          <button onClick={() => { if (!creator && !form.username.trim()) { toast.error('유저명을 입력해 주세요'); return; } mut.mutate(); }}
            disabled={mut.isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            {creator ? '저장' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
